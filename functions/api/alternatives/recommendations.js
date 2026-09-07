import { resolveAccess } from '../../_shared/access-policy.js';
import { getVerifiedAccess } from '../../_shared/clerk-access.js';
import { selectRecommendations } from '../../_shared/alternatives.js';
import { CatalogueConfigurationError, loadPrivateCatalogue } from '../../_shared/catalogue-store.js';
import { json, methodNotAllowed } from '../../_shared/http.js';

async function requestAccess(context, accessResolver) {
  if (!context.request.headers.get('authorization')) return resolveAccess();
  try {
    return await accessResolver(context);
  } catch {
    return resolveAccess();
  }
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
    query = await context.request.json();
  } catch {
    return json({ error: 'A valid JSON request is required.' }, { status: 400 });
  }
  try {
    const [access, catalogue] = await Promise.all([requestAccess(context, accessResolver), catalogueLoader(context)]);
    return json(selectRecommendations(catalogue, query, { premiumAccess: access.premiumAccess }));
  } catch (error) {
    if (error instanceof CatalogueConfigurationError) {
      return json({ state: 'catalogue_unavailable', error: 'The alternatives catalogue is not configured or is unavailable.' }, { status: 503 });
    }
    return json({ state: 'request_failed', error: 'Alternatives could not be loaded. Try again.' }, { status: 503 });
  }
}

export const onRequest = handleRecommendationsRequest;
