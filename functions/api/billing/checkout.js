import { resolveAccess } from '../../_shared/access-policy.js';
import { AccessConfigurationError, getVerifiedIdentity } from '../../_shared/clerk-access.js';
import { json, methodNotAllowed } from '../../_shared/http.js';
import { createStripeClient } from '../../_shared/stripe-client.js';
import { BillingConfigurationError, assertStripeMode, checkoutConfig, validateCheckoutPrice } from '../../_shared/billing-config.js';
import { bindCheckout, clearCheckout, ensureCustomer, getBillingStatus, reserveCheckout } from '../../_shared/billing-store.js';
import { fulfillCheckout } from '../../_shared/billing-fulfillment.js';

export const CHECKOUT_CURRENCIES = Object.freeze(['USD']);
function safeCheckoutUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' ? url.href : ''; } catch { return ''; }
}
export async function handleCheckoutRequest(context, { identityResolver = getVerifiedIdentity, stripeClientFactory = createStripeClient } = {}) {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  try {
    const identity = await identityResolver(context);
    if (!identity) return json({ error: 'Sign in before purchasing Premium.' }, { status: 401 });
    if (resolveAccess({ authenticated: true, privateMetadata: identity.user?.privateMetadata }).premiumAccess) return json({ state: 'already_premium' });
    const url = new URL(context.request.url), plan = url.searchParams.get('plan'), currency = url.searchParams.get('currency');
    if (!['monthly', 'lifetime'].includes(plan) || currency !== 'USD') return json({ error: 'Choose Monthly or Lifetime. Checkout is currently billed in USD only.' }, { status: 400 });
    const config = checkoutConfig(context.env, plan), stripe = stripeClientFactory(context.env);
    validateCheckoutPrice(await stripe.prices.retrieve(config.priceId), config, context.env);
    const status = await getBillingStatus({ env: context.env, userId: identity.userId });
    if (status.lifetimeAccess || (plan === 'monthly' && status.subscription && !['canceled', 'incomplete_expired'].includes(status.subscription.status))) {
      return json({ state: status.lifetimeAccess ? 'already_premium' : 'manage_subscription' });
    }
    await ensureCustomer({ env: context.env, stripe, identity });
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await reserveCheckout({ env: context.env, userId: identity.userId, plan, origin: url.origin });
      // A webhook may have fulfilled the previous checkout while this request
      // waited for the account's reservation. Recheck before contacting Checkout.
      const latest = await getBillingStatus({ env: context.env, userId: identity.userId });
      if (latest.lifetimeAccess) return json({ state: 'already_premium' });
      if (plan === 'monthly' && latest.subscription && !['canceled', 'incomplete_expired'].includes(latest.subscription.status)) return json({ state: 'manage_subscription' });
      const pending = row.checkout_plan === plan;
      let session;
      if (row.checkout_session_id) {
        session = await stripe.checkout.sessions.retrieve(row.checkout_session_id);
        assertStripeMode(session, context.env);
        if (session.status === 'complete') {
          await fulfillCheckout({ env: context.env, stripe, sessionId: session.id });
          return json({ state: 'confirmation_pending' });
        }
        if (session.status === 'expired') {
          await clearCheckout({ env: context.env, userId: identity.userId, token: row.checkout_token }); continue;
        }
        if (!pending) return json({ error: `A ${row.checkout_plan} checkout is already open. Resume it or wait for it to expire before choosing another plan.` }, { status: 409 });
      } else {
        if (!pending) return json({ error: 'Another checkout is being prepared. Please retry the original plan.' }, { status: 409 });
        // Never release a reservation merely because the browser timed out.
        if (row.checkout_expires_at <= Math.floor(Date.now() / 1000)) {
          const existing = await stripe.checkout.sessions.list({ customer: row.stripe_customer_id, limit: 100 });
          if (existing.has_more) throw new Error('Checkout reconciliation needs review.');
          session = existing.data.find(s => s.metadata?.checkout_token === row.checkout_token);
          if (session) { await bindCheckout({ env: context.env, userId: identity.userId, token: row.checkout_token, sessionId: session.id }); continue; }
          await clearCheckout({ env: context.env, userId: identity.userId, token: row.checkout_token }); continue;
        }
        const metadata = { clerk_user_id: identity.userId, product_key: `feeveto_premium_${plan}`, plan,
          billing_mode: config.mode, checkout_token: row.checkout_token };
        session = await stripe.checkout.sessions.create({
          mode: plan === 'monthly' ? 'subscription' : 'payment', customer: row.stripe_customer_id,
          line_items: [{ price: config.priceId, quantity: 1 }], currency: 'usd', payment_method_types: ['card'],
          client_reference_id: identity.userId, metadata, expires_at: row.checkout_expires_at,
          ...(plan === 'monthly' ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
          success_url: `${row.checkout_origin}/?payment=success&plan=${plan}#pricing`,
          cancel_url: `${row.checkout_origin}/?payment=cancelled#pricing`,
        }, { idempotencyKey: `feeveto:checkout:${config.mode}:${row.checkout_token}` });
        assertStripeMode(session, context.env);
        await bindCheckout({ env: context.env, userId: identity.userId, token: row.checkout_token, sessionId: session.id });
      }
      const checkoutUrl = safeCheckoutUrl(session.url);
      if (!checkoutUrl) throw new Error('Invalid Checkout destination.');
      return json({ checkoutUrl, mode: config.mode }, { status: 201 });
    }
    throw new Error('Checkout reconciliation is pending.');
  } catch (error) {
    if (error instanceof AccessConfigurationError || error instanceof BillingConfigurationError) return json({ error: 'Payments are not configured yet.' }, { status: 503 });
    return json({ error: 'Checkout could not be started safely. Please retry; do not open multiple checkouts.' }, { status: 502 });
  }
}
export const onRequest = handleCheckoutRequest;
