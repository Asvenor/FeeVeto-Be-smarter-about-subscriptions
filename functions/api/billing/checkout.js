import { resolveAccess } from '../../_shared/access-policy.js';
import { BillingConfigurationError, getPaidPremiumAccessStrict, PREMIUM_PRODUCT_KEY } from '../../_shared/billing-access.js';
import { AccessConfigurationError, getVerifiedIdentity } from '../../_shared/clerk-access.js';
import { json, methodNotAllowed } from '../../_shared/http.js';
import { createStripeClient, stripePriceId } from '../../_shared/stripe-client.js';

export const CHECKOUT_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);

function primaryEmailAddress(user) {
  const addresses = Array.isArray(user?.emailAddresses) ? user.emailAddresses : [];
  return addresses.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress
    || addresses[0]?.emailAddress
    || undefined;
}

function safeCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' ? url.href : '';
  } catch {
    return '';
  }
}

export async function handleCheckoutRequest(
  context,
  {
    identityResolver = getVerifiedIdentity,
    paidAccessResolver = getPaidPremiumAccessStrict,
    stripeClientFactory = createStripeClient,
    priceIdResolver = stripePriceId,
  } = {},
) {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);

  try {
    const identity = await identityResolver(context);
    if (!identity) return json({ error: 'Sign in before purchasing premium access.' }, { status: 401 });

    const complimentary=resolveAccess({authenticated:true,privateMetadata:identity.user?.privateMetadata});
    if(complimentary.premiumAccess)return json({state:'already_premium'});

    const paidPremiumAccess = await paidAccessResolver({ userId: identity.userId, env: context.env });
    const access = resolveAccess({
      authenticated: true,
      privateMetadata: identity.user?.privateMetadata,
      paidPremiumAccess,
    });
    if (access.premiumAccess) return json({ state: 'already_premium' });

    const currency = new URL(context.request.url).searchParams.get('currency')?.toUpperCase() || '';
    if (!CHECKOUT_CURRENCIES.includes(currency)) {
      return json({ error: 'Choose USD, EUR, GBP, or CHF.' }, { status: 400 });
    }

    const priceId = priceIdResolver(context.env);
    const stripe = stripeClientFactory(context.env);
    const origin = new URL(context.request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: currency.toLowerCase(),
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: identity.userId,
      customer_creation: 'always',
      customer_email: primaryEmailAddress(identity.user),
      success_url: `${origin}/?payment=success#pricing`,
      cancel_url: `${origin}/?payment=cancelled#pricing`,
      metadata: {
        clerk_user_id: identity.userId,
        product_key: PREMIUM_PRODUCT_KEY,
      },
    });
    const checkoutUrl = safeCheckoutUrl(session.url);
    if (!checkoutUrl) throw new Error('Stripe did not return a valid Checkout URL.');
    return json({ checkoutUrl }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessConfigurationError || error instanceof BillingConfigurationError) {
      return json({ error: 'Payments are not configured yet.' }, { status: 503 });
    }
    return json({ error: 'Checkout could not be started. Please try again.' }, { status: 502 });
  }
}

export const onRequest = handleCheckoutRequest;
