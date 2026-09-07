import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeAuth } from '../js/auth.js';

test('account UI clears verified status on account switch and ignores stale access after sign-out', async () => {
  const original = { window: globalThis.window, document: globalThis.document, key: globalThis.__FEEVETO_CLERK_PUBLISHABLE_KEY__ };
  const elements = new Map();
  const listeners = {};
  const mounts = [];
  const pending = [];
  const events = [];
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const node = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: true, textContent: '', style: { setProperty() {} }, toggleAttribute(name, value) { this[name] = value; }, addEventListener() {} });
    return elements.get(id);
  };
  const clerk = {
    isSignedIn: true, user: { id: 'admin-test', hasImage: false, firstName: 'Test' },
    session: { id: 'session-1', getToken: async () => 'test-token' },
    load: async (options) => mounts.push(options),
    mountUserButton: (_node, options) => mounts.push(options), unmountUserButton() {},
    addListener: (listener) => { listeners.auth = listener; },
  };
  try {
    globalThis.__FEEVETO_CLERK_PUBLISHABLE_KEY__ = `pk_test_${btoa('local.clerk.accounts.dev$')}`;
    globalThis.window = { atob, Clerk: clerk, __internal_ClerkUICtor: {}, fetch: () => new Promise((resolve) => pending.push(resolve)) };
    globalThis.document = { getElementById: node, addEventListener(name, listener) { listeners[name] = listener; }, visibilityState: 'visible' };
    await initializeAuth({ onAccessChange: (access) => events.push(access) });
    await tick();
    assert.equal(node('access-badge').hidden, true, 'No entitlement flash before verification');
    pending.shift()(Response.json({ authenticated: true, role: 'admin', isAdmin: true }));
    await tick();
    assert.equal(node('access-badge').textContent, 'Owner access');
    assert.equal(events.at(-1).premiumAccess, true);
    assert.equal(mounts[1].userProfileProps.appearance.variables.colorPrimary, '#16673d');
    assert.equal(node('user-button')['data-generated-avatar'], true);

    clerk.user = { id: 'ordinary-test', hasImage: true };
    clerk.session.id = 'session-2';
    listeners.auth();
    assert.equal(node('access-badge').hidden, true);
    assert.equal(events.at(-1).premiumAccess, false);
    assert.equal(node('user-button')['data-generated-avatar'], false, 'Uploaded photos untouched');
    await tick();
    clerk.isSignedIn = false;
    listeners.auth();
    pending.shift()(Response.json({ authenticated: true, role: 'user', betaAccess: true }));
    await tick();
    assert.equal(node('access-badge').hidden, true);
    assert.equal(events.at(-1).premiumAccess, false, 'Late beta response cannot restore signed-out privileges');
    assert.equal(node('signed-out-controls').hidden, false);
  } finally {
    globalThis.window = original.window;
    globalThis.document = original.document;
    globalThis.__FEEVETO_CLERK_PUBLISHABLE_KEY__ = original.key;
  }
});
