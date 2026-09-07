import Stripe from 'stripe';
import { BillingConfigurationError } from './billing-access.js';

function requiredEnvironmentValue(env, name) {
  const value = typeof env?.[name] === 'string' ? env[name].trim() : '';
  if (!value) throw new BillingConfigurationError(`${name} is not configured.`);
  return value;
}

export function stripePriceId(env) {
  return requiredEnvironmentValue(env, 'STRIPE_PRICE_ID');
}

export function stripeWebhookSecret(env) {
  return requiredEnvironmentValue(env, 'STRIPE_WEBHOOK_SECRET');
}

export function createStripeClient(env) {
  return new Stripe(requiredEnvironmentValue(env, 'STRIPE_SECRET_KEY'), {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    telemetry: false,
  });
}

export function stripeCryptoProvider() {
  return Stripe.createSubtleCryptoProvider();
}
