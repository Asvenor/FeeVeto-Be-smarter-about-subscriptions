import { json } from './http.js';

const BASELINE_CSP = "base-uri 'self'; object-src 'none'; frame-ancestors 'none'";
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const READ_ONLY_POSTS = new Set(['/api/assessment', '/api/alternatives/recommendations']);

export function secureResponse(response) {
  // Preserve status, streaming bodies, cookies and asset caching. These directives
  // do not restrict Clerk scripts, images, connections or its embedded challenges.
  const headers = new Headers(response.headers);
  headers.append('Content-Security-Policy', BASELINE_CSP);
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function protectApiRequest(request, env) {
  const url = new URL(request.url);
  // Stripe authenticates its raw request with a signature; it is neither a browser
  // mutation nor a visitor. Feedback already has its own stricter privacy boundary.
  if (url.pathname === '/api/billing/webhook' || url.pathname === '/api/events') return null;
  const origin = request.headers.get('Origin');
  if ((origin !== null && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return json({ error: 'Open FeeVeto directly to use this feature.', code: 'same_origin_required' }, { status: 403 });
  }

  const bindings = [env?.FEEVETO_API_LIMIT];
  if (WRITE_METHODS.has(request.method) && !READ_ONLY_POSTS.has(url.pathname)) bindings.push(env?.FEEVETO_WRITE_LIMIT);
  // Cloudflare supplies this header. Never substitute a client-supplied forwarded
  // IP, account ID, token or request-body field. Missing IPs share a bounded bucket.
  // Keys are used only by the short-lived limiter, never analytics or logs. Limits
  // are approximate and per Cloudflare location, not a global/per-account quota.
  const key = request.headers.get('CF-Connecting-IP') || 'unknown-client';
  try {
    for (const binding of bindings) {
      if (typeof binding?.limit !== 'function') throw new Error('Limiter unavailable');
      const result = await binding.limit({ key });
      if (typeof result?.success !== 'boolean') throw new Error('Invalid limiter response');
      if (!result.success) {
        return json({ error: 'Too many requests. Wait a minute, then retry. Your saved data and current answers are unchanged.', code: 'rate_limited' },
          { status: 429, headers: { 'Retry-After': '60' } });
      }
    }
  } catch {
    return json({ error: 'This feature is temporarily unavailable. Your answers are kept; please retry shortly.', code: 'request_protection_unavailable' },
      { status: 503, headers: { 'Retry-After': '60' } });
  }
  return null;
}

export function unexpectedRequestError(operation) {
  const requestId = crypto.randomUUID();
  // A support reference is useful without logging URLs, user identifiers, raw
  // request bodies, tokens, environment values or dependency exception messages.
  console.error(JSON.stringify({ event: 'unexpected_request_failure', operation, requestId }));
  return json({ error: 'FeeVeto could not complete this request. Please retry shortly.', code: 'request_failed', requestId },
    { status: 503, headers: { 'X-Request-Id': requestId, 'Retry-After': '60' } });
}
