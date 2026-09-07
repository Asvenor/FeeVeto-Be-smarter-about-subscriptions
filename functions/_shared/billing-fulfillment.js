import { assertStripeMode, billingMode, billingPriceIds, objectId } from './billing-config.js';
import { customerFor, recordPurchase, verifiedCustomerOwner, clearCheckout } from './billing-store.js';
import { syncSubscription, stopMonthlyRenewals } from './billing-subscriptions.js';

export async function fulfillCheckout({ env, stripe, sessionId }) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  assertStripeMode(session, env);
  const userId = session.metadata?.clerk_user_id;
  const plan = session.metadata?.plan;
  if (!['monthly', 'lifetime'].includes(plan) || !userId || session.client_reference_id !== userId
    || session.metadata?.product_key !== `feeveto_premium_${plan}`
    || session.metadata?.billing_mode !== billingMode(env)
    || !(await verifiedCustomerOwner({ env, customerId: objectId(session.customer), userId }))) return false;
  if (session.status !== 'complete' || session.payment_status !== 'paid') return false;
  const lines = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
  if (lines.has_more || lines.data.length !== 1 || lines.data[0].quantity !== 1
    || !billingPriceIds(env, plan, { legacy: true }).includes(objectId(lines.data[0].price)) || session.currency !== 'usd') return false;
  if (plan === 'lifetime') {
    if (session.mode !== 'payment' || !objectId(session.payment_intent) || !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0) return false;
    await recordPurchase({ env, session, priceId: objectId(lines.data[0].price) });
  } else {
    if (session.mode !== 'subscription' || !objectId(session.subscription)) return false;
    const subscription = await syncSubscription({ env, stripe, subscriptionId: objectId(session.subscription),
      expectedUserId: userId, expectedCustomerId: objectId(session.customer) });
    if (!subscription) return false;
  }
  // Retried even after a committed grant, so transient cancellation failures do
  // not leave a lifetime buyer's monthly subscription renewing indefinitely.
  await stopMonthlyRenewals({ env, stripe, userId, customerId: objectId(session.customer) });
  const row = await customerFor(env, userId);
  if (row?.checkout_token === session.metadata.checkout_token) await clearCheckout({ env, userId, token: row.checkout_token });
  return true;
}
