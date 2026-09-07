import { createClerkClient } from '@clerk/backend';
import { resolveAccess } from './access-policy.js';
import { getPaidPremiumAccess } from './billing-access.js';

export class AccessConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccessConfigurationError';
  }
}
function requiredEnvironmentValue(env, names) {
  for (const name of names) {
    const value = typeof env?.[name] === 'string' ? env[name].trim() : '';
    if (value) return value;
  }
  return '';
}

export function authorizedPartiesFor(request, configuredParties = '') {
  const requestOrigin = new URL(request.url).origin;
  const extraParties = String(configuredParties)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([requestOrigin, ...extraParties])];
}

export async function getVerifiedIdentity(
  context,
  { clerkClientFactory = createClerkClient } = {},
) {
  const secretKey = requiredEnvironmentValue(context.env, ['CLERK_SECRET_KEY']);
  const publishableKey = requiredEnvironmentValue(context.env, ['CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PUBLISHABLE_KEY']);

  if (!secretKey || !publishableKey) {
    throw new AccessConfigurationError('Clerk backend credentials are not configured.');
  }

  const clerk = clerkClientFactory({ secretKey, publishableKey });
  const requestState = await clerk.authenticateRequest(context.request, {
    acceptsToken: 'session_token',
    authorizedParties: authorizedPartiesFor(context.request, context.env?.CLERK_AUTHORIZED_PARTIES),
  });

  if (!requestState.isAuthenticated) return null;

  const auth = requestState.toAuth();
  if (!auth?.userId) return null;

  return {
    userId: auth.userId,
    user: await clerk.users.getUser(auth.userId),
  };
}

export async function getVerifiedAccess(
  context,
  { clerkClientFactory = createClerkClient, paidAccessResolver = getPaidPremiumAccess } = {},
) {
  const identity = await getVerifiedIdentity(context, { clerkClientFactory });
  if (!identity) return resolveAccess();
  const paidPremiumAccess = await paidAccessResolver({ userId: identity.userId, env: context.env });

  return resolveAccess({
    authenticated: true,
    privateMetadata: identity.user.privateMetadata,
    paidPremiumAccess,
  });
}
