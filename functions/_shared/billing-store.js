import { BillingConfigurationError, billingMode, billingPriceIds, objectId, assertStripeMode } from './billing-config.js';

export function billingDatabase(env) {
  if (!env?.FEEVETO_BILLING?.prepare) throw new BillingConfigurationError('The billing database is not configured.');
  return env.FEEVETO_BILLING;
}
const placeholders = ids => ids.map(() => '?').join(',');
export async function customerFor(env, userId) {
  return billingDatabase(env).prepare('SELECT * FROM billing_customers WHERE mode = ? AND clerk_user_id = ?').bind(billingMode(env), userId).first();
}
export async function getBillingStatus({ env, userId, now = Math.floor(Date.now() / 1000) }) {
  const db = billingDatabase(env), mode = billingMode(env);
  const lifetimeIds = billingPriceIds(env, 'lifetime', { legacy: true });
  const monthlyIds = billingPriceIds(env, 'monthly', { legacy: true });
  let lifetimeAccess = false;
  if (lifetimeIds.length) {
    const purchase = await db.prepare(`SELECT 1 AS granted FROM billing_purchases p
      WHERE p.mode = ? AND p.clerk_user_id = ? AND p.price_id IN (${placeholders(lifetimeIds)})
      AND NOT EXISTS (SELECT 1 FROM stripe_refunded_payments r WHERE r.payment_intent_id = p.payment_intent_id) LIMIT 1`).bind(mode, userId, ...lifetimeIds).first();
    // Old prices are accepted only through the explicit, environment-specific allowlist.
    const legacy = await db.prepare(`SELECT 1 AS granted FROM billing_entitlements
      WHERE clerk_user_id = ? AND status = 'active' AND price_id IN (${placeholders(lifetimeIds)}) LIMIT 1`).bind(userId, ...lifetimeIds).first();
    lifetimeAccess = Boolean(purchase || legacy);
  }
  const subscriptions = monthlyIds.length ? (await db.prepare(`SELECT s.*,
    COALESCE((SELECT MAX(i.paid_through) FROM billing_paid_invoices i WHERE i.mode = s.mode AND i.subscription_id = s.subscription_id
      AND NOT EXISTS (SELECT 1 FROM billing_invoice_payments p JOIN stripe_refunded_payments r ON r.payment_intent_id = p.payment_intent_id
        WHERE p.mode = i.mode AND p.invoice_id = i.invoice_id)), 0) AS paid_through
    FROM billing_subscriptions s WHERE s.mode = ? AND s.clerk_user_id = ? AND s.price_id IN (${placeholders(monthlyIds)})
    ORDER BY current_period_end DESC`).bind(mode, userId, ...monthlyIds).all()).results : [];
  const active = subscriptions.find(s => ['active', 'past_due'].includes(s.status) && s.paid_through > now);
  const subscription = active || subscriptions.find(s => !['canceled', 'incomplete_expired'].includes(s.status)) || subscriptions[0];
  const customer = await customerFor(env, userId);
  return {
    lifetimeAccess, subscriptionAccess: Boolean(active), premiumAccess: lifetimeAccess || Boolean(active),
    renewalCancellationPending: lifetimeAccess && subscriptions.some(s => !['canceled', 'incomplete_expired'].includes(s.status)),
    canManageBilling: Boolean(customer?.stripe_customer_id),
    subscription: subscription ? { status: subscription.status, paidThrough: subscription.paid_through,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end), currentPeriodEnd: subscription.current_period_end } : null,
  };
}
export async function ensureCustomer({ env, stripe, identity }) {
  const db = billingDatabase(env), mode = billingMode(env), userId = identity.userId;
  await db.prepare('INSERT OR IGNORE INTO billing_customers (mode, clerk_user_id) VALUES (?, ?)').bind(mode, userId).run();
  let row = await customerFor(env, userId);
  if (!row.stripe_customer_id) {
    // Replayed requests use identical parameters, even if the account email changes.
    const customer = await stripe.customers.create({ metadata: { clerk_user_id: userId, application: 'feeveto' } }, { idempotencyKey: `feeveto:customer:${mode}:${userId}` });
    assertStripeMode(customer, env);
    await db.prepare('UPDATE billing_customers SET stripe_customer_id = ? WHERE mode = ? AND clerk_user_id = ? AND stripe_customer_id IS NULL').bind(customer.id, mode, userId).run();
    row = await customerFor(env, userId);
  }
  return row;
}
export async function reserveCheckout({ env, userId, plan, origin, now = Math.floor(Date.now() / 1000) }) {
  const db = billingDatabase(env), mode = billingMode(env);
  const token = crypto.randomUUID();
  await db.prepare(`UPDATE billing_customers SET checkout_token = ?, checkout_plan = ?, checkout_origin = ?, checkout_expires_at = ?
    WHERE mode = ? AND clerk_user_id = ? AND checkout_token IS NULL`).bind(token, plan, origin, now + 3600, mode, userId).run();
  return customerFor(env, userId);
}
export async function clearCheckout({ env, userId, token }) {
  await billingDatabase(env).prepare(`UPDATE billing_customers SET checkout_token = NULL, checkout_plan = NULL, checkout_session_id = NULL,
    checkout_expires_at = NULL, checkout_origin = NULL WHERE mode = ? AND clerk_user_id = ? AND checkout_token = ?`).bind(billingMode(env), userId, token).run();
}
export async function bindCheckout({ env, userId, token, sessionId }) {
  await billingDatabase(env).prepare('UPDATE billing_customers SET checkout_session_id = ? WHERE mode = ? AND clerk_user_id = ? AND checkout_token = ?').bind(sessionId, billingMode(env), userId, token).run();
}
export async function verifiedCustomerOwner({ env, customerId, userId }) {
  const row = await customerFor(env, userId);
  return row?.stripe_customer_id === customerId;
}
export async function recordPurchase({ env, session, priceId }) {
  await billingDatabase(env).prepare(`INSERT OR IGNORE INTO billing_purchases
    (mode, payment_intent_id, clerk_user_id, customer_id, session_id, price_id, amount_total, currency, purchased_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(billingMode(env), objectId(session.payment_intent), session.client_reference_id,
    objectId(session.customer), session.id, priceId, session.amount_total, session.currency, session.created).run();
}
