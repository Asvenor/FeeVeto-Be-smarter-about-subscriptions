import { AlternativeRequestError, normalizeAlternativesResponse } from './alternativeProvider.js';

export async function journeyRequest(path, {token='',body,signal,fetchImplementation=globalThis.fetch}={}) {
  const response=await fetchImplementation(`./api/${path}`,{method:body?'POST':'GET',
    headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:signal || AbortSignal.timeout(15000),credentials:'same-origin',cache:'no-store'});
  const value=await response.json().catch(()=>null);
  if(!response.ok || !value){const error=new Error(value?.error || 'The request could not be completed. Your answers are kept; retry.');error.status=response.status;throw error;}
  return value;
}

export async function requestJourneyAlternatives(query, token = '', { signal, fetchImplementation = globalThis.fetch } = {}) {
  const response = await fetchImplementation('./api/alternatives/recommendations', {
    method: 'POST', headers: { 'Content-Type':'application/json', Accept:'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) },
    body: JSON.stringify(query), signal: signal || AbortSignal.timeout(15000), credentials:'same-origin', cache:'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new AlternativeRequestError(body?.error || 'Suggestions could not be loaded. Try again.', body?.state);
  return normalizeAlternativesResponse(body, 12);
}
