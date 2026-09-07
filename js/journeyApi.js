import { AlternativeRequestError, normalizeAlternativesResponse } from './alternativeProvider.js';

export async function requestJourneyAlternatives(query, token = '', { signal, fetchImplementation = globalThis.fetch } = {}) {
  const response = await fetchImplementation('./api/alternatives/recommendations', {
    method: 'POST', headers: { 'Content-Type':'application/json', Accept:'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) },
    body: JSON.stringify(query), signal: signal || AbortSignal.timeout(15000), credentials:'same-origin', cache:'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new AlternativeRequestError(body?.error || 'Suggestions could not be loaded. Try again.', body?.state);
  return normalizeAlternativesResponse(body, 12);
}
