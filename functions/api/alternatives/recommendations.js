import { resolveAccess } from '../../_shared/access-policy.js';
import { getVerifiedAccess } from '../../_shared/clerk-access.js';
import { curatedRecommendations } from '../../_shared/catalogue-provider.js';
import { CatalogueConfigurationError, loadPrivateCatalogue } from '../../_shared/catalogue-store.js';
import { json, methodNotAllowed } from '../../_shared/http.js';
import { readJourneyBody, JourneyError } from '../../_shared/journey-service.js';

async function requestAccess(context, accessResolver) {
  if (!context.request.headers.get('authorization')) return resolveAccess();
  let access;
  try {
    access = await accessResolver(context);
  } catch {
    throw new AuthenticationError(503, 'Account verification is unavailable. Your audit is saved; retry in a moment.');
  }
  if (!access.authenticated) throw new AuthenticationError(401, 'Your session could not be verified. Sign in again, then retry.');
  return access;
}

class AuthenticationError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function handleRecommendationsRequest(
  context,
  { accessResolver = getVerifiedAccess, catalogueLoader = loadPrivateCatalogue } = {},
) {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  const contentLength = Number(context.request.headers.get('content-length') || 0);
  if (contentLength > 12_000) return json({ error: 'Request is too large.' }, { status: 413 });
  let query;
  try {
    query = await readJourneyBody(context.request, { limit: 12000 });
  } catch (error) {
    return json({ error: 'Send a valid, bounded JSON request.' }, { status: error instanceof JourneyError ? error.status : 400 });
  }
  try {
    const access = await requestAccess(context, accessResolver);
    return json(await curatedRecommendations(context, query, access, { load: catalogueLoader }));
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return json({ state: 'authentication_failed', error: error.message }, { status: error.status });
    }
    if (error instanceof CatalogueConfigurationError) {
      return json({ state: 'catalogue_unavailable', error: 'The alternatives catalogue is not configured or is unavailable.' }, { status: 503 });
    }
    return json({ state: 'request_failed', error: 'Alternatives could not be loaded. Try again.' }, { status: 503 });
  }
}

export const onRequest = handleRecommendationsRequest;
