import { handleAccessRequest } from './functions/api/access.js';
import { handleAdminStatusRequest } from './functions/api/admin/status.js';
import { handleRecommendationsRequest } from './functions/api/alternatives/recommendations.js';
import { handlePremiumStatusRequest } from './functions/api/premium/status.js';
import { json } from './functions/_shared/http.js';

const API_ROUTES = Object.freeze({
  '/api/access': handleAccessRequest,
  '/api/admin/status': handleAdminStatusRequest,
  '/api/alternatives/recommendations': handleRecommendationsRequest,
  '/api/premium/status': handlePremiumStatusRequest,
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
