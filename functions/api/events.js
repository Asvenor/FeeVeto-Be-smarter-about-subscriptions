import { json, methodNotAllowed } from '../_shared/http.js';
import { readJourneyBody, JourneyError } from '../_shared/journey-service.js';
import { safeProductEvent } from '../../js/telemetrySchema.js';

export async function handleProductEvent({ request, env }) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site' || url.search) return json({ error: 'Same-origin events only.' }, { status: 403 });
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return json({ accepted: false, reason: 'privacy_preference' });
  if (env?.PRODUCT_ANALYTICS_ENABLED !== 'true' || !env?.FEEVETO_EVENTS?.writeDataPoint || !env?.FEEVETO_EVENT_LIMIT?.limit) return json({ error: 'Feedback and measurement are temporarily unavailable.' }, { status: 503 });
  try {
    const data = safeProductEvent(await readJourneyBody(request, { limit: 1024 }));
    if (!data) return json({ error: 'Only approved, non-sensitive event fields are accepted.' }, { status: 400 });
    // IP is used only by Cloudflare's short-lived rate limiter; it is never an
    // analytics field or log value. There is no user/account/session identifier.
    const limit = await env.FEEVETO_EVENT_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'local' });
    if (!limit.success) return json({ error: 'Please try again later.' }, { status: 429, headers: { 'Retry-After': '60' } });
    env.FEEVETO_EVENTS.writeDataPoint({ indexes: [data.event], doubles: [1], blobs: [data.event, data.serviceId, data.intent, data.surface, data.count, data.helpful, data.reason, data.returning] });
    return json({ accepted: true });
  } catch (error) {
    return json({ error: error instanceof JourneyError ? 'Send a small JSON event.' : 'Feedback could not be recorded. Retry when connected.' }, { status: error instanceof JourneyError ? error.status : 503 });
  }
}
