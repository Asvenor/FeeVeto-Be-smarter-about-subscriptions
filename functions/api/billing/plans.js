import { BILLING_PLANS } from '../../../js/billingPlans.js';
import { billingMode, checkoutConfig } from '../../_shared/billing-config.js';
import { getOwnerSettings } from '../../_shared/owner-controls.js';
import { json, methodNotAllowed } from '../../_shared/http.js';
export async function handleBillingPlansRequest({ request, env }) {
  if (request.method !== 'GET') return methodNotAllowed();
  let mode = 'test', settings = null;
  try { mode = billingMode(env); settings = await getOwnerSettings({ env }); } catch { /* Missing configuration or storage fails closed. */ }
  const plans = Object.values(BILLING_PLANS).map(plan => {
    let available = false;
    try { checkoutConfig(env, plan.id); available = settings?.acceptNewPurchases === true && settings?.[`${plan.id}Enabled`] === true; } catch { /* Never expose secret configuration. */ }
    return { ...plan, available };
  });
  return json({ available: plans.some(plan => plan.available), mode, currency: 'USD', plans });
}
export const onRequest = handleBillingPlansRequest;
