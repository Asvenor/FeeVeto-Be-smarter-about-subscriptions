import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessConfigurationError, authorizedPartiesFor, getVerifiedAccess } from '../functions/_shared/clerk-access.js';
import { handleAccessRequest } from '../functions/api/access.js';
import { handleAdminStatusRequest } from '../functions/api/admin/status.js';
import { handlePremiumStatusRequest } from '../functions/api/premium/status.js';

const ENVIRONMENT = Object.freeze({
  CLERK_SECRET_KEY: 'test-secret-not-a-real-key',
  CLERK_PUBLISHABLE_KEY: 'test-publishable-not-a-real-key',
  CLERK_AUTHORIZED_PARTIES: 'https://preview.feeveto.pages.dev, https://feeveto.example',
});
function context(method = 'GET', body) {
  return {
    env: ENVIRONMENT,
    request: new Request('https://feeveto.example/api/access', {
      method,
      headers: { Authorization: 'Bearer test-session-token' },
      body,
    }),
  };
}

function authenticatedClerk(privateMetadata = {}, recorder = {}) {
  return () => ({
    authenticateRequest: async (request, options) => {
      recorder.request = request;
      recorder.options = options;
      return { isAuthenticated: true, toAuth: () => ({ userId: 'user_test' }) };
    },
    users: {
      getUser: async (userId) => {
        recorder.userId = userId;
        return {
          privateMetadata,
          publicMetadata: { role: 'admin', betaAccess: true },
          unsafeMetadata: { role: 'admin', betaAccess: true },
        };
      },
    },
  });
}

function accessResolver(access) {
  return async () => access;
}

async function responseBody(response) {
  return JSON.parse(await response.text());
}

test('Cloudflare backend verifies the Clerk session and reads only private metadata', async () => {
  const recorder = {};
  const access = await getVerifiedAccess(context(), {
    clerkClientFactory: authenticatedClerk({}, recorder),
    paidAccessResolver: async () => false,
  });

  assert.equal(access.authenticated, true);
  assert.equal(access.premiumAccess, false, 'public and unsafe metadata must be ignored');
  assert.equal(access.isAdmin, false);
  assert.equal(recorder.userId, 'user_test');
  assert.equal(recorder.options.acceptsToken, 'session_token');
  assert.deepEqual(recorder.options.authorizedParties, [
    'https://feeveto.example',
    'https://preview.feeveto.pages.dev',
  ]);
});

test('authorized parties always include the Cloudflare request origin', () => {
  assert.deepEqual(
    authorizedPartiesFor(new Request('https://branch.feeveto.pages.dev/api/access'), 'https://feeveto.example'),
    ['https://branch.feeveto.pages.dev', 'https://feeveto.example'],
  );
});

test('missing backend credentials fail closed', async () => {
  await assert.rejects(
    () => getVerifiedAccess({ request: new Request('https://feeveto.example/api/access'), env: {} }),
    AccessConfigurationError,
  );
});

test('signed-out access status is ordinary and premium data requires sign-in', async () => {
  const signedOut = {
    authenticated: false,
    role: 'user',
    betaAccess: false,
    isAdmin: false,
    complimentaryPremiumAccess: false,
    paidPremiumAccess: false,
    premiumAccess: false,
  };
  const statusResponse = await handleAccessRequest(context(), { accessResolver: accessResolver(signedOut) });
  const premiumResponse = await handlePremiumStatusRequest(context(), { accessResolver: accessResolver(signedOut) });
  assert.equal(statusResponse.status, 200);
  assert.equal((await responseBody(statusResponse)).premiumAccess, false);
  assert.equal(premiumResponse.status, 401);
});

test('ordinary user cannot receive premium or admin protected responses', async () => {
  const ordinary = {
    authenticated: true,
    role: 'user',
    betaAccess: false,
    isAdmin: false,
    complimentaryPremiumAccess: false,
    paidPremiumAccess: false,
    premiumAccess: false,
  };
  assert.equal((await handlePremiumStatusRequest(context(), { accessResolver: accessResolver(ordinary) })).status, 403);
  assert.equal((await handleAdminStatusRequest(context(), { accessResolver: accessResolver(ordinary) })).status, 403);
});

test('beta tester receives premium response but not admin response', async () => {
  const beta = {
    authenticated: true,
    role: 'user',
    betaAccess: true,
    isAdmin: false,
    complimentaryPremiumAccess: true,
    paidPremiumAccess: false,
    premiumAccess: true,
  };
  assert.equal((await handlePremiumStatusRequest(context(), { accessResolver: accessResolver(beta) })).status, 200);
  assert.equal((await handleAdminStatusRequest(context(), { accessResolver: accessResolver(beta) })).status, 403);
});

test('admin receives both premium and admin protected responses', async () => {
  const admin = {
    authenticated: true,
    role: 'admin',
    betaAccess: false,
    isAdmin: true,
    complimentaryPremiumAccess: true,
    paidPremiumAccess: false,
    premiumAccess: true,
  };
  assert.equal((await handlePremiumStatusRequest(context(), { accessResolver: accessResolver(admin) })).status, 200);
  assert.equal((await handleAdminStatusRequest(context(), { accessResolver: accessResolver(admin) })).status, 200);
});

test('request bodies cannot assign access and non-GET methods are rejected', async () => {
  const response = await handlePremiumStatusRequest(
    context('POST', JSON.stringify({ role: 'admin', betaAccess: true })),
    { accessResolver: () => { throw new Error('Access resolver must not run for POST.'); } },
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});
