import { json, methodNotAllowed } from '../../_shared/http.js';
import { createStripeClient } from '../../_shared/stripe-client.js';
import { activateOwnerDiscount, createOwnerDiscount, deactivateOwnerDiscount, listOwnerDiscounts, ownerErrorResponse, ownerRuntime, readOwnerJson, requireOwner } from '../../_shared/owner-controls.js';

export async function handleAdminDiscountsRequest(context, { identityResolver, stripeClientFactory = createStripeClient } = {}) {
  if (!['GET', 'POST', 'PATCH'].includes(context.request.method)) return methodNotAllowed(['GET', 'POST', 'PATCH']);
  try {
    const identity = await requireOwner(context, identityResolver);
    if (context.request.method === 'GET') {
      const runtime = ownerRuntime(context.env);
      return json({ ...await listOwnerDiscounts({ env: context.env }), billingMode: runtime.billingMode, stripeReady: runtime.stripeReady });
    }
    const body = await readOwnerJson(context.request);
    const input = { env: context.env, actor: identity.userId, body };
    const discount = context.request.method === 'POST' ? await createOwnerDiscount(input)
      : body.action === 'activate' ? await activateOwnerDiscount({ ...input, stripe: stripeClientFactory(context.env) })
        : await deactivateOwnerDiscount({ ...input, stripeClientFactory });
    return json({ discount }, { status: context.request.method === 'POST' ? 201 : 200 });
  } catch (error) { return ownerErrorResponse(error); }
}
export const onRequest = handleAdminDiscountsRequest;
