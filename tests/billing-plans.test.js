import test from 'node:test';
import assert from 'node:assert/strict';
import { billingFixture, identity, now } from './helpers/billing-fixture.js';
import { handleCheckoutRequest } from '../functions/api/billing/checkout.js';
import { handleWebhookRequest } from '../functions/api/billing/webhook.js';
import { handleBillingPortalRequest } from '../functions/api/billing/portal.js';
import { handleBillingStatusRequest } from '../functions/api/billing/status.js';
import { handleBillingPlansRequest } from '../functions/api/billing/plans.js';
import { fulfillCheckout } from '../functions/_shared/billing-fulfillment.js';
import { getBillingStatus } from '../functions/_shared/billing-store.js';
import { getPaidPremiumAccess, activateLifetimeAccess } from '../functions/_shared/billing-access.js';
import { syncSubscription } from '../functions/_shared/billing-subscriptions.js';
import { stripeKeyMatchesMode } from '../functions/_shared/billing-config.js';

const status = (f, extra = {}) => getBillingStatus({ env: f.env, userId: identity.userId, ...extra });
test('server keys accept restricted sandbox credentials, but never browser keys or a mismatched mode', () => {
  assert.equal(stripeKeyMatchesMode('rk_test_fictional', { BILLING_MODE: 'test' }), true);
  assert.equal(stripeKeyMatchesMode('sk_test_fictional', { BILLING_MODE: 'test' }), true);
  for (const key of ['pk_test_fictional', 'rk_live_fictional', 'sk_live_fictional', '']) {
    assert.equal(stripeKeyMatchesMode(key, { BILLING_MODE: 'test' }), false);
  }
});
async function buy(f, plan = 'monthly') {
  assert.equal((await handleCheckoutRequest(f.context(plan), f.dependencies)).status, 201);
  const session = f.paidSession(plan);
  await fulfillCheckout({ env: f.env, stripe: f.stripe, sessionId: session.id });
  return session;
}
async function event(f, type, object, id = `evt_${crypto.randomUUID()}`, extra = {}) {
  return handleWebhookRequest({ env: f.env, request: new Request('https://feeveto.example/api/billing/webhook', {
    method: 'POST', headers: { 'Stripe-Signature': 'fictional' }, body: JSON.stringify({ id, type, created: now, livemode: false, data: { object }, ...extra }),
  }) }, { stripeClientFactory: () => f.stripe, cryptoProviderFactory: () => ({}), webhookSecretResolver: () => 'fictional' });
}

test('monthly and lifetime use the approved USD prices and a reusable account customer', async t => {
  for (const plan of ['monthly', 'lifetime']) await t.test(plan, async () => {
    const f = await billingFixture(); try {
      await buy(f, plan); const session = [...f.sessions.values()][0];
      assert.equal(session.mode, plan === 'monthly' ? 'subscription' : 'payment');
      assert.equal(session.line_items[0].price, `price_${plan}`); assert.equal(session.customer, 'cus_1');
      assert.equal(session.client_reference_id, identity.userId); assert.equal(session.currency, 'usd');
      assert.equal((await status(f)).premiumAccess, true);
      assert.equal(await getPaidPremiumAccess({ env: f.env, userId: identity.userId }), true);
    } finally { f.db.close(); }
  });
});
test('checkout is disabled by default; live/test mismatches and wrong configured prices fail closed', async () => {
  const f = await billingFixture(); try {
    delete f.env.BILLING_ENABLED; assert.equal((await handleCheckoutRequest(f.context(), f.dependencies)).status, 503);
    f.env.BILLING_ENABLED = 'true'; f.prices.price_monthly.unit_amount = 399;
    assert.equal((await handleCheckoutRequest(f.context(), f.dependencies)).status, 503);
    f.prices.price_monthly.unit_amount = 299; f.prices.price_monthly.livemode = true;
    assert.equal((await handleCheckoutRequest(f.context(), f.dependencies)).status, 503);
    assert.equal(f.calls.checkouts, 0);
  } finally { f.db.close(); }
});
test('parallel clicks and retries produce one open checkout; another plan cannot create a second', async () => {
  const f = await billingFixture(); try {
    const responses = await Promise.all([handleCheckoutRequest(f.context(), f.dependencies), handleCheckoutRequest(f.context(), f.dependencies)]);
    assert.ok(responses.every(r => r.status === 201)); assert.equal(f.calls.checkouts, 1); assert.equal(f.calls.customers, 1);
    assert.equal((await handleCheckoutRequest(f.context('lifetime'), f.dependencies)).status, 409);
    f.sessions.get('cs_1').status = 'expired';
    assert.equal((await handleCheckoutRequest(f.context('lifetime'), f.dependencies)).status, 201);
    assert.equal(f.calls.checkouts, 2); assert.equal(f.calls.customers, 1);
  } finally { f.db.close(); }
});
test('an uncertain Stripe response reuses the reserved session instead of creating another charge opportunity', async () => {
  const f = await billingFixture(); try {
    const create = f.stripe.checkout.sessions.create; let fail = true;
    f.stripe.checkout.sessions.create = async (...args) => { const session = await create(...args); if (fail) { fail = false; throw new Error('network timeout'); } return session; };
    assert.equal((await handleCheckoutRequest(f.context(), f.dependencies)).status, 502);
    assert.equal((await handleCheckoutRequest(f.context(), f.dependencies)).status, 201);
    assert.equal(f.calls.checkouts, 1);
  } finally { f.db.close(); }
});
test('renewal extends paid access, older deliveries cannot shorten it, and missed renewal expires without a webhook', async () => {
  const f = await billingFixture(); try {
    await buy(f); const sub = f.subscriptions.get('sub_test'); const end = now + 5184000;
    f.invoice('in_second', end); sub.latest_invoice = 'in_second'; sub.items.data[0].current_period_end = end;
    assert.equal((await event(f, 'invoice.paid', f.invoices.get('in_second'))).status, 200);
    assert.equal((await event(f, 'invoice.paid', f.invoices.get('in_first'))).status, 200);
    assert.equal((await status(f)).subscription.paidThrough, end);
    assert.equal((await status(f, { now: end + 1 })).premiumAccess, false);
    sub.status = 'past_due'; f.invoices.get('in_second').status = 'open';
    await event(f, 'invoice.payment_failed', f.invoices.get('in_second'));
    assert.equal((await status(f, { now: end + 1 })).premiumAccess, false);
  } finally { f.db.close(); }
});
test('cancellation at period end keeps paid access; terminal cancellation cannot be resurrected by an old event', async () => {
  const f = await billingFixture(); try {
    await buy(f); const sub = f.subscriptions.get('sub_test'); sub.cancel_at_period_end = true;
    await event(f, 'customer.subscription.updated', sub);
    assert.equal((await status(f)).subscriptionAccess, true); assert.equal((await status(f)).subscription.cancelAtPeriodEnd, true);
    sub.status = 'canceled'; await event(f, 'customer.subscription.deleted', sub);
    await event(f, 'customer.subscription.updated', { ...sub, status: 'active' });
    assert.equal((await status(f)).premiumAccess, false);
  } finally { f.db.close(); }
});
test('lifetime upgrade stops monthly billing and a cancellation failure is safely retried', async () => {
  const f = await billingFixture(); try {
    await buy(f); assert.equal((await handleCheckoutRequest(f.context(), f.dependencies)).status, 200);
    await handleCheckoutRequest(f.context('lifetime'), f.dependencies); const session = f.paidSession('lifetime');
    const cancel = f.stripe.subscriptions.cancel; let fail = true;
    f.stripe.subscriptions.cancel = async (...args) => { if (fail) { fail = false; throw new Error('Stripe unavailable'); } return cancel(...args); };
    assert.equal((await event(f, 'checkout.session.completed', session, 'evt_upgrade')).status, 500);
    assert.equal((await status(f)).lifetimeAccess, true);
    assert.equal((await status(f)).renewalCancellationPending, true);
    assert.equal((await event(f, 'checkout.session.completed', session, 'evt_upgrade')).status, 200);
    assert.equal(f.subscriptions.get('sub_test').status, 'canceled');
    assert.equal((await status(f)).renewalCancellationPending, false);
    assert.equal((await status(f)).premiumAccess, true); assert.equal((await status(f)).subscriptionAccess, false);
    assert.equal((await handleCheckoutRequest(f.context(), f.dependencies)).status, 200);
    assert.equal(f.calls.checkouts, 2);
  } finally { f.db.close(); }
});
test('refunds revoke only the matching purchase or paid invoice and early refunds survive delayed fulfillment', async () => {
  const f = await billingFixture(); try {
    await buy(f);
    await event(f, 'charge.refunded', { refunded: true, payment_intent: 'pi_in_first' });
    assert.equal((await status(f)).subscriptionAccess, false);
    f.invoice('in_second', now + 5184000); f.subscriptions.get('sub_test').latest_invoice = 'in_second';
    await event(f, 'invoice.paid', f.invoices.get('in_second')); assert.equal((await status(f)).subscriptionAccess, true);
    await handleCheckoutRequest(f.context('lifetime'), f.dependencies); const session = f.paidSession('lifetime');
    await event(f, 'charge.refunded', { refunded: true, payment_intent: session.payment_intent });
    await event(f, 'checkout.session.completed', session); assert.equal((await status(f)).lifetimeAccess, false);
    assert.equal((await status(f)).subscriptionAccess, true, 'An already refunded upgrade must not cancel valid monthly access.');
  } finally { f.db.close(); }
});
test('legacy lifetime grants survive explicit price migration and no legacy rows are changed', async () => {
  const f = await billingFixture(); try {
    await activateLifetimeAccess({ env: f.env, event: { id: 'evt_legacy', type: 'checkout.session.completed', created: now }, session: {
      clerkUserId: identity.userId, customerId: 'cus_old', paymentIntentId: 'pi_old', checkoutSessionId: 'cs_old', priceId: 'price_old', amountTotal: 499, currency: 'USD' } });
    assert.equal((await status(f)).lifetimeAccess, false);
    f.env.STRIPE_LEGACY_LIFETIME_PRICE_IDS = 'price_old'; assert.equal((await status(f)).lifetimeAccess, true);
    assert.equal((await f.db.prepare('SELECT amount_total FROM billing_entitlements').first()).amount_total, 499);
    assert.equal((await status(f, { env: { ...f.env, BILLING_MODE: 'live', STRIPE_LEGACY_LIFETIME_PRICE_IDS: '' } })).premiumAccess, false);
  } finally { f.db.close(); }
});
test('portal and billing status are owner-scoped; client customer and premium flags cannot select another account', async () => {
  const f = await billingFixture(); try {
    await buy(f);
    const request = new Request('https://feeveto.example/api/billing/portal?customer=cus_victim', { method: 'POST', body: JSON.stringify({ customer: 'cus_victim', premiumAccess: true }) });
    assert.equal((await handleBillingPortalRequest({ env: f.env, request }, f.dependencies)).status, 200);
    assert.equal(f.calls.portal.customer, 'cus_1'); assert.equal(f.calls.portal.configuration, 'bpc_test');
    const other = { ...f.dependencies, identityResolver: async () => ({ ...identity, userId: 'someone_else' }) };
    assert.equal((await handleBillingPortalRequest({ env: f.env, request }, other)).status, 404);
    const response = await handleBillingStatusRequest({ env: f.env, request: new Request('https://feeveto.example/api/billing/status') }, other);
    assert.equal((await response.json()).premiumAccess, false);
    assert.equal((await handleBillingPortalRequest({ env: f.env, request }, { identityResolver: async () => null })).status, 401);
  } finally { f.db.close(); }
});
test('wrong session ownership, wrong price, unpaid completion and live events cannot unlock Premium', async () => {
  const f = await billingFixture(); try {
    await handleCheckoutRequest(f.context('lifetime'), f.dependencies); const session = f.paidSession('lifetime');
    session.customer = 'cus_other'; await event(f, 'checkout.session.completed', session); assert.equal((await status(f)).premiumAccess, false);
    session.customer = 'cus_1'; session.line_items[0].price = 'price_unapproved'; await event(f, 'checkout.session.completed', session); assert.equal((await status(f)).premiumAccess, false);
    session.line_items[0].price = 'price_lifetime'; session.payment_status = 'unpaid'; await event(f, 'checkout.session.completed', session); assert.equal((await status(f)).premiumAccess, false);
    assert.equal((await event(f, 'checkout.session.completed', session, 'evt_live', { livemode: true })).status, 503);
  } finally { f.db.close(); }
});
test('a stale concurrent subscription read loses its revision race and refetches current Stripe state', async () => {
  const f = await billingFixture(); try {
    await buy(f); let release, captured;
    const original = f.stripe.subscriptions.retrieve; let first = true;
    f.stripe.subscriptions.retrieve = async id => {
      const snapshot = await original(id);
      if (first) { first = false; captured = true; await new Promise(resolve => { release = resolve; }); }
      return snapshot;
    };
    const stale = syncSubscription({ env: f.env, stripe: f.stripe, subscriptionId: 'sub_test' });
    while (!captured) await new Promise(resolve => setTimeout(resolve, 0));
    f.subscriptions.get('sub_test').status = 'canceled';
    await syncSubscription({ env: f.env, stripe: f.stripe, subscriptionId: 'sub_test' }); release(); await stale;
    assert.equal((await status(f)).premiumAccess, false);
  } finally { f.db.close(); }
});
test('public plan information never exposes secrets and defaults to disabled test checkout', async () => {
  const response = await handleBillingPlansRequest({ env: {}, request: new Request('https://feeveto.example/api/billing/plans') });
  const body = await response.json(); assert.equal(body.available, false); assert.equal(body.mode, 'test');
  assert.deepEqual(body.plans.map(p => p.amountMinor), [299, 4999]); assert.ok(!JSON.stringify(body).includes('STRIPE'));
});
