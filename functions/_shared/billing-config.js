import { BILLING_PLANS } from '../../js/billingPlans.js';

export class BillingConfigurationError extends Error {
  constructor(message) { super(message); this.name = 'BillingConfigurationError'; }
}
export const objectId = value => typeof value === 'string' ? value : value?.id || '';
export function billingMode(env) {
  const mode = env?.BILLING_MODE || 'test';
  if (!['test', 'live'].includes(mode)) throw new BillingConfigurationError('Invalid billing mode.');
  return mode;
}
export function assertStripeMode(value, env) {
  if (value?.livemode !== (billingMode(env) === 'live')) throw new BillingConfigurationError('Stripe mode mismatch.');
}
export function stripeKeyMatchesMode(value, env) {
  const key = String(value || '').trim(), mode = billingMode(env);
  return key.startsWith(`sk_${mode}_`) || key.startsWith(`rk_${mode}_`);
}
export function billingPriceIds(env, plan, { legacy = false } = {}) {
  const current = env?.[plan === 'monthly' ? 'STRIPE_MONTHLY_PRICE_ID' : 'STRIPE_LIFETIME_PRICE_ID'];
  const previous = legacy ? [env?.[plan === 'monthly' ? 'STRIPE_LEGACY_MONTHLY_PRICE_IDS' : 'STRIPE_LEGACY_LIFETIME_PRICE_IDS'], ...(plan === 'lifetime' ? [env?.STRIPE_PRICE_ID] : [])] : [];
  return [...new Set([current, ...previous].flatMap(v => String(v || '').split(',')).map(v => v.trim()).filter(v => /^price_[A-Za-z0-9_]+$/.test(v)))];
}
export function checkoutConfig(env, plan) {
  if (!Object.hasOwn(BILLING_PLANS, plan)) throw new BillingConfigurationError('Unknown billing plan.');
  const mode = billingMode(env);
  if (env?.BILLING_ENABLED !== 'true') throw new BillingConfigurationError('Checkout is disabled.');
  if (!stripeKeyMatchesMode(env?.STRIPE_SECRET_KEY, env)) throw new BillingConfigurationError('A matching Stripe server key is required.');
  const priceId = billingPriceIds(env, plan)[0];
  if (!priceId) throw new BillingConfigurationError('The selected price is not configured.');
  return { ...BILLING_PLANS[plan], priceId, mode };
}
export function validateCheckoutPrice(price, config, env) {
  assertStripeMode(price, env);
  if (price.id !== config.priceId || price.active !== true || price.currency !== 'usd' || price.unit_amount !== config.amountMinor
    || (config.id === 'monthly' ? price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed' : Boolean(price.recurring))) {
    throw new BillingConfigurationError('Stripe price does not match the approved plan.');
  }
}
