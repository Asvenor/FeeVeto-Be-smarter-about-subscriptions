import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createStripeClient } from '../functions/_shared/stripe-client.js';

// Explicit integration test, never part of npm test. Uses real Stripe sandbox
// APIs and signed CLI forwarding to the unchanged local Worker. No auth stub.
const prepareCheckout = process.argv[2] === '--prepare-monthly-checkout';
if (!prepareCheckout && process.argv[2] !== '--run-sandbox') throw new Error('Explicitly choose --run-sandbox or --prepare-monthly-checkout after reviewing this script.');
const directory = '.private/billing-sandbox', root = 'http://127.0.0.1:8790';
const settings = parseEnv(await readFile(`${directory}/runtime.env`, 'utf8'));
const preview = parseEnv(await readFile(`${directory}/preview.env`, 'utf8'));
const setup = JSON.parse(await readFile(`${directory}/setup.json`, 'utf8'));
const user = JSON.parse(await readFile(`${directory}/test-user.json`, 'utf8'));
assert.equal(settings.BILLING_MODE, 'test');
assert.equal(user.externalId, 'feeveto-billing-sandbox-v1');
assert.ok(preview.CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_'));
const clerkHost = Buffer.from(preview.CLERK_PUBLISHABLE_KEY.slice('pk_test_'.length), 'base64').toString().replace(/\$$/, '');
assert.ok(clerkHost.endsWith('.clerk.accounts.dev'));
const stripe = createStripeClient(settings), steps = [], subscriptions = [], checkouts = [];
const runId = `feeveto-billing-${crypto.randomUUID()}`;
let stage = 'sandbox identity', customerId, token, tokenUntil = 0, devClient, clerkSessionId;
const report = { runId, startedAt: new Date().toISOString(), mode: 'test', kind: prepareCheckout ? 'checkout-handoff' : 'api-verification', steps, resources: { subscriptions, checkouts },
  limitations: ['Hosted Checkout payment completion, browser/mobile interaction and calendar-month test-clock renewal are not covered by this API run.'] };
function mark(name) { steps.push({ name, passed: true }); console.log(`PASS: ${name}`); }
async function clerkApi(path, data = {}) {
  const url = new URL(`https://${clerkHost}/v1/${path}`);
  if (devClient) url.searchParams.set('__clerk_db_jwt', devClient);
  const response = await fetch(url, { method: 'POST', headers: { Origin: root, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Development sign-in API failed (${response.status}).`);
  return response.json();
}
async function getToken() {
  if (token && Date.now() < tokenUntil) return token;
  if (!clerkSessionId) {
    // Clerk's Backend API session tokens omit azp and are correctly rejected
    // by this app. Use the documented public development sign-in API instead;
    // no browser state, custom JWT template or relaxed verification is used.
    devClient = (await clerkApi('dev_browser')).id;
    assert.ok(devClient);
    const raw = execFileSync('npx', ['-y', 'clerk@latest', 'api', '/sign_in_tokens', '-d',
      JSON.stringify({ user_id: user.userId, expires_in_seconds: 60 }),
      '--app', 'app_3IxBTR7IHayTnEm7oToPCrk8yNL', '--instance', 'ins_3IxBTTlpepCSsqN31SCskV1uNr1', '--yes'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    const signedIn = await clerkApi('client/sign_ins', { strategy: 'ticket', ticket: JSON.parse(raw).token });
    assert.equal(signedIn.response?.status, 'complete');
    const session = signedIn.client?.sessions?.find(s => s.user?.id === user.userId && s.status === 'active');
    assert.ok(session); clerkSessionId = session.id; token = session.last_active_token?.jwt;
  } else {
    const refreshed = await clerkApi(`client/sessions/${clerkSessionId}/tokens`);
    token = refreshed.jwt || refreshed.response?.jwt;
  }
  if (!token) throw new Error('Development token was not returned.');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(claims.azp, root); assert.equal(claims.sub, user.userId); assert.equal(claims.sid, clerkSessionId);
  tokenUntil = Date.now() + 40_000;
  return token;
}
async function api(path, method = 'GET', signedIn = true) {
  const response = await fetch(root + path, { method, headers: signedIn ? { Authorization: `Bearer ${await getToken()}` } : {}, signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.json() };
}
async function until(predicate, label) {
  stage = label;
  for (let i = 0; i < 40; i++) {
    const state = await api('/api/billing/status');
    if (state.status === 200 && predicate(state.body)) return state.body;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Webhook state did not settle.');
}
async function checkout(plan) {
  const result = await api(`/api/billing/checkout?plan=${plan}&currency=USD`, 'POST');
  assert.equal(result.status, 201);
  const list = await stripe.checkout.sessions.list({ limit: 100 });
  const matches = list.data.filter(s => s.client_reference_id === user.userId && s.url === result.body.checkoutUrl);
  assert.equal(matches.length, 1);
  const object = matches[0]; assert.equal(object.livemode, false); assert.equal(object.metadata.plan, plan);
  assert.equal(object.amount_total, plan === 'monthly' ? 299 : 4999); assert.equal(object.currency, 'usd');
  if (customerId) assert.equal(object.customer, customerId); else customerId = object.customer;
  checkouts.push(object.id);
  return object;
}
try {
  assert.equal((await stripe.accounts.retrieve()).id, setup.accountId);
  const plans = await api('/api/billing/plans', 'GET', false);
  assert.equal(plans.body.mode, 'test'); assert.equal(plans.body.available, true);
  mark('Correct sandbox and local test-only configuration');
  if (prepareCheckout) {
    stage = 'manual monthly test checkout';
    const monthly = await checkout('monthly');
    assert.equal(monthly.mode, 'subscription');
    report.preparedCheckout = { sessionId: monthly.id, url: monthly.url, expiresAt: monthly.expires_at };
    mark('Unpaid monthly sandbox Checkout prepared for manual browser testing');
  } else {
  stage = 'signed-out restrictions';
  assert.equal((await api('/api/access', 'GET', false)).body.premiumAccess, false);
  assert.equal((await api('/api/billing/checkout?plan=monthly&currency=USD', 'POST', false)).status, 401);
  mark('Signed-out audit access stays ordinary; checkout requires login');
  stage = 'Clerk-authenticated ordinary access';
  const access = await api('/api/access'); assert.equal(access.status, 200);
  assert.equal(access.body.authenticated, true); assert.equal(access.body.isAdmin, false); assert.equal(access.body.betaAccess, false);
  assert.equal(access.body.premiumAccess, false);
  mark('Real Clerk session is verified as an ordinary unpaid account');
  stage = 'monthly Checkout creation';
  const monthly = await checkout('monthly');
  assert.equal(monthly.mode, 'subscription');
  const repeats = await Promise.all([api('/api/billing/checkout?plan=monthly&currency=USD', 'POST'), api('/api/billing/checkout?plan=monthly&currency=USD', 'POST')]);
  assert.ok(repeats.every(r => r.status === 201 && r.body.checkoutUrl === monthly.url));
  assert.equal((await api('/api/billing/checkout?plan=lifetime&currency=USD', 'POST')).status, 409);
  assert.equal((await api('/api/access')).body.premiumAccess, false);
  mark('Actual $2.99 Checkout is reused on duplicate attempts and cannot grant unpaid access');
  await stripe.checkout.sessions.expire(monthly.id);
  stage = 'lifetime Checkout creation';
  const lifetime = await checkout('lifetime'); assert.equal(lifetime.mode, 'payment');
  assert.equal((await api('/api/access')).body.premiumAccess, false);
  mark('Actual $49.99 one-time Checkout uses the same customer and stays unpaid before completion');
  await stripe.checkout.sessions.expire(lifetime.id);
  stage = 'paid monthly subscription event';
  const card = await stripe.paymentMethods.attach('pm_card_visa', { customer: customerId });
  const metadata = { clerk_user_id: user.userId, product_key: 'feeveto_premium_monthly', application: 'feeveto', test_run: runId };
  let sub = await stripe.subscriptions.create({ customer: customerId, items: [{ price: setup.prices.monthly, quantity: 1 }],
    default_payment_method: card.id, payment_behavior: 'error_if_incomplete', metadata }, { idempotencyKey: `${runId}:subscription` });
  subscriptions.push(sub.id); assert.equal(sub.livemode, false); assert.equal(sub.status, 'active');
  const invoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice.id;
  const paid = await until(s => s.subscriptionAccess, 'signed paid-invoice fulfillment');
  assert.equal((await api('/api/access')).body.paidPremiumAccess, true);
  mark('Stripe-paid monthly invoice reaches the Worker through a real signed webhook and grants access');
  stage = 'customer portal';
  const portal = await api('/api/billing/portal', 'POST'); assert.equal(portal.status, 200);
  assert.equal(new URL(portal.body.portalUrl).hostname, 'billing.stripe.com');
  mark('Authenticated account gets a real Stripe billing-portal session');
  await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
  const cancelling = await until(s => s.subscription?.cancelAtPeriodEnd, 'period-end cancellation');
  assert.equal(cancelling.subscriptionAccess, true); assert.equal(cancelling.subscription.paidThrough, paid.subscription.paidThrough);
  mark('Period-end cancellation preserves the already paid access period');
  stage = 'full monthly refund';
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 });
  const payment = payments.data.find(p => p.status === 'paid' && p.payment.type === 'payment_intent');
  assert.ok(payment?.payment.payment_intent);
  await stripe.refunds.create({ payment_intent: typeof payment.payment.payment_intent === 'string' ? payment.payment.payment_intent : payment.payment.payment_intent.id }, { idempotencyKey: `${runId}:refund` });
  await until(s => !s.subscriptionAccess, 'full-refund revocation');
  mark('Real full-refund notification removes the matching paid period');
  await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
  await until(s => !s.subscriptionAccess && s.subscription?.status === 'canceled', 'refunded subscription cleanup');
  // A fresh paid subscription proves a later purchase can restore access. It
  // is deliberately not reported as a calendar renewal: resetting an anchor
  // with no proration did not issue a new invoice in this sandbox.
  stage = 'new paid subscription after refund';
  sub = await stripe.subscriptions.create({ customer: customerId, items: [{ price: setup.prices.monthly, quantity: 1 }],
    default_payment_method: card.id, payment_behavior: 'error_if_incomplete', metadata }, { idempotencyKey: `${runId}:repurchase` });
  subscriptions.push(sub.id);
  await until(s => s.subscriptionAccess, 'new paid-invoice fulfillment');
  assert.notEqual(typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice.id, invoiceId);
  mark('A new paid sandbox subscription restores access after an earlier purchase was refunded');
  await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
  await until(s => !s.subscriptionAccess && s.subscription?.status === 'canceled', 'terminal cancellation');
  mark('Actual subscription cancellation removes monthly access');
  stage = 'declined test payment';
  const declined = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: customerId });
  const failed = await stripe.subscriptions.create({ customer: customerId, items: [{ price: setup.prices.monthly, quantity: 1 }],
    default_payment_method: declined.id, payment_behavior: 'allow_incomplete', metadata }, { idempotencyKey: `${runId}:declined` });
  subscriptions.push(failed.id); assert.equal(failed.status, 'incomplete');
  await until(s => s.subscription?.status === 'incomplete' && !s.premiumAccess, 'failed-payment rejection');
  mark('A real declined sandbox payment cannot grant Premium');
  }
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = { stage, type: error.type || error.name, code: error.code || null };
  console.log(JSON.stringify({ failed: report.failure })); process.exitCode = 1;
} finally {
  // Only objects created by this run are cleaned up. No existing customers,
  // purchases, user records or application data are deleted.
  for (const id of subscriptions) {
    try {
      const sub = await stripe.subscriptions.retrieve(id);
      if (sub.metadata.test_run === runId && sub.customer === customerId && !['canceled', 'incomplete_expired'].includes(sub.status)) await stripe.subscriptions.cancel(id, { prorate: false, invoice_now: false });
    } catch { report.cleanupNeedsAttention = true; }
  }
  for (const id of checkouts) {
    if (report.passed && report.preparedCheckout?.sessionId === id) continue;
    try {
      const object = await stripe.checkout.sessions.retrieve(id);
      if (object.client_reference_id === user.userId && object.status === 'open') await stripe.checkout.sessions.expire(id);
    } catch { report.cleanupNeedsAttention = true; }
  }
  if (clerkSessionId) {
    try { await clerkApi(`client/sessions/${clerkSessionId}/end`); }
    catch { report.cleanupNeedsAttention = true; }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(`${directory}/api-verification-${runId}.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, steps: steps.length, reportRunId: runId, cleanupNeedsAttention: Boolean(report.cleanupNeedsAttention) }));
}
