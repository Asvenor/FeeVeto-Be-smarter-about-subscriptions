import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initializeAdmin } from '../js/admin.js';
import { initializeExperience } from '../js/experience.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../experience.css', import.meta.url), 'utf8');
const owner = { authenticated: true, role: 'admin', isAdmin: true, premiumAccess: true };
const ordinary = { authenticated: true, role: 'user', isAdmin: false };
const baseSettings = { revision: 0, acceptNewPurchases: false, monthlyEnabled: false, lifetimeEnabled: false };
const readyRuntime = { billingEnabled: false, stripeReady: true, billingMode: 'test' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await tick(); }
  assert.fail('The owner controller did not settle');
}

function setup({ access = null, runtime = readyRuntime, discounts = [], respond, hash = '#top' } = {}) {
  const dom = new JSDOM(html, { url: `https://feeveto.test/${hash}` }), root = dom.window.document;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const byId = id => root.getElementById(id), calls = [];
  let id = 0, clerk = { user: { id: 'owner-a' }, session: { id: 'session-a', getToken: async () => 'test-session-token' } };
  const experience = initializeExperience(root);
  const fetchImplementation = async (path, options) => {
    const call = { path, ...options, data: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    const custom = await respond?.(call);
    if (custom) return custom;
    if (path.endsWith('/settings')) return Response.json({ settings: baseSettings, runtime });
    return Response.json({ discounts, billingMode: runtime.billingMode, stripeReady: runtime.stripeReady });
  };
  const controller = initializeAdmin({ root, getAccess: () => access, getClerk: async () => clerk, fetchImplementation,
    createRequestId: () => `10000000-0000-4000-8000-${String(++id).padStart(12, '0')}` });
  const emitAccess = value => root.dispatchEvent(new dom.window.CustomEvent('feeveto:access-change', { detail: value }));
  const settle = () => waitFor(() => byId('admin-content').getAttribute('aria-busy') === 'false');
  const enterDiscount = ({ code = 'FRIENDS20', percent = '20', plan = 'both', duration = 'once' } = {}) => {
    const form = byId('admin-discount-form');
    form.elements.code.value = code; form.elements.percentOff.value = percent;
    form.elements.plan.value = plan; form.elements.duration.value = duration;
    form.elements.plan.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    return form;
  };
  return { dom, root, byId, calls, controller, experience, emitAccess, settle, enterDiscount,
    setClerk: next => { clerk = next; }, close: () => dom.window.close() };
}

test('signed-out, ordinary, beta and paid users cannot load owner controls; browser role flags do not grant access', async () => {
  for (const access of [null, ordinary, { ...ordinary, betaAccess: true, premiumAccess: true }, { ...ordinary, paidPremiumAccess: true }, { authenticated: true, adminAccess: true }, { ...ordinary, isAdmin: true }]) {
    const app = setup({ access });
    try {
      app.dom.window.localStorage.setItem('role', 'admin');
      app.dom.window.localStorage.setItem('premiumAccess', 'true');
      await tick();
      assert.equal(app.controller.allowed, false);
      assert.equal(app.byId('owner-settings-link').hidden, true);
      assert.equal(app.byId('admin-content').hidden, true);
      assert.equal(app.byId('admin-settings-fields').disabled, true);
      assert.equal(app.byId('admin-discount-fields').disabled, true);
      app.byId('admin-settings-form').requestSubmit();
      app.enterDiscount().requestSubmit();
      await tick();
      assert.equal(app.calls.length, 0);
    } finally { app.close(); }
  }
});

test('an owner deep link survives initial ordinary access while Clerk loads, then opens only verified controls', async () => {
  const app = setup({ hash: '#owner-settings' });
  try {
    assert.equal(app.experience.current, 'admin');
    assert.equal(app.dom.window.location.hash, '#owner-settings');
    assert.equal(app.byId('admin-content').hidden, true);
    assert.match(app.byId('admin-access-message').textContent, /Owner access is required/);
    app.emitAccess(ordinary); await tick();
    assert.equal(app.calls.length, 0);
    assert.equal(app.experience.current, 'admin');
    assert.equal(app.byId('admin-content').hidden, true);
    app.emitAccess(owner); await app.settle();
    assert.equal(app.experience.current, 'admin');
    assert.equal(app.dom.window.location.hash, '#owner-settings');
    assert.equal(app.byId('admin-content').hidden, false);
    assert.equal(app.byId('owner-settings-link').getAttribute('aria-current'), 'page');
    app.emitAccess(ordinary);
    assert.equal(app.byId('admin-content').hidden, true);
    assert.equal(app.experience.current, 'discover');
    assert.equal(app.dom.window.location.hash, '#top');
  } finally { app.close(); }
});

test('verified owner gets a separate workspace and authenticated same-origin reads without changing settings', async () => {
  const app = setup({ access: owner });
  try {
    await app.settle();
    assert.equal(app.byId('owner-settings-link').hidden, false);
    assert.equal(app.byId('admin-content').hidden, false);
    assert.equal(app.byId('admin-accept-purchases').checked, false);
    assert.match(app.byId('admin-runtime-status').textContent, /Paused/);
    assert.equal(app.root.querySelectorAll('.experience-nav a').length, 3);
    app.byId('owner-settings-link').click();
    assert.equal(app.experience.current, 'admin');
    assert.equal(app.root.activeElement.id, 'owner-title');
    assert.equal(app.byId('owner-settings-link').getAttribute('aria-current'), 'page');
    assert.deepEqual(app.calls.map(call => call.method), ['GET', 'GET']);
    for (const call of app.calls) {
      assert.equal(call.credentials, 'same-origin'); assert.equal(call.cache, 'no-store');
      assert.equal(call.headers.Authorization, 'Bearer test-session-token');
      assert.ok(call.path.startsWith('./api/admin/')); assert.equal(call.body, undefined);
    }
  } finally { app.close(); }
});

test('changing purchase switches is not persisted until explicit save and retains the revision', async () => {
  let publicRefresh = 0;
  const app = setup({ access: owner, respond: call => call.method === 'PUT'
    ? Response.json({ settings: { ...call.data, revision: 1 }, runtime: readyRuntime }) : null });
  try {
    await app.settle();
    app.root.addEventListener('feeveto:owner-settings-change', () => publicRefresh++);
    app.byId('admin-accept-purchases').click(); app.byId('admin-monthly-enabled').click();
    assert.equal(app.calls.length, 2);
    app.byId('admin-settings-form').requestSubmit(); await app.settle();
    const mutation = app.calls.find(call => call.method === 'PUT');
    assert.deepEqual(mutation.data, { revision: 0, acceptNewPurchases: true, monthlyEnabled: true, lifetimeEnabled: false });
    assert.equal(mutation.headers['Content-Type'], 'application/json');
    assert.equal(publicRefresh, 1);
    assert.match(app.byId('admin-settings-status').textContent, /still require the deployment launch gate/);
  } finally { app.close(); }
});

test('a conflicting settings save preserves choices and asks for a fresh server revision', async () => {
  const app = setup({ access: owner, respond: call => call.method === 'PUT' ? Response.json({ error: 'Conflict' }, { status: 409 }) : null });
  try {
    await app.settle(); app.byId('admin-monthly-enabled').checked = true;
    app.byId('admin-settings-form').requestSubmit(); await app.settle();
    assert.equal(app.byId('admin-monthly-enabled').checked, true);
    assert.match(app.byId('admin-settings-status').textContent, /Refresh owner settings/);
    assert.equal(app.byId('admin-settings-fields').disabled, false);
  } finally { app.close(); }
});

test('discount drafts can be saved with payments paused and no Stripe credentials; activation stays disabled', async () => {
  const app = setup({ access: owner, runtime: { billingEnabled: false, stripeReady: false, billingMode: 'test' },
    respond: call => call.method === 'POST' ? Response.json({ discount: { ...call.data, id: 'draft-1', status: 'draft', active: false, timesRedeemed: 0 } }) : null });
  try {
    await app.settle();
    assert.equal(app.byId('admin-discount-fields').disabled, false);
    app.enterDiscount().requestSubmit(); await app.settle();
    assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(app.calls.filter(call => call.method === 'PATCH').length, 0);
    assert.match(app.byId('admin-discount-list').textContent, /Draft — not redeemable/);
    assert.equal(app.byId('admin-discount-list').querySelector('button').disabled, true);
    assert.match(app.byId('admin-discount-list').textContent, /Payment setup is needed/);
    assert.equal(app.byId('admin-accept-purchases').checked, false);
    assert.match(app.byId('admin-discount-status').textContent, /not redeemable until you activate/);
  } finally { app.close(); }
});

test('failed draft save keeps answers and safely reuses request ID; changed input uses a new request', async () => {
  const app = setup({ access: owner, respond: call => call.method === 'POST' ? Promise.reject(new Error('Connection lost')) : null });
  try {
    await app.settle(); const form = app.enterDiscount();
    form.requestSubmit(); await app.settle();
    assert.equal(form.elements.code.value, 'FRIENDS20');
    assert.match(app.byId('admin-discount-status').textContent, /same request/);
    form.requestSubmit(); await app.settle();
    let writes = app.calls.filter(call => call.method === 'POST');
    assert.equal(writes[0].data.requestId, writes[1].data.requestId);
    assert.deepEqual(writes[0].data, writes[1].data);
    form.elements.percentOff.value = '25'; form.requestSubmit(); await app.settle();
    writes = app.calls.filter(call => call.method === 'POST');
    assert.notEqual(writes[1].data.requestId, writes[2].data.requestId);
  } finally { app.close(); }
});

test('activation and deactivation are explicit actions and do not reopen purchases', async () => {
  const draft = { id: 'code-1', code: 'FRIENDS20', percentOff: 20, plan: 'monthly', duration: 'once', status: 'draft', active: false, timesRedeemed: 0 };
  const app = setup({ access: owner, discounts: [draft], respond: call => call.method === 'PATCH'
    ? Response.json({ discount: { ...draft, active: call.data.action === 'activate', status: call.data.action === 'activate' ? 'active' : 'inactive' } }) : null });
  try {
    await app.settle(); assert.equal(app.calls.length, 2);
    app.byId('admin-discount-list').querySelector('button').click(); await app.settle();
    assert.deepEqual(app.calls.at(-1).data, { id: 'code-1', action: 'activate' });
    assert.match(app.byId('admin-discount-list').textContent, /Active for new uses/);
    app.byId('admin-discount-list').querySelector('button').click(); await app.settle();
    assert.deepEqual(app.calls.at(-1).data, { id: 'code-1', active: false });
    assert.match(app.byId('admin-discount-list').textContent, /Inactive/);
    assert.equal(app.byId('admin-accept-purchases').checked, false);
    assert.match(app.byId('admin-load-status').textContent, /Existing subscription discounts are unchanged/);
  } finally { app.close(); }
});

test('a failed deactivation remains retryable after refresh, even without Stripe readiness', async () => {
  let discount = { id: 'code-1', code: 'FRIENDS20', percentOff: 20, plan: 'monthly', duration: 'once', status: 'active', active: true };
  let attempts = 0;
  const app = setup({ access: owner, runtime: { ...readyRuntime, stripeReady: false }, respond: call => {
    if (call.method === 'GET' && call.path.endsWith('/discounts')) return Response.json({ discounts: [discount] });
    if (call.method === 'PATCH') {
      attempts++;
      discount = { ...discount, active: false, status: attempts === 1 ? 'deactivating' : 'inactive' };
      return attempts === 1 ? Response.json({ error: 'Stripe could not be reached.' }, { status: 503 }) : Response.json({ discount });
    }
    return null;
  } });
  try {
    await app.settle(); app.byId('admin-discount-list').querySelector('button').click(); await app.settle();
    assert.match(app.byId('admin-load-status').textContent, /Deactivation is not confirmed/);
    app.byId('admin-refresh').click(); await app.settle();
    assert.match(app.byId('admin-discount-list').textContent, /Deactivation pending/);
    const retry = app.byId('admin-discount-list').querySelector('button');
    assert.equal(retry.textContent, 'Retry deactivation'); assert.equal(retry.disabled, false);
    retry.click(); await app.settle();
    assert.equal(attempts, 2);
    assert.deepEqual(app.calls.at(-1).data, { id: 'code-1', active: false });
    assert.match(app.byId('admin-discount-list').textContent, /Inactive/);
    assert.equal(app.byId('admin-discount-list').querySelector('button'), null);
  } finally { app.close(); }
});

test('unpublished drafts can be discarded without Stripe setup and without attempting activation', async () => {
  const draft = { id: 'draft-1', code: 'FRIENDS20', percentOff: 20, plan: 'both', duration: 'once', status: 'draft', active: false };
  const app = setup({ access: owner, runtime: { ...readyRuntime, stripeReady: false }, discounts: [draft], respond: call => call.method === 'PATCH'
    ? Response.json({ discount: { ...draft, status: 'inactive' } }) : null });
  try {
    await app.settle();
    const [activate, discard] = app.byId('admin-discount-list').querySelectorAll('button');
    assert.equal(activate.disabled, true); assert.equal(discard.disabled, false);
    assert.equal(discard.textContent, 'Discard draft'); discard.click(); await app.settle();
    assert.deepEqual(app.calls.at(-1).data, { id: 'draft-1', active: false });
    assert.match(app.byId('admin-load-status').textContent, /No Stripe discount was activated/);
    assert.equal(app.calls.some(call => call.data?.action === 'activate'), false);
  } finally { app.close(); }
});

test('pending activation offers both retry and stop actions; stopping is not gated by Stripe readiness', async () => {
  for (const stripeReady of [true, false]) {
    const pending = { id: 'pending-1', code: 'FRIENDS20', percentOff: 20, plan: 'both', duration: 'once', status: 'pending', active: false };
    const app = setup({ access: owner, runtime: { ...readyRuntime, stripeReady }, discounts: [pending], respond: call => call.method === 'PATCH'
      ? Response.json({ discount: { ...pending, status: 'inactive' } }) : null });
    try {
      await app.settle();
      const [retry, stop] = app.byId('admin-discount-list').querySelectorAll('button');
      assert.equal(retry.textContent, 'Retry activation'); assert.equal(retry.disabled, !stripeReady);
      assert.equal(stop.textContent, 'Stop activation'); assert.equal(stop.disabled, false);
      stop.click(); await app.settle();
      assert.deepEqual(app.calls.at(-1).data, { id: 'pending-1', active: false });
    } finally { app.close(); }
  }
});

test('Lifetime is always once-only, optional limits stay absent, invalid code and percentages do not submit', async () => {
  const app = setup({ access: owner, respond: call => call.method === 'POST'
    ? Response.json({ discount: { ...call.data, id: 'draft-1', status: 'draft', active: false } }) : null });
  try {
    await app.settle(); const form = app.enterDiscount({ code: 'bad', percent: '81' });
    form.requestSubmit(); await tick(); assert.equal(app.calls.length, 2);
    app.enterDiscount({ plan: 'lifetime', duration: 'forever' });
    assert.equal(form.elements.duration.value, 'once'); assert.equal(form.elements.duration.disabled, true);
    form.requestSubmit(); await app.settle();
    const body = app.calls.at(-1).data;
    assert.equal(body.duration, 'once'); assert.equal(body.expiresAt, undefined); assert.equal(body.maxRedemptions, undefined);
  } finally { app.close(); }
});

test('permission denial removes controls and clears discount values, even after a previously valid owner response', async () => {
  const app = setup({ access: owner, respond: call => call.method === 'POST'
    ? Response.json({ error: 'Not an admin' }, { status: 403 }) : null });
  try {
    await app.settle(); app.byId('owner-settings-link').click();
    app.enterDiscount().requestSubmit(); await app.settle();
    assert.equal(app.controller.allowed, false);
    assert.equal(app.byId('admin-content').hidden, true);
    assert.equal(app.byId('owner-settings-link').hidden, true);
    assert.equal(app.byId('admin-code').value, '');
    assert.equal(app.byId('admin-discount-list').textContent, '');
    assert.equal(app.experience.current, 'discover');
  } finally { app.close(); }
});

test('auth changes clear owner data synchronously and late account responses cannot restore it', async () => {
  let resolveSettings;
  const app = setup({ access: owner, respond: call => call.path.endsWith('/settings')
    ? new Promise(resolve => { resolveSettings = resolve; }) : null });
  try {
    await waitFor(() => resolveSettings);
    app.byId('admin-code').value = 'PRIVATECODE';
    app.emitAccess({ ...ordinary, betaAccess: true });
    assert.equal(app.byId('admin-content').hidden, true);
    assert.equal(app.byId('admin-code').value, '');
    assert.equal(app.byId('admin-runtime-status').textContent, '');
    resolveSettings(Response.json({ settings: { ...baseSettings, acceptNewPurchases: true }, runtime: readyRuntime }));
    await tick(); await tick();
    assert.equal(app.byId('admin-content').hidden, true);
    assert.equal(app.byId('admin-accept-purchases').checked, false);
    assert.equal(app.calls.length, 1);
  } finally { app.close(); }
});

test('owner refresh errors leave an explicit retry, and server code text cannot inject markup', async () => {
  let fail = true;
  const app = setup({ access: owner, discounts: [{ id: 'bad', code: '<img src=x onerror=alert(1)>', percentOff: 20, plan: 'both', duration: 'once', status: 'draft', active: false }],
    respond: call => fail && call.path.endsWith('/settings') ? Response.json({ error: 'Settings storage is unavailable.' }, { status: 503 }) : null });
  try {
    await app.settle(); assert.match(app.byId('admin-load-status').textContent, /storage is unavailable/);
    assert.equal(app.byId('admin-refresh').disabled, false); assert.equal(app.byId('admin-settings-fields').disabled, true);
    fail = false; app.byId('admin-refresh').click(); await app.settle();
    assert.equal(app.byId('admin-discount-list').querySelector('img'), null);
    assert.match(app.byId('admin-discount-list').textContent, /<img/);
    assert.equal(app.byId('admin-settings-fields').disabled, false);
  } finally { app.close(); }
});

test('owner controls have labels, keyboard-native controls, mobile grids and no fourth primary tab', () => {
  const app = setup();
  try {
    for (const input of app.byId('admin-content').querySelectorAll('input,select')) {
      assert.ok(input.labels.length > 0, `${input.id} has an accessible label`);
    }
    assert.equal(app.root.querySelectorAll('.experience-nav a').length, 3);
    assert.equal(app.byId('admin-discount-form').querySelectorAll('button[type=submit]').length, 1);
    assert.equal(app.byId('admin-settings-form').querySelectorAll('button[type=submit]').length, 1);
    assert.match(styles, /@media \(max-width: 420px\)[\s\S]*?\.admin-form-grid \{ grid-template-columns: 1fr;/);
    assert.match(app.byId('owner-settings').textContent, /does not cancel existing monthly renewals/);
    assert.ok(app.byId('premium-discount-code').labels.length > 0);
    assert.match(app.byId('premium-discount-help').textContent, /final total are confirmed by Stripe/);
  } finally { app.close(); }
});
