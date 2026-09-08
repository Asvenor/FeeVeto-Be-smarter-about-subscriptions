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

const API_ROUTES = Object.freeze({
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
  const pathname = new URL(request.url).pathname;
  const handler = Object.hasOwn(routes, pathname) ? routes[pathname] : null;
  if (handler) {
    return handler({
      request,
      env,
      waitUntil: executionContext?.waitUntil?.bind(executionContext),
    });
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return json({ error: 'API endpoint not found.' }, { status: 404 });
  }

  if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return json({ error: 'Static assets are not configured.' }, { status: 503 });
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch(request, env, executionContext) {
    return handleWorkerRequest(request, env, executionContext);
  },
};
