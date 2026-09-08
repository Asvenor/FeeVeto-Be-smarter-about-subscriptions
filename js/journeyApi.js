import {
  AlternativeRequestError,
  normalizeAlternativesResponse,
} from "./alternativeProvider.js";
import { journeySubmission } from "./journeyModel.js";

export async function journeySession(getClerk, { timeoutMs = 12000 } = {}) {
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const clerk = await getClerk();
        let token = '';
        try { token = (await clerk?.session?.getToken?.()) || ''; }
        catch { throw new Error('Sign-in verification is temporarily unavailable. Your answers are kept; retry or sign in again.'); }
        return {
          clerk,
          user: clerk?.user?.id || "",
          token,
        };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Sign-in verification took too long. Your answers are kept; retry.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetch(fetchImplementation, url, options) {
  try { return await fetchImplementation(url, options); }
  catch (error) {
    if (error?.name === 'AbortError') throw error; // superseded requests stay silent
    throw new Error(error?.name === 'TimeoutError'
      ? 'The request took too long. Your answers are kept; retry in a moment.'
      : 'Could not connect to FeeVeto. Your answers are kept; check your connection and retry.');
  }
}

export async function journeyRequest(
  path,
  { token = "", body, signal, fetchImplementation = globalThis.fetch } = {},
) {
  const response = await safeFetch(fetchImplementation, `./api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body
      ? {
          body: JSON.stringify(
            body.draft
              ? { ...body, draft: journeySubmission(body.draft) }
              : body,
          ),
        }
      : {}),
    signal: signal || AbortSignal.timeout(15000),
    credentials: "same-origin",
    cache: "no-store",
  });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) {
    const error = new Error(
      value?.error ||
        "The request could not be completed. Your answers are kept; retry.",
    );
    error.status = response.status;
    throw error;
  }
  return value;
}

export async function requestJourneyAlternatives(
  query,
  token = "",
  { signal, fetchImplementation = globalThis.fetch } = {},
) {
  const response = await safeFetch(fetchImplementation,
    "./api/alternatives/recommendations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(query),
      signal: signal || AbortSignal.timeout(15000),
      credentials: "same-origin",
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new AlternativeRequestError(
      body?.error || "Suggestions could not be loaded. Try again.",
      body?.state,
    );
  return normalizeAlternativesResponse(body, 12);
}
