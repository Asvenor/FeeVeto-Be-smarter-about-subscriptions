import { testDatabase } from './sqlite-d1.js';
import { updateOwnerSettings } from '../../functions/_shared/owner-controls.js';
export const now = Math.floor(Date.now() / 1000);
export const identity = { userId: 'user_billing_test', user: { privateMetadata: { role: 'user' } } };
export async function billingFixture() {
  const db = await testDatabase({ billing: true });
  const env = { FEEVETO_BILLING: db, BILLING_ENABLED: 'true', BILLING_MODE: 'test',
    STRIPE_SECRET_KEY: 'sk_test_fictional', STRIPE_WEBHOOK_SECRET: 'whsec_fictional',
    STRIPE_MONTHLY_PRICE_ID: 'price_monthly', STRIPE_LIFETIME_PRICE_ID: 'price_lifetime', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test' };
  // Existing payment tests deliberately opt in; production and new databases stay paused.
  await updateOwnerSettings({ env, actor: 'user_fixture_owner', body: { revision: 0, acceptNewPurchases: true, monthlyEnabled: true, lifetimeEnabled: true } });
  const sessions = new Map(), subscriptions = new Map(), invoices = new Map(), keys = new Map();
  const calls = { customers: 0, checkouts: 0, cancels: [], portal: null };
  const prices = { price_monthly: { id: 'price_monthly', unit_amount: 299, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } },
    price_lifetime: { id: 'price_lifetime', unit_amount: 4999, recurring: null } };
  const stripe = {
    prices: { retrieve: async id => ({ currency: 'usd', active: true, livemode: false, ...prices[id] }) },
    customers: { create: async (_input, options) => { if (!keys.has(options.idempotencyKey)) { calls.customers++; keys.set(options.idempotencyKey, { id: `cus_${calls.customers}`, livemode: false }); } return keys.get(options.idempotencyKey); } },
    checkout: { sessions: {
      create: async (input, options) => {
        if (keys.has(options.idempotencyKey)) return keys.get(options.idempotencyKey);
        calls.checkouts++;
        const session = { ...structuredClone(input), id: `cs_${calls.checkouts}`, livemode: false, status: 'open', payment_status: 'unpaid',
          created: now, amount_total: input.mode === 'payment' ? 4999 : 299, url: `https://checkout.stripe.com/c/pay/${calls.checkouts}` };
        keys.set(options.idempotencyKey, session); sessions.set(session.id, session); return session;
      },
      retrieve: async id => structuredClone(sessions.get(id)),
      listLineItems: async id => ({ data: sessions.get(id).line_items.map(line => ({ ...line, price: { id: line.price } })), has_more: false }),
      list: async () => ({ data: [...sessions.values()], has_more: false }),
    } },
    subscriptions: {
      retrieve: async id => structuredClone(subscriptions.get(id)),
      list: async ({ customer }) => ({ data: [...subscriptions.values()].filter(s => s.customer === customer).map(s => structuredClone(s)), has_more: false }),
      cancel: async id => { calls.cancels.push(id); const sub = subscriptions.get(id); sub.status = 'canceled'; return structuredClone(sub); },
    },
    invoices: { retrieve: async id => structuredClone(invoices.get(id)), listLineItems: async id => ({ data: structuredClone(invoices.get(id).lines), has_more: false }) },
    invoicePayments: { list: async ({ invoice }) => ({ data: [{ invoice, status: 'paid', livemode: false, payment: { type: 'payment_intent', payment_intent: `pi_${invoice}` } }], has_more: false }) },
    webhooks: { constructEventAsync: async payload => JSON.parse(payload) },
    billingPortal: { sessions: { create: async input => { calls.portal = input; return { url: 'https://billing.stripe.com/p/session/test' }; } } },
  };
  function invoice(id, end, subscriptionId = 'sub_test') {
    const value = { id, customer: 'cus_1', status: 'paid', livemode: false, parent: { subscription_details: { subscription: subscriptionId } },
      lines: [{ pricing: { price_details: { price: 'price_monthly' } }, quantity: 1, period: { end } }] };
    invoices.set(id, value); return value;
  }
  function paidSession(plan, id = `cs_${calls.checkouts}`) {
    const session = sessions.get(id); session.status = 'complete'; session.payment_status = 'paid';
    if (plan === 'lifetime') session.payment_intent = `pi_${id}`;
    else {
      session.subscription = 'sub_test';
      subscriptions.set('sub_test', { id: 'sub_test', livemode: false, customer: session.customer, metadata: session.subscription_data.metadata,
        status: 'active', cancel_at_period_end: false, latest_invoice: 'in_first', items: { has_more: false, data: [{ price: { id: 'price_monthly' }, quantity: 1, current_period_end: now + 2592000 }] } });
      invoice('in_first', now + 2592000);
    }
    return session;
  }
  const context = (plan = 'monthly', extra = '') => ({ env, request: new Request(`https://feeveto.example/api/billing/checkout?plan=${plan}&currency=USD${extra}`, { method: 'POST' }) });
  const dependencies = { identityResolver: async () => identity, stripeClientFactory: () => stripe };
  return { env, db, stripe, sessions, subscriptions, invoices, prices, calls, context, dependencies, paidSession, invoice };
}
