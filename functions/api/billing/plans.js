import { BILLING_PLANS } from '../../../js/billingPlans.js';
import { checkoutConfig } from '../../_shared/billing-config.js';
import { json, methodNotAllowed } from '../../_shared/http.js';
export function handleBillingPlansRequest({ request, env }) {
  if (request.method !== 'GET') return methodNotAllowed();
  let available = false, mode = 'test';
  try { mode = checkoutConfig(env, 'monthly').mode; checkoutConfig(env, 'lifetime'); available = true; } catch { /* Do not expose private configuration. */ }
  return json({ available, mode, currency: 'USD', plans: Object.values(BILLING_PLANS) });
}
export const onRequest = handleBillingPlansRequest;
