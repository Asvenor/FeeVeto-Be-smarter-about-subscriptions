import Stripe from 'stripe';
import { BillingConfigurationError, stripeKeyMatchesMode } from './billing-config.js';

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
  const key = requiredEnvironmentValue(env, 'STRIPE_SECRET_KEY');
  if (!stripeKeyMatchesMode(key, env)) throw new BillingConfigurationError('Stripe mode mismatch.');
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    telemetry: false,
  });
}

export function stripeCryptoProvider() {
  return Stripe.createSubtleCryptoProvider();
}
