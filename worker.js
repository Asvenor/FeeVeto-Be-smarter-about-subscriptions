import { handleAccessRequest } from './functions/api/access.js';
import { handleAdminStatusRequest } from './functions/api/admin/status.js';
import { handleAdminSettingsRequest } from './functions/api/admin/settings.js';
import { handleAdminDiscountsRequest } from './functions/api/admin/discounts.js';
import { handleRecommendationsRequest } from './functions/api/alternatives/recommendations.js';
import { handlePremiumStatusRequest } from './functions/api/premium/status.js';
import { handleCheckoutRequest } from './functions/api/billing/checkout.js';
import { handleWebhookRequest } from './functions/api/billing/webhook.js';
import { handleBillingPlansRequest } from './functions/api/billing/plans.js';
import { handleBillingStatusRequest } from './functions/api/billing/status.js';
import { handleBillingPortalRequest } from './functions/api/billing/portal.js';
import { handleAssessmentRequest } from './functions/api/assessment.js';
import { handleAuditsRequest } from './functions/api/audits.js';
import { json } from './functions/_shared/http.js';
import { handleProductEvent } from './functions/api/events.js';
import { protectApiRequest, secureResponse, unexpectedRequestError } from './functions/_shared/request-safety.js';

const API_ROUTES = Object.freeze({
  '/api/events': handleProductEvent,
  '/api/access': handleAccessRequest,
  '/api/assessment': handleAssessmentRequest,
  '/api/audits': handleAuditsRequest,
  '/api/admin/status': handleAdminStatusRequest,
  '/api/admin/settings': handleAdminSettingsRequest,
  '/api/admin/discounts': handleAdminDiscountsRequest,
  '/api/alternatives/recommendations': handleRecommendationsRequest,
  '/api/premium/status': handlePremiumStatusRequest,
  '/api/billing/checkout': handleCheckoutRequest,
  '/api/billing/webhook': handleWebhookRequest,
  '/api/billing/plans': handleBillingPlansRequest,
  '/api/billing/status': handleBillingStatusRequest,
  '/api/billing/portal': handleBillingPortalRequest,
});

export async function handleWorkerRequest(request, env, executionContext, routes = API_ROUTES) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const handler = Object.hasOwn(routes, pathname) ? routes[pathname] : null;
  try {
    // Match the request URL only, never caller-supplied forwarding headers.
    // Keep workers.dev and local previews available for existing browser data.
    if (url.hostname === 'www.feeveto.com' || (url.hostname === 'feeveto.com' && url.protocol === 'http:')) {
      const canonical = new URL('https://feeveto.com');
      canonical.pathname = url.pathname;
      canonical.search = url.search;
      return secureResponse(Response.redirect(canonical.href, 308));
    }

    if (handler) {
      const blocked = await protectApiRequest(request, env);
      return secureResponse(blocked || await handler({
        request,
        env,
        waitUntil: executionContext?.waitUntil?.bind(executionContext),
      }));
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return secureResponse(json({ error: 'API endpoint not found.' }, { status: 404 }));
    }

    if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return secureResponse(json({ error: 'Static assets are not configured.' }, { status: 503 }));
    }

    return secureResponse(await env.ASSETS.fetch(request));
  } catch {
    return secureResponse(unexpectedRequestError(handler ? 'api' : 'static'));
  }
}

export default {
  fetch(request, env, executionContext) {
    return handleWorkerRequest(request, env, executionContext);
  },
};
