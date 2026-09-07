import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initializeBilling } from '../js/billing.js';
import { ORDINARY_ACCESS } from '../js/access.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const waitFor = async predicate => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.fail('Billing UI did not settle.');
};
function setup({ signedIn = true, query = '', complimentary = '' } = {}) {
  const dom = new JSDOM(html, { url: `https://feeveto.example/${query}#pricing` });
  dom.window.setTimeout = callback => setTimeout(callback, 1);
  const root = dom.window.document, calls = [], destinations = [], notices = [];
  const f = { dom, root, calls, destinations, notices, signIns: 0,
    status: { lifetimeAccess: false, subscriptionAccess: false, canManageBilling: false, subscription: null },
    accessResponse: { ...ORDINARY_ACCESS, authenticated: true, paidPremiumAccess: true },
    access: { ...ORDINARY_ACCESS, authenticated: signedIn, isAdmin: complimentary === 'admin', betaAccess: complimentary === 'beta' },
    clerk: signedIn ? { user: { id: 'user_one' }, session: { id: 'session_one', getToken: async () => 'test-session' } } : {},
  };
  f.clerk.openSignIn = () => f.signIns++;
  const fetchImplementation = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/plans')) return Response.json({ available: true, mode: 'test' });
    if (path.endsWith('/status')) { if (f.statusFetch) return f.statusFetch(); return Response.json(f.status); }
    if (path.endsWith('/access')) return Response.json(f.accessResponse);
    if (path.endsWith('/portal')) return Response.json({ portalUrl: 'https://billing.stripe.com/p/session/test' });
    if (path.includes('/checkout')) return Response.json({ checkoutUrl: 'https://checkout.stripe.com/c/pay/test' });
    throw new Error(`Unexpected request: ${path}`);
  };
  f.controller = initializeBilling({ root, getClerk: async () => f.clerk, getAccess: () => f.access,
    onVerifiedAccess: value => { f.access = value; }, notify: value => notices.push(value),
    fetchImplementation, navigate: value => destinations.push(value) });
  f.element = id => root.getElementById(id);
  f.changeAccount = () => root.dispatchEvent(new dom.window.CustomEvent('feeveto:access-change'));
  return f;
}

test('guest plan buttons sign in, retain USD prices, and leave audit answers and preference untouched', async () => {
  const f = setup({ signedIn: false }); try {
    f.dom.window.localStorage.setItem('feeveto_state_v2', 'existing-audit');
    await f.controller.ready;
    assert.equal(f.element('premium-monthly-price').textContent, '$2.99');
    assert.equal(f.element('premium-price').textContent, '$49.99');
    f.element('premium-monthly-button').click(); await waitFor(() => f.signIns === 1);
    assert.equal(f.calls.some(call => call.path.includes('/checkout')), false);
    assert.equal(f.dom.window.localStorage.getItem('feeveto_state_v2'), 'existing-audit');
    assert.match(f.element('billing-mode-notice').textContent, /No real payments/);
  } finally { f.dom.window.close(); }
});
test('ordinary users select monthly; an existing monthly user can manage or upgrade to lifetime', async () => {
  const f = setup(); try {
    await f.controller.ready; f.element('premium-monthly-button').click(); await waitFor(() => f.destinations.length === 1);
    assert.ok(f.calls.some(call => call.path.includes('plan=monthly&currency=USD')));
    f.status = { subscriptionAccess: true, canManageBilling: true, subscription: { status: 'active', paidThrough: 1900000000, cancelAtPeriodEnd: true } };
    await f.controller.refresh(); assert.match(f.element('premium-status').textContent, /renewal is cancelled/);
    f.element('premium-monthly-button').click(); await waitFor(() => f.destinations.length === 2);
    assert.match(f.destinations[1], /^https:\/\/billing.stripe.com\//);
    f.element('premium-button').click(); await waitFor(() => f.destinations.length === 3);
    assert.ok(f.calls.some(call => call.path.includes('plan=lifetime&currency=USD')));
  } finally { f.dom.window.close(); }
});
test('a success URL cannot grant access or mistake existing monthly access for a paid lifetime upgrade', async () => {
  const f = setup({ query: '?payment=success&plan=lifetime' }); try {
    f.status = { subscriptionAccess: true, lifetimeAccess: false, subscription: { status: 'active', paidThrough: 1900000000 } };
    await f.controller.ready;
    assert.match(f.element('premium-status').textContent, /confirmation is pending/);
    assert.equal(f.access.paidPremiumAccess, false); assert.equal(f.element('billing-refresh').hidden, false);
    assert.equal(f.dom.window.location.search, '');
    f.status = { ...f.status, lifetimeAccess: true, renewalCancellationPending: true };
    await f.controller.refresh(); assert.equal(f.access.paidPremiumAccess, true);
    assert.match(f.element('premium-status').textContent, /Monthly cancellation is still pending/);
    assert.equal(f.element('premium-button').disabled, true);
  } finally { f.dom.window.close(); }
});
test('unavailable access verification keeps confirmation pending and provides retry', async () => {
  const f = setup({ query: '?payment=success&plan=monthly' }); try {
    f.status = { subscriptionAccess: true, subscription: { status: 'active', paidThrough: 1900000000 } };
    f.accessResponse = ORDINARY_ACCESS;
    await f.controller.ready; assert.equal(f.access.paidPremiumAccess, false);
    assert.match(f.element('premium-status').textContent, /could not be verified/);
    assert.equal(f.element('billing-refresh').hidden, false);
    f.accessResponse = { ...ORDINARY_ACCESS, authenticated: true, paidPremiumAccess: true };
    f.element('billing-refresh').click(); await waitFor(() => f.access.paidPremiumAccess);
  } finally { f.dom.window.close(); }
});
test('late billing status from another signed-in account is discarded', async () => {
  const f = setup(); try {
    await f.controller.ready;
    let release; f.statusFetch = () => new Promise(resolve => { release = resolve; });
    const old = f.controller.refresh(); await waitFor(() => release);
    f.statusFetch = null; f.clerk.user.id = 'user_two'; f.clerk.session.id = 'session_two'; f.changeAccount();
    await f.controller.refresh(); release(Response.json({ lifetimeAccess: true, canManageBilling: true })); await old;
    assert.equal(f.element('premium-button').disabled, false);
    assert.equal(f.element('billing-manage').hidden, true);
  } finally { f.dom.window.close(); }
});
test('admin and beta users retain complimentary access and cannot accidentally purchase', async () => {
  for (const complimentary of ['admin', 'beta']) {
    const f = setup({ complimentary }); try {
      await f.controller.ready;
      assert.equal(f.element('premium-button').disabled, true); assert.equal(f.element('premium-monthly-button').disabled, true);
      assert.match(f.element('premium-status').textContent, /No purchase is needed/);
    } finally { f.dom.window.close(); }
  }
});
