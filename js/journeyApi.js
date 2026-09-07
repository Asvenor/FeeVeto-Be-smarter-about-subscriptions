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
        return {
          clerk,
          user: clerk?.user?.id || "",
          token: (await clerk?.session?.getToken?.()) || "",
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

export async function journeyRequest(
  path,
  { token = "", body, signal, fetchImplementation = globalThis.fetch } = {},
) {
  const response = await fetchImplementation(`./api/${path}`, {
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
  const response = await fetchImplementation(
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
