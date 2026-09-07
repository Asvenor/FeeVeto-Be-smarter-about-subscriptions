import { assertStripeMode, billingMode, billingPriceIds, objectId } from './billing-config.js';
import { billingDatabase, verifiedCustomerOwner, getBillingStatus } from './billing-store.js';

export const SUBSCRIPTION_PRODUCT_KEY = 'feeveto_premium_monthly';
export const invoiceSubscriptionId = invoice => objectId(invoice?.parent?.subscription_details?.subscription || invoice?.subscription);
const linePrice = line => objectId(line?.pricing?.price_details?.price || line?.price);

async function recordPaidInvoice({ env, stripe, subscription, invoiceId }) {
  if (!invoiceId) return;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  assertStripeMode(invoice, env);
  if (invoice.status !== 'paid' || invoiceSubscriptionId(invoice) !== subscription.id || objectId(invoice.customer) !== objectId(subscription.customer)) return;
  const lines = await stripe.invoices.listLineItems(invoice.id, { limit: 100 });
  if (lines.has_more) throw new Error('Unexpected invoice size; manual review required.');
  const ids = billingPriceIds(env, 'monthly', { legacy: true });
  const periods = lines.data.filter(line => ids.includes(linePrice(line)) && line.quantity === 1 && Number.isSafeInteger(line.period?.end));
  if (!periods.length) return;
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 100 });
  if (payments.has_more) throw new Error('Unexpected invoice payment count.');
  const paid = payments.data.filter(p => p.status === 'paid' && p.payment?.type === 'payment_intent'
    && objectId(p.payment.payment_intent) && objectId(p.invoice) === invoice.id);
  for (const payment of paid) assertStripeMode(payment, env);
  // Card-only checkout requires a real paid invoice payment, not a fabricated paid flag.
  if (!paid.length) return;
  const db = billingDatabase(env), mode = billingMode(env);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO billing_paid_invoices (mode, invoice_id, subscription_id, paid_through) VALUES (?, ?, ?, ?)')
      .bind(mode, invoice.id, subscription.id, Math.max(...periods.map(line => line.period.end))),
    ...paid.map(p => db.prepare('INSERT OR IGNORE INTO billing_invoice_payments (mode, invoice_id, payment_intent_id) VALUES (?, ?, ?)')
      .bind(mode, invoice.id, objectId(p.payment.payment_intent))),
  ]);
}

// Events are notifications, not authoritative snapshots. Re-read Stripe and use
// a database revision check so concurrent deliveries cannot overwrite newer state.
export async function syncSubscription({ env, stripe, subscriptionId, invoiceId = '', expectedUserId = '', expectedCustomerId = '' }) {
  const db = billingDatabase(env), mode = billingMode(env);
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await db.prepare('SELECT revision FROM billing_subscriptions WHERE mode = ? AND subscription_id = ?').bind(mode, subscriptionId).first();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    assertStripeMode(subscription, env);
    const userId = subscription.metadata?.clerk_user_id;
    if ((expectedUserId && userId !== expectedUserId) || (expectedCustomerId && objectId(subscription.customer) !== expectedCustomerId)) return null;
    const item = subscription.items?.data?.[0];
    if (!userId || subscription.metadata?.product_key !== SUBSCRIPTION_PRODUCT_KEY || subscription.items?.has_more || subscription.items?.data?.length !== 1
      || item.quantity !== 1 || !billingPriceIds(env, 'monthly', { legacy: true }).includes(objectId(item.price))
      || !(await verifiedCustomerOwner({ env, customerId: objectId(subscription.customer), userId }))) return null;
    const values = [userId, objectId(subscription.customer), objectId(item.price), subscription.status,
      subscription.cancel_at_period_end ? 1 : 0, item.current_period_end || 0];
    let updated;
    if (before) {
      updated = await db.prepare(`UPDATE billing_subscriptions SET clerk_user_id = ?, customer_id = ?, price_id = ?, status = ?,
        cancel_at_period_end = ?, current_period_end = ?, revision = revision + 1
        WHERE mode = ? AND subscription_id = ? AND revision = ? RETURNING revision`).bind(...values, mode, subscriptionId, before.revision).first();
    } else {
      updated = await db.prepare(`INSERT OR IGNORE INTO billing_subscriptions
        (clerk_user_id, customer_id, price_id, status, cancel_at_period_end, current_period_end, mode, subscription_id, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING revision`).bind(...values, mode, subscriptionId).first();
    }
    if (!updated) continue;
    await recordPaidInvoice({ env, stripe, subscription, invoiceId: invoiceId || objectId(subscription.latest_invoice) });
    return subscription;
  }
  throw new Error('Concurrent subscription update; retry the webhook.');
}

export async function stopMonthlyRenewals({ env, stripe, userId, customerId }) {
  if (!(await getBillingStatus({ env, userId })).lifetimeAccess) return;
  // Resolve the complete list, including a Checkout whose webhook arrived late.
  let starting_after;
  for (let page = 0; page < 10; page++) {
    const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100, ...(starting_after ? { starting_after } : {}) });
    for (const sub of list.data) {
      if (sub.metadata?.clerk_user_id !== userId || sub.metadata?.product_key !== SUBSCRIPTION_PRODUCT_KEY
        || !sub.items?.data?.some(item => billingPriceIds(env, 'monthly', { legacy: true }).includes(objectId(item.price)))) continue;
      assertStripeMode(sub, env);
      if (!['canceled', 'incomplete_expired'].includes(sub.status)) {
        // No additional invoice, automatic refund, or surprise proration. A failed
        // cancellation returns an error so Stripe retries the original webhook.
        await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
      }
      await syncSubscription({ env, stripe, subscriptionId: sub.id });
    }
    if (!list.has_more) return;
    starting_after = list.data.at(-1)?.id;
    if (!starting_after) break;
  }
  throw new Error('Subscription reconciliation needs another attempt.');
}
