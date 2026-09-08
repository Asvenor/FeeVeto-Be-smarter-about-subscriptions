import test from 'node:test';
import assert from 'node:assert/strict';
import { billingFixture } from './helpers/billing-fixture.js';
import { handleCheckoutRequest } from '../functions/api/billing/checkout.js';
import { handleBillingPlansRequest } from '../functions/api/billing/plans.js';
import { activateOwnerDiscount, createOwnerDiscount, deactivateOwnerDiscount, getOwnerSettings, updateOwnerSettings } from '../functions/_shared/owner-controls.js';

const actor = 'user_checkout_owner';
const clone = value => structuredClone(value);
async function fixture(t) {
  const f = await billingFixture();
  t.after(() => f.db.close());
  f.prices.price_monthly.product = 'prod_shared';
  f.prices.price_lifetime.product = 'prod_shared';
  const coupons = new Map(), promotions = new Map();
  f.stripe.coupons = {
    retrieve: async id => {
      if (!coupons.has(id)) throw Object.assign(new Error('Fixture coupon missing'), { code: 'resource_missing', statusCode: 404 });
      return clone(coupons.get(id));
    },
    create: async body => {
      const coupon = { ...clone(body), livemode: false, amount_off: null, valid: true };
      coupons.set(coupon.id, coupon); return clone(coupon);
    },
  };
  f.stripe.promotionCodes = {
    retrieve: async id => clone(promotions.get(id)),
    list: async ({ code }) => ({ data: [...promotions.values()].filter(value => value.code === code).map(clone), has_more: false }),
    create: async body => {
      const promotion = { ...clone(body), id: `promo_${promotions.size + 1}`, livemode: false, times_redeemed: 0 };
      promotions.set(promotion.id, promotion); return clone(promotion);
    },
    update: async (id, body) => { Object.assign(promotions.get(id), body); return clone(promotions.get(id)); },
  };
  const priceRetrieve = f.stripe.prices.retrieve;
  f.calls.priceReads = 0;
  f.stripe.prices.retrieve = async id => { f.calls.priceReads++; return priceRetrieve(id); };
  async function setPolicy(patch) {
    const settings = await getOwnerSettings({ env: f.env });
    return updateOwnerSettings({ env: f.env, actor, body: { revision: settings.revision,
      acceptNewPurchases: settings.acceptNewPurchases, monthlyEnabled: settings.monthlyEnabled, lifetimeEnabled: settings.lifetimeEnabled, ...patch } });
  }
  async function discount({ code = 'FRIENDS20', plan = 'monthly', percentOff = 20, active = true } = {}) {
    const draft = await createOwnerDiscount({ env: f.env, actor, body: { requestId: crypto.randomUUID(), code, plan, percentOff, duration: 'once' } });
    return active ? activateOwnerDiscount({ env: f.env, stripe: f.stripe, actor, body: { id: draft.id, action: 'activate' } }) : draft;
  }
  async function deactivate(id) { return deactivateOwnerDiscount({ env: f.env, stripe: f.stripe, actor, body: { id, active: false } }); }
  function request(plan = 'monthly', body, headers = {}) {
    return { env: f.env, request: new Request(`https://feeveto.example/api/billing/checkout?plan=${plan}&currency=USD`, { method: 'POST',
      headers: { Origin: 'https://feeveto.example', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }) };
  }
  const checkout = (plan, body, headers) => handleCheckoutRequest(request(plan, body, headers), f.dependencies);
  const plans = async env => (await handleBillingPlansRequest({ env: env || f.env, request: new Request('https://feeveto.example/api/billing/plans') })).json();
  return { ...f, coupons, promotions, setPolicy, discount, deactivate, request, checkout, plans };
}

test('a database without owner settings pauses both plans before any Stripe operation', async t => {
  const f = await fixture(t);
  await f.db.prepare('DELETE FROM owner_settings').run();
  for (const plan of ['monthly', 'lifetime']) {
    const response = await f.checkout(plan);
    assert.equal(response.status, 409); assert.equal((await response.json()).checkoutUrl, undefined);
  }
  assert.equal(f.calls.priceReads, 0); assert.equal(f.calls.customers, 0); assert.equal(f.calls.checkouts, 0);
  assert.equal((await f.plans()).available, false);
});

test('per-plan owner pause blocks only that plan before Stripe and public plans reflect it', async t => {
  for (const paused of ['monthly', 'lifetime']) await t.test(paused, async t => {
    const f = await fixture(t), allowed = paused === 'monthly' ? 'lifetime' : 'monthly';
    await f.setPolicy({ [`${paused}Enabled`]: false });
    assert.equal((await f.checkout(paused)).status, 409);
    assert.equal(f.calls.priceReads, 0); assert.equal(f.calls.customers, 0); assert.equal(f.calls.checkouts, 0);
    const plans = await f.plans();
    assert.equal(plans.available, true);
    assert.equal(plans.plans.find(plan => plan.id === paused).available, false);
    assert.equal(plans.plans.find(plan => plan.id === allowed).available, true);
    assert.equal((await f.checkout(allowed)).status, 201); assert.equal(f.calls.checkouts, 1);
  });
});

test('owner settings cannot override the runtime launch lock or missing server configuration', async t => {
  const f = await fixture(t);
  for (const value of [undefined, 'false', true, 'TRUE']) {
    f.env.BILLING_ENABLED = value;
    const response = await f.checkout('monthly');
    assert.equal(response.status, 503); assert.equal((await response.json()).checkoutUrl, undefined);
    assert.equal((await f.plans()).available, false);
  }
  f.env.BILLING_ENABLED = 'true'; delete f.env.STRIPE_SECRET_KEY;
  assert.equal((await f.checkout('monthly')).status, 503);
  assert.equal(f.calls.priceReads, 0); assert.equal(f.calls.customers, 0); assert.equal(f.calls.checkouts, 0);
});

test('public plan availability is per-plan, fail-closed on storage errors, and contains no private configuration', async t => {
  const f = await fixture(t);
  const initial = await f.plans();
  assert.deepEqual(initial.plans.map(plan => [plan.id, plan.amountMinor, plan.available]), [['monthly', 299, true], ['lifetime', 4999, true]]);
  delete f.env.STRIPE_MONTHLY_PRICE_ID;
  assert.deepEqual((await f.plans()).plans.map(plan => plan.available), [false, true]);
  await f.setPolicy({ acceptNewPurchases: false });
  assert.deepEqual((await f.plans()).plans.map(plan => plan.available), [false, false]);
  const failed = await f.plans({ ...f.env, FEEVETO_BILLING: { prepare: () => { throw new Error('private database identifier'); } } });
  assert.equal(failed.available, false); assert.ok(failed.plans.every(plan => plan.available === false));
  const absent = await f.plans({}); assert.equal(absent.available, false);
  assert.doesNotMatch(JSON.stringify([initial, failed, absent]), /sk_test|STRIPE_|price_monthly|price_lifetime|private database/);
});

test('server-approved discounts reach actual Checkout params without trusting client price or raw codes', async t => {
  for (const plan of ['monthly', 'lifetime']) await t.test(plan, async t => {
    const f = await fixture(t), discount = await f.discount({ plan });
    const response = await f.checkout(plan, { discountCode: ' friends20 ' });
    assert.equal(response.status, 201); assert.ok((await response.json()).checkoutUrl.startsWith('https://checkout.stripe.com/'));
    const session = f.sessions.get('cs_1');
    assert.deepEqual(session.discounts, [{ promotion_code: 'promo_1' }]);
    assert.deepEqual(session.line_items, [{ price: `price_${plan}`, quantity: 1 }]);
    assert.equal(session.metadata.owner_discount_id, discount.id);
    assert.equal(session.allow_promotion_codes, undefined, 'arbitrary Stripe promotion-code entry must not bypass FeeVeto plan restrictions');
    assert.equal(session.currency, 'usd'); assert.equal(session.mode, plan === 'monthly' ? 'subscription' : 'payment');
    assert.doesNotMatch(JSON.stringify(session), /FRIENDS20/, 'raw codes do not enter redirect URLs, customer metadata, or checkout metadata');
    assert.equal((await f.checkout(plan, { discountCode: 'FRIENDS20' })).status, 201);
    assert.equal(f.calls.checkouts, 1, 'same-code retries resume one Checkout session');
  });
});

test('forged discount payloads, raw Stripe IDs, invalid bodies, and cross-origin requests are rejected', async t => {
  const f = await fixture(t);
  for (const body of [
    { discountCode: 'FRIENDS20', percentOff: 80 }, { discountCode: 'FRIENDS20', promotion_code: 'promo_foreign' },
    { coupon: 'coupon_foreign' }, { role: 'admin' }, { premiumAccess: true }, { price: 'price_free' },
    { discountCode: 20 }, { discountCode: ['FRIENDS20'] }, { discountCode: 'promo_foreign' }, { discountCode: '<script>' },
    { discountCode: 'UNKNOWN20' }, '[]', '{broken',
  ]) {
    const response = await f.checkout('monthly', body);
    assert.equal(response.status, 400); assert.equal((await response.json()).checkoutUrl, undefined);
  }
  assert.equal((await f.checkout('monthly', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.checkout('monthly', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.checkout('monthly', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.checkout('monthly', ' '.repeat(24001))).status, 413);
  assert.equal(f.calls.checkouts, 0); assert.equal(f.calls.customers, 0); assert.equal(f.calls.priceReads, 0);
});

test('a code cannot apply to the wrong plan, while drafts and deactivated codes cannot reach Checkout', async t => {
  const f = await fixture(t), monthly = await f.discount();
  const afterActivationPriceReads = f.calls.priceReads;
  assert.equal((await f.checkout('lifetime', { discountCode: monthly.code })).status, 400);
  const draft = await f.discount({ code: 'DRAFTCODE', active: false });
  assert.equal((await f.checkout('monthly', { discountCode: draft.code })).status, 400);
  await f.deactivate(monthly.id);
  assert.equal((await f.checkout('monthly', { discountCode: monthly.code })).status, 400);
  assert.equal(f.calls.priceReads, afterActivationPriceReads); assert.equal(f.calls.customers, 0); assert.equal(f.calls.checkouts, 0);
});

test('an open session rejects changed or removed discounts without issuing a second checkout', async t => {
  const f = await fixture(t), first = await f.discount(), second = await f.discount({ code: 'ANOTHER25', percentOff: 25 });
  assert.equal((await f.checkout('monthly', { discountCode: first.code })).status, 201);
  for (const body of [{ discountCode: second.code }, { discountCode: '' }, undefined]) {
    const response = await f.checkout('monthly', body);
    assert.equal(response.status, 409); assert.equal((await response.json()).checkoutUrl, undefined);
  }
  assert.equal((await f.checkout('monthly', { discountCode: first.code })).status, 201);
  assert.equal(f.calls.checkouts, 1); assert.equal(f.calls.customers, 1);
});

test('adding a discount to an already open undiscounted session is a conflict, not a second checkout', async t => {
  const f = await fixture(t), discount = await f.discount();
  assert.equal((await f.checkout('monthly')).status, 201);
  const response = await f.checkout('monthly', { discountCode: discount.code });
  assert.equal(response.status, 409); assert.equal((await response.json()).checkoutUrl, undefined);
  assert.equal(f.calls.checkouts, 1); assert.equal(f.sessions.get('cs_1').discounts, undefined);
});

test('an owner pause before Checkout creation is rechecked after customer setup', async t => {
  const f = await fixture(t), createCustomer = f.stripe.customers.create;
  f.stripe.customers.create = async (...args) => {
    const customer = await createCustomer(...args); await f.setPolicy({ acceptNewPurchases: false }); return customer;
  };
  const response = await f.checkout('monthly');
  assert.equal(response.status, 409); assert.equal((await response.json()).checkoutUrl, undefined);
  assert.equal(f.calls.checkouts, 0); assert.equal(f.calls.customers, 1);
});

test('a code deactivated after customer setup is rechecked before creating Checkout', async t => {
  const f = await fixture(t), discount = await f.discount(), createCustomer = f.stripe.customers.create;
  f.stripe.customers.create = async (...args) => {
    const customer = await createCustomer(...args); await f.deactivate(discount.id); return customer;
  };
  const response = await f.checkout('monthly', { discountCode: discount.code });
  assert.equal(response.status, 400); assert.equal((await response.json()).checkoutUrl, undefined);
  assert.equal(f.calls.checkouts, 0); assert.equal(f.calls.customers, 1);
});

test('a lost Checkout response and changed code cannot reuse a Stripe idempotency key with new parameters', async t => {
  const f = await fixture(t), first = await f.discount(), second = await f.discount({ code: 'ANOTHER25', percentOff: 25 });
  const createSession = f.stripe.checkout.sessions.create, parameters = new Map();
  let loseResponse = true;
  f.stripe.checkout.sessions.create = async (body, options) => {
    const encoded = JSON.stringify(body), prior = parameters.get(options.idempotencyKey);
    // Stripe rejects changed parameters on an existing idempotency key. The base
    // fixture only caches responses, so model that production rule explicitly here.
    if (prior && prior !== encoded) throw Object.assign(new Error('Changed idempotent request'), { type: 'StripeIdempotencyError' });
    parameters.set(options.idempotencyKey, encoded);
    const session = await createSession(body, options);
    if (loseResponse) { loseResponse = false; throw new Error('Network response lost after Stripe created Checkout'); }
    return session;
  };
  assert.equal((await f.checkout('monthly', { discountCode: first.code })).status, 502);
  const changed = await f.checkout('monthly', { discountCode: second.code });
  assert.equal(changed.status, 502); assert.equal((await changed.json()).checkoutUrl, undefined);
  assert.equal((await f.checkout('monthly', { discountCode: first.code })).status, 201);
  assert.equal(f.calls.checkouts, 1); assert.equal(f.calls.customers, 1);
  assert.equal(f.sessions.get('cs_1').metadata.owner_discount_id, first.id);
});

test('a newly created or replayed Checkout response with missing or different discount metadata never returns a URL', async t => {
  for (const kind of ['missing', 'different', 'unexpected']) await t.test(kind, async t => {
    const f = await fixture(t), discount = await f.discount(), createSession = f.stripe.checkout.sessions.create;
    const body = kind === 'unexpected' ? undefined : { discountCode: discount.code };
    f.stripe.checkout.sessions.create = async (...args) => {
      // The recorded Stripe session stays intact; only the uncertain response is
      // corrupted, so an ordinary retrieve can safely reconcile the original later.
      const session = clone(await createSession(...args));
      if (kind === 'missing') delete session.metadata.owner_discount_id;
      else session.metadata.owner_discount_id = 'different_owner_discount';
      return session;
    };
    const response = await f.checkout('monthly', body);
    assert.equal(response.status, 409); assert.equal((await response.json()).checkoutUrl, undefined);
    assert.equal(f.calls.checkouts, 1);
    assert.equal((await f.checkout('monthly', body)).status, 201, 'retry retrieves the verified original rather than creating a second session');
    assert.equal(f.calls.checkouts, 1);
  });
});

test('an owner pause while Stripe is creating the session withholds its checkout URL and blocks resume', async t => {
  const f = await fixture(t), createSession = f.stripe.checkout.sessions.create;
  f.stripe.checkout.sessions.create = async (...args) => {
    const session = await createSession(...args); await f.setPolicy({ acceptNewPurchases: false }); return session;
  };
  const response = await f.checkout('monthly');
  assert.equal(response.status, 409); assert.equal((await response.json()).checkoutUrl, undefined);
  assert.equal(f.calls.checkouts, 1, 'Stripe created a session in flight, but the new URL is withheld');
  const reads = f.calls.priceReads;
  const resumed = await f.checkout('monthly');
  assert.equal(resumed.status, 409); assert.equal((await resumed.json()).checkoutUrl, undefined);
  assert.equal(f.calls.priceReads, reads, 'paused resume makes no Stripe request'); assert.equal(f.calls.checkouts, 1);
});

test('a code deactivated while Stripe is creating the session withholds its checkout URL', async t => {
  const f = await fixture(t), discount = await f.discount(), createSession = f.stripe.checkout.sessions.create;
  f.stripe.checkout.sessions.create = async (...args) => {
    const session = await createSession(...args); await f.deactivate(discount.id); return session;
  };
  const response = await f.checkout('monthly', { discountCode: discount.code });
  assert.equal(response.status, 400); assert.equal((await response.json()).checkoutUrl, undefined);
  assert.equal(f.calls.checkouts, 1); assert.equal(f.promotions.get('promo_1').active, false);
  assert.equal((await f.checkout('monthly', { discountCode: discount.code })).status, 400); assert.equal(f.calls.checkouts, 1);
});

test('a code deactivated while an open session is retrieved also withholds its URL', async t => {
  const f = await fixture(t), discount = await f.discount();
  assert.equal((await f.checkout('monthly', { discountCode: discount.code })).status, 201);
  const retrieveSession = f.stripe.checkout.sessions.retrieve;
  f.stripe.checkout.sessions.retrieve = async (...args) => {
    const session = await retrieveSession(...args); await f.deactivate(discount.id); return session;
  };
  const response = await f.checkout('monthly', { discountCode: discount.code });
  assert.equal(response.status, 400); assert.equal((await response.json()).checkoutUrl, undefined);
  assert.equal(f.calls.checkouts, 1);
});
