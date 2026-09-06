import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccess } from '../functions/_shared/access-policy.js';
import { normalizeServerAccess, ORDINARY_ACCESS } from '../js/access.js';

test('signed-out and missing metadata default to ordinary unpaid access', () => {
  assert.deepEqual(resolveAccess(), ORDINARY_ACCESS);
  assert.deepEqual(resolveAccess({ authenticated: true }), {
    authenticated: true,
    role: 'user',
    betaAccess: false,
    isAdmin: false,
    complimentaryPremiumAccess: false,
    paidPremiumAccess: false,
    premiumAccess: false,
  });
});
test('ordinary user metadata does not grant complimentary access', () => {
  assert.deepEqual(resolveAccess({ authenticated: true, privateMetadata: { role: 'user', betaAccess: false } }), {
    authenticated: true,
    role: 'user',
    betaAccess: false,
    isAdmin: false,
    complimentaryPremiumAccess: false,
    paidPremiumAccess: false,
    premiumAccess: false,
  });
});

test('beta tester receives premium without admin privileges', () => {
  const access = resolveAccess({ authenticated: true, privateMetadata: { role: 'user', betaAccess: true } });
  assert.equal(access.premiumAccess, true);
  assert.equal(access.complimentaryPremiumAccess, true);
  assert.equal(access.isAdmin, false);
});

test('admin receives premium and admin privileges even without beta flag', () => {
  const access = resolveAccess({ authenticated: true, privateMetadata: { role: 'admin', betaAccess: false } });
  assert.equal(access.premiumAccess, true);
  assert.equal(access.complimentaryPremiumAccess, true);
  assert.equal(access.isAdmin, true);
});

test('paid access is a separate server-controlled entitlement', () => {
  const access = resolveAccess({
    authenticated: true,
    privateMetadata: { role: 'user', betaAccess: false },
    paidPremiumAccess: true,
  });
  assert.equal(access.complimentaryPremiumAccess, false);
  assert.equal(access.paidPremiumAccess, true);
  assert.equal(access.premiumAccess, true);
});

test('invalid private metadata and malformed client payloads fail closed', () => {
  const invalid = resolveAccess({ authenticated: true, privateMetadata: { role: 'owner', betaAccess: 'true' } });
  assert.equal(invalid.premiumAccess, false);
  assert.equal(invalid.isAdmin, false);
  assert.deepEqual(normalizeServerAccess({ authenticated: false, role: 'admin', isAdmin: true, betaAccess: true }), ORDINARY_ACCESS);
});
