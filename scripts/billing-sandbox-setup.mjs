import { mkdir, writeFile } from 'node:fs/promises';
import { sandboxCli } from './lib/stripe-sandbox-cli.mjs';
import { BILLING_PLANS } from '../js/billingPlans.js';
import { validateCheckoutPrice } from '../functions/_shared/billing-config.js';

const accountId = process.argv[2];
const stripe = sandboxCli({ accountId });
const context = stripe.verify(), generation = 'monthly-lifetime-v1';
const marker = { 'metadata[application]': 'feeveto', 'metadata[billing_setup]': generation };
function one(list, matches) {
  if (list.has_more) throw new Error('More than one page; review the sandbox before creating anything.');
  const found = list.data.filter(matches);
  if (found.length > 1) throw new Error('Multiple matching test resources; review instead of guessing.');
  return found[0];
}
const product = one(stripe.request('get', '/v1/products', { limit: 100 }), p => p.metadata?.application === 'feeveto' && p.metadata?.billing_setup === generation)
  || stripe.request('post', '/v1/products', { name: 'FeeVeto Premium', description: 'FeeVeto Premium for one account. Sandbox integration testing only.', ...marker }, `feeveto:${generation}:product`);
if (product.livemode !== false || !product.active) throw new Error('Test product is inactive or not sandbox-only.');
const prices = {};
for (const plan of Object.values(BILLING_PLANS)) {
  const lookup = `feeveto_${plan.id}_usd_${plan.amountMinor}_v1`;
  const price = one(stripe.request('get', '/v1/prices', { product: product.id, limit: 100 }), p => p.lookup_key === lookup)
    || stripe.request('post', '/v1/prices', { product: product.id, currency: 'usd', unit_amount: plan.amountMinor,
      nickname: `FeeVeto Premium ${plan.label} (test)`, lookup_key: lookup, ...marker,
      ...(plan.id === 'monthly' ? { 'recurring[interval]': 'month', 'recurring[interval_count]': 1, 'recurring[usage_type]': 'licensed' } : {}) }, `feeveto:${generation}:${plan.id}`);
  validateCheckoutPrice(price, { ...plan, priceId: price.id }, { BILLING_MODE: 'test' });
  prices[plan.id] = price.id;
}
const portal = one(stripe.request('get', '/v1/billing_portal/configurations', { limit: 100 }), p => p.metadata?.application === 'feeveto' && p.metadata?.billing_setup === generation)
  || stripe.request('post', '/v1/billing_portal/configurations', {
    name: 'FeeVeto Premium — test billing', 'business_profile[headline]': 'Manage FeeVeto Premium (test mode)',
    'features[payment_method_update][enabled]': true, 'features[invoice_history][enabled]': true,
    'features[customer_update][enabled]': false, 'features[subscription_update][enabled]': false,
    'features[subscription_cancel][enabled]': true, 'features[subscription_cancel][mode]': 'at_period_end',
    'features[subscription_cancel][proration_behavior]': 'none', 'login_page[enabled]': false, ...marker,
  }, `feeveto:${generation}:portal`);
if (portal.livemode !== false || !portal.active || portal.features.subscription_cancel.mode !== 'at_period_end'
  || portal.features.subscription_cancel.proration_behavior !== 'none' || portal.features.subscription_update.enabled) throw new Error('Portal configuration needs review.');
const manifest = { verifiedAt: new Date().toISOString(), ...context, productId: product.id, prices, portalConfigurationId: portal.id,
  configuration: { BILLING_MODE: 'test', BILLING_ENABLED: 'false', STRIPE_MONTHLY_PRICE_ID: prices.monthly,
    STRIPE_LIFETIME_PRICE_ID: prices.lifetime, STRIPE_PORTAL_CONFIGURATION_ID: portal.id },
  warning: 'No server key or webhook secret is included. This does not enable or deploy website checkout.' };
await mkdir('.private/billing-sandbox', { recursive: true, mode: 0o700 });
await writeFile('.private/billing-sandbox/setup.json', `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(manifest, null, 2));
