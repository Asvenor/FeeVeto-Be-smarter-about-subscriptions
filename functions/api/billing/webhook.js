import {
  activateLifetimeAccess,
  BillingConfigurationError,
  PREMIUM_PRODUCT_KEY,
  recordStripeEvent,
  revokeRefundedAccess,
} from '../../_shared/billing-access.js';
import { json, methodNotAllowed } from '../../_shared/http.js';
import {
  createStripeClient,
  stripeCryptoProvider,
  stripePriceId,
  stripeWebhookSecret,
} from '../../_shared/stripe-client.js';

const MAX_WEBHOOK_BYTES = 1_000_000;
const COMPLETED_CHECKOUT_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

function objectId(value) {
  return typeof value === 'string' ? value : value?.id || '';
}

async function paidLifetimeSession(stripe, event, expectedPriceId) {
  const session = event.data?.object;
  if (!session || session.mode !== 'payment' || session.payment_status !== 'paid') return null;
  const clerkUserId = typeof session.metadata?.clerk_user_id === 'string' ? session.metadata.clerk_user_id.trim() : '';
  if (!clerkUserId || session.client_reference_id !== clerkUserId || session.metadata?.product_key !== PREMIUM_PRODUCT_KEY) return null;

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
  const priceIds = (lineItems.data || []).map((item) => objectId(item.price));
  if (priceIds.length !== 1 || priceIds[0] !== expectedPriceId) return null;

  const amountTotal = Number.isSafeInteger(session.amount_total) && session.amount_total >= 0 ? session.amount_total : null;
  const currency = typeof session.currency === 'string' ? session.currency.toUpperCase() : '';
  if (amountTotal === null || !['USD', 'EUR', 'GBP', 'CHF'].includes(currency)) return null;

  return {
    clerkUserId,
    checkoutSessionId: session.id,
    customerId: objectId(session.customer),
    paymentIntentId: objectId(session.payment_intent),
    priceId: expectedPriceId,
    amountTotal,
    currency,
  };
}

export async function handleWebhookRequest(
  context,
  {
    stripeClientFactory = createStripeClient,
    cryptoProviderFactory = stripeCryptoProvider,
    priceIdResolver = stripePriceId,
    webhookSecretResolver = stripeWebhookSecret,
    eventRecorder = recordStripeEvent,
    accessActivator = activateLifetimeAccess,
    refundRevoker = revokeRefundedAccess,
  } = {},
) {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);

  const statedLength = Number(context.request.headers.get('Content-Length') || 0);
  if (statedLength > MAX_WEBHOOK_BYTES) return json({ error: 'Webhook payload is too large.' }, { status: 413 });

  try {
    const signature = context.request.headers.get('Stripe-Signature');
    if (!signature) return json({ error: 'Webhook signature is required.' }, { status: 400 });

    const payload = await context.request.text();
    if (new TextEncoder().encode(payload).byteLength > MAX_WEBHOOK_BYTES) {
      return json({ error: 'Webhook payload is too large.' }, { status: 413 });
    }

    const stripe = stripeClientFactory(context.env);
    const event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecretResolver(context.env),
      undefined,
      cryptoProviderFactory(),
    );

    if (COMPLETED_CHECKOUT_EVENTS.has(event.type)) {
      const session = await paidLifetimeSession(stripe, event, priceIdResolver(context.env));
      if (session) await accessActivator({ env: context.env, event, session });
      else await eventRecorder({ env: context.env, event });
    } else if (event.type === 'charge.refunded' && event.data?.object?.refunded === true) {
      const paymentIntentId = objectId(event.data.object.payment_intent);
      if (paymentIntentId) await refundRevoker({ env: context.env, event, paymentIntentId });
      else await eventRecorder({ env: context.env, event });
    } else {
      await eventRecorder({ env: context.env, event });
    }

    return json({ received: true });
  } catch (error) {
    if (error instanceof BillingConfigurationError) {
      return json({ error: 'Payments are not configured yet.' }, { status: 503 });
    }
    if (error?.type === 'StripeSignatureVerificationError') {
      return json({ error: 'Webhook signature is invalid.' }, { status: 400 });
    }
    return json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}

export const onRequest = handleWebhookRequest;
