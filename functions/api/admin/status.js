import { AccessConfigurationError, getVerifiedAccess } from '../../_shared/clerk-access.js';
import { json, methodNotAllowed } from '../../_shared/http.js';

export async function handleAdminStatusRequest(context, { accessResolver = getVerifiedAccess } = {}) {
  if (context.request.method !== 'GET') return methodNotAllowed();

  try {
    const access = await accessResolver(context);
    if (!access.authenticated) return json({ error: 'Sign in required.' }, { status: 401 });
    if (!access.isAdmin) return json({ error: 'Admin access required.' }, { status: 403 });

    return json({ adminAccess: true });
  } catch (error) {
    if (error instanceof AccessConfigurationError) {
      return json({ error: 'Admin access is not configured.' }, { status: 503 });
    }
    return json({ error: 'Admin access could not be verified.' }, { status: 503 });
  }
}

export const onRequest = handleAdminStatusRequest;
