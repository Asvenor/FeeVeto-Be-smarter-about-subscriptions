import { getVerifiedIdentity } from '../../_shared/clerk-access.js';
import { createStripeClient } from '../../_shared/stripe-client.js';
import { customerFor } from '../../_shared/billing-store.js';
import { json, methodNotAllowed } from '../../_shared/http.js';
export async function handleBillingPortalRequest(context, { identityResolver = getVerifiedIdentity, stripeClientFactory = createStripeClient } = {}) {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  try {
    const identity = await identityResolver(context);
    if (!identity) return json({ error: 'Sign in to manage billing.' }, { status: 401 });
    const customer = await customerFor(context.env, identity.userId);
    if (!customer?.stripe_customer_id) return json({ error: 'No billing account exists for this login yet.' }, { status: 404 });
    const configuration = context.env?.STRIPE_PORTAL_CONFIGURATION_ID;
    if (!/^bpc_[A-Za-z0-9_]+$/.test(configuration || '')) throw new Error('Portal not configured.');
    const session = await stripeClientFactory(context.env).billingPortal.sessions.create({ customer: customer.stripe_customer_id,
      configuration, return_url: `${new URL(context.request.url).origin}/#pricing` });
    const url = new URL(session.url);
    if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com') throw new Error('Invalid portal destination.');
    return json({ portalUrl: url.href });
  } catch { return json({ error: 'Billing management is temporarily unavailable. Please retry.' }, { status: 503 }); }
}
export const onRequest = handleBillingPortalRequest;
