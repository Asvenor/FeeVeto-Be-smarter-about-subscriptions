import { AccessConfigurationError, getVerifiedAccess } from '../_shared/clerk-access.js';
import { json, methodNotAllowed } from '../_shared/http.js';

export async function handleAccessRequest(context, { accessResolver = getVerifiedAccess } = {}) {
  if (context.request.method !== 'GET') return methodNotAllowed();

  try {
    return json(await accessResolver(context));
  } catch (error) {
    if (error instanceof AccessConfigurationError) {
      return json({ error: 'Account access is not configured.' }, { status: 503 });
    }
    return json({ error: 'Account access could not be verified.' }, { status: 503 });
  }
}

export const onRequest = handleAccessRequest;
