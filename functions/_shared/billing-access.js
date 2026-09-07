import { BillingConfigurationError } from './billing-config.js';
import { getBillingStatus } from './billing-store.js';
export { BillingConfigurationError } from './billing-config.js';
export const PREMIUM_PRODUCT_KEY = 'feeveto_premium_lifetime';

function billingDatabase(env, { required = false } = {}) {
  const database = env?.FEEVETO_BILLING;
  if (database && typeof database.prepare === 'function') return database;
  if (required) throw new BillingConfigurationError('The billing database is not configured.');
  return null;
}

export async function getPaidPremiumAccessStrict({ userId, env } = {}) {
  if (typeof userId !== 'string' || !userId.trim()) return false;
  if (env?.STRIPE_MONTHLY_PRICE_ID || env?.STRIPE_LIFETIME_PRICE_ID) {
    return (await getBillingStatus({ userId, env })).premiumAccess;
  }
  const database = billingDatabase(env, { required: true });
  const priceId=typeof env?.STRIPE_PRICE_ID==='string'?env.STRIPE_PRICE_ID.trim():'';
  if(!priceId)throw new BillingConfigurationError('The payment price is not configured.');

  const row = await database.prepare(
    `SELECT 1 AS has_access
     FROM billing_entitlements
     WHERE clerk_user_id = ? AND status = 'active' AND price_id = ?
     LIMIT 1`,
  ).bind(userId,priceId).first();
  return row?.has_access === 1;
}

export async function getPaidPremiumAccess(options) {
  try {
    return await getPaidPremiumAccessStrict(options);
  } catch {
    // Billing failures must never accidentally grant access or break the free audit.
    return false;
  }
}

function eventStatement(database, event) {
  return database.prepare(
    `INSERT OR IGNORE INTO stripe_events (event_id, event_type, processed_at)
     VALUES (?, ?, ?)`,
  ).bind(event.id, event.type, new Date().toISOString());
}

export async function recordStripeEvent({ env, event }) {
  const database = billingDatabase(env, { required: true });
  await eventStatement(database, event).run();
}

export async function activateLifetimeAccess({ env, event, session }) {
  const database = billingDatabase(env, { required: true });
  const now = new Date(event.created * 1000).toISOString();
  await database.batch([
    database.prepare(
      `INSERT INTO billing_entitlements (
         clerk_user_id, stripe_customer_id, stripe_payment_intent_id,
         stripe_checkout_session_id, status, product_key, price_id,
         amount_total, currency, purchased_at, updated_at
       ) SELECT ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM stripe_refunded_payments WHERE payment_intent_id = ?)
         AND NOT EXISTS (SELECT 1 FROM stripe_events WHERE event_id = ?)
       ON CONFLICT(clerk_user_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_payment_intent_id = excluded.stripe_payment_intent_id,
         stripe_checkout_session_id = excluded.stripe_checkout_session_id,
         status = 'active',
         product_key = excluded.product_key,
         price_id = excluded.price_id,
         amount_total = excluded.amount_total,
         currency = excluded.currency,
         purchased_at = excluded.purchased_at,
         updated_at = excluded.updated_at
       WHERE excluded.purchased_at > billing_entitlements.purchased_at`,
    ).bind(
      session.clerkUserId,
      session.customerId,
      session.paymentIntentId,
      session.checkoutSessionId,
      PREMIUM_PRODUCT_KEY,
      session.priceId,
      session.amountTotal,
      session.currency,
      now,
      now,
      session.paymentIntentId,
      event.id,
    ),
    eventStatement(database, event),
  ]);
}

export async function revokeRefundedAccess({ env, event, paymentIntentId }) {
  const database = billingDatabase(env, { required: true });
  const now = new Date(event.created * 1000).toISOString();
  await database.batch([
    database.prepare('INSERT OR IGNORE INTO stripe_refunded_payments (payment_intent_id, refunded_at) VALUES (?, ?)').bind(paymentIntentId,now),
    database.prepare(
      `UPDATE billing_entitlements
       SET status = 'refunded', updated_at = ?
       WHERE stripe_payment_intent_id = ? AND status = 'active'`,
    ).bind(now, paymentIntentId),
    eventStatement(database, event),
  ]);
}
