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
import { assertStripeMode, objectId as stripeObjectId } from '../../_shared/billing-config.js';
import { fulfillCheckout } from '../../_shared/billing-fulfillment.js';
import { syncSubscription, invoiceSubscriptionId, stopMonthlyRenewals } from '../../_shared/billing-subscriptions.js';
import { clearCheckout, customerFor } from '../../_shared/billing-store.js';

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

    const reader = context.request.body?.getReader();
    const chunks = []; let size = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBHOOK_BYTES) { await reader.cancel(); return json({ error: 'Webhook payload is too large.' }, { status: 413 }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload = new TextDecoder().decode(bytes);

    const stripe = stripeClientFactory(context.env);
    const event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecretResolver(context.env),
      undefined,
      cryptoProviderFactory(),
    );

    const dualPlans = Boolean(context.env?.STRIPE_MONTHLY_PRICE_ID || context.env?.STRIPE_LIFETIME_PRICE_ID);
    if (dualPlans) assertStripeMode(event, context.env);
    if (dualPlans && COMPLETED_CHECKOUT_EVENTS.has(event.type)) {
      await fulfillCheckout({ env: context.env, stripe, sessionId: event.data.object.id });
      await eventRecorder({ env: context.env, event });
    } else if (dualPlans && (event.type.startsWith('customer.subscription.') || ['invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required'].includes(event.type))) {
      const id = event.type.startsWith('customer.subscription.') ? event.data.object.id : invoiceSubscriptionId(event.data.object);
      if (id) {
        const sub = await syncSubscription({ env: context.env, stripe, subscriptionId: id,
          invoiceId: event.type === 'invoice.paid' ? event.data.object.id : '' });
        if (sub) await stopMonthlyRenewals({ env: context.env, stripe, userId: sub.metadata.clerk_user_id, customerId: stripeObjectId(sub.customer) });
      }
      await eventRecorder({ env: context.env, event });
    } else if (dualPlans && event.type === 'checkout.session.expired') {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id);
      assertStripeMode(session, context.env);
      const userId = session.metadata?.clerk_user_id;
      const row = userId ? await customerFor(context.env, userId) : null;
      if (session.status === 'expired' && row?.checkout_token === session.metadata?.checkout_token && row.stripe_customer_id === stripeObjectId(session.customer)) {
        await clearCheckout({ env: context.env, userId, token: row.checkout_token });
      }
      await eventRecorder({ env: context.env, event });
    } else if (COMPLETED_CHECKOUT_EVENTS.has(event.type)) {
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
