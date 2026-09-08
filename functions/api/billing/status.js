import { getVerifiedIdentity } from '../../_shared/clerk-access.js';
import { getBillingStatus } from '../../_shared/billing-store.js';
import { resolveAccess } from '../../_shared/access-policy.js';
import { json, methodNotAllowed } from '../../_shared/http.js';
export async function handleBillingStatusRequest(context, { identityResolver = getVerifiedIdentity } = {}) {
  if (context.request.method !== 'GET') return methodNotAllowed();
  try {
    const identity = await identityResolver(context);
    if (!identity) return json({ error: 'Sign in to view billing.' }, { status: 401 });
    const status = await getBillingStatus({ env: context.env, userId: identity.userId });
    const complimentary = resolveAccess({ authenticated: true, privateMetadata: identity.user?.privateMetadata });
    return json({ ...status, complimentaryAccess: complimentary.premiumAccess });
  } catch { return json({ error: 'Billing status is temporarily unavailable. Retry without making another purchase.' }, { status: 503 }); }
}
export const onRequest = handleBillingStatusRequest;
