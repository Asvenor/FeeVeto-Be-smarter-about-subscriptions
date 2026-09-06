import { AccessConfigurationError, getVerifiedAccess } from '../../_shared/clerk-access.js';
import { json, methodNotAllowed } from '../../_shared/http.js';

export async function handlePremiumStatusRequest(context, { accessResolver = getVerifiedAccess } = {}) {
  if (context.request.method !== 'GET') return methodNotAllowed();

  try {
    const access = await accessResolver(context);
    if (!access.authenticated) return json({ error: 'Sign in required.' }, { status: 401 });
    if (!access.premiumAccess) return json({ error: 'Premium access required.' }, { status: 403 });

    return json({
      premiumAccess: true,
      complimentaryPremiumAccess: access.complimentaryPremiumAccess,
      paidPremiumAccess: access.paidPremiumAccess,
    });
  } catch (error) {
    if (error instanceof AccessConfigurationError) {
      return json({ error: 'Premium access is not configured.' }, { status: 503 });
    }
    return json({ error: 'Premium access could not be verified.' }, { status: 503 });
  }
}

export const onRequest = handlePremiumStatusRequest;
