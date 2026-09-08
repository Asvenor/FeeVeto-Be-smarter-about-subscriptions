import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/sqlite-d1.js';
import { handleAdminSettingsRequest } from '../functions/api/admin/settings.js';
import { handleAdminDiscountsRequest } from '../functions/api/admin/discounts.js';
import { AccessConfigurationError } from '../functions/_shared/clerk-access.js';
import { BillingConfigurationError } from '../functions/_shared/billing-config.js';
import { activateOwnerDiscount, createOwnerDiscount, deactivateOwnerDiscount, getOwnerSettings, listOwnerDiscounts,
  OwnerControlsError, resolveCheckoutDiscount, updateOwnerSettings, validateDiscountInput } from '../functions/_shared/owner-controls.js';

const actor = 'user_owner_test';
const owner = { userId: actor, user: { privateMetadata: { role: 'admin', betaAccess: false } } };
const ownerResolver = async () => owner;
const now = Math.floor(Date.now() / 1000);
const input = (overrides = {}) => ({ requestId: crypto.randomUUID(), code: 'FRIENDS20', percentOff: 20, plan: 'monthly', duration: 'once', ...overrides });
const flags = (overrides = {}) => ({ revision: 0, acceptNewPurchases: true, monthlyEnabled: true, lifetimeEnabled: true, ...overrides });
function context(env, path, method = 'GET', body, headers = {}) {
  return { env, request: new Request(`https://feeveto.example/api/admin/${path}`, { method,
    headers: { ...(body === undefined ? {} : { Origin: 'https://feeveto.example', 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }) };
}
async function fixture(t) {
  const db = await testDatabase({ billing: true });
  t.after(() => db.close());
  const env = { FEEVETO_BILLING: db, BILLING_MODE: 'test', BILLING_ENABLED: 'false',
    STRIPE_SECRET_KEY: 'sk_test_fictional', STRIPE_MONTHLY_PRICE_ID: 'price_monthly', STRIPE_LIFETIME_PRICE_ID: 'price_lifetime' };
  const coupons = new Map(), promotions = new Map(), keys = new Map();
  const calls = { couponCreates: 0, promotionCreates: 0, updates: [], prices: 0, afterCouponCreate: null, afterPromotionCreate: null, duringActivate: null, duringDeactivate: null };
  const missing = () => Object.assign(new Error('Stripe fixture resource missing'), { code: 'resource_missing', statusCode: 404 });
  const clone = value => structuredClone(value);
  const stripe = {
    prices: { retrieve: async id => {
      calls.prices++;
      return { id, active: true, livemode: env.BILLING_MODE === 'live', currency: 'usd', product: 'prod_shared',
        unit_amount: id === 'price_monthly' ? 299 : 4999,
        recurring: id === 'price_monthly' ? { interval: 'month', interval_count: 1, usage_type: 'licensed' } : null };
    } },
    coupons: {
      retrieve: async id => { if (!coupons.has(id)) throw missing(); return clone(coupons.get(id)); },
      create: async (body, options) => {
        if (keys.has(options.idempotencyKey)) return clone(keys.get(options.idempotencyKey));
        calls.couponCreates++;
        const coupon = { ...clone(body), livemode: env.BILLING_MODE === 'live', valid: true, amount_off: null };
        coupons.set(coupon.id, coupon); keys.set(options.idempotencyKey, coupon);
        if (calls.afterCouponCreate) { const hook = calls.afterCouponCreate; calls.afterCouponCreate = null; await hook(); }
        return clone(coupon);
      },
    },
    promotionCodes: {
      retrieve: async id => { if (!promotions.has(id)) throw missing(); return clone(promotions.get(id)); },
      list: async ({ code }) => ({ data: [...promotions.values()].filter(value => value.code === code).map(clone), has_more: false }),
      create: async (body, options) => {
        if (keys.has(options.idempotencyKey)) return clone(keys.get(options.idempotencyKey));
        calls.promotionCreates++;
        const promotion = { ...clone(body), id: `promo_${calls.promotionCreates}`, livemode: env.BILLING_MODE === 'live', times_redeemed: 0 };
        promotions.set(promotion.id, promotion); keys.set(options.idempotencyKey, promotion);
        if (calls.afterPromotionCreate) { const hook = calls.afterPromotionCreate; calls.afterPromotionCreate = null; await hook(); }
        return clone(promotion);
      },
      update: async (id, body) => {
        calls.updates.push({ id, ...body });
        if (body.active && calls.duringActivate) { const hook = calls.duringActivate; calls.duringActivate = null; await hook(); }
        const promotion = promotions.get(id);
        Object.assign(promotion, body);
        if (!body.active && calls.duringDeactivate) { const hook = calls.duringDeactivate; calls.duringDeactivate = null; await hook(); }
        return clone(promotion);
      },
    },
  };
  const create = body => createOwnerDiscount({ env, actor, body: body || input(), now });
  const activate = id => activateOwnerDiscount({ env, stripe, actor, body: { id, action: 'activate' }, now });
  const deactivate = id => deactivateOwnerDiscount({ env, stripe, actor, body: { id, active: false }, now });
  return { db, env, stripe, calls, coupons, promotions, create, activate, deactivate };
}

test('owner endpoints deny signed out, ordinary, beta, paid flags, and user-editable role metadata', async () => {
  const identities = [null,
    { userId: 'ordinary', user: { privateMetadata: { role: 'user' } } },
    { userId: 'beta', user: { privateMetadata: { role: 'user', betaAccess: true } } },
    { userId: 'paid', user: { privateMetadata: { premiumAccess: true, paidPremiumAccess: true } } },
    { userId: 'forged', user: { publicMetadata: { role: 'admin' }, unsafeMetadata: { role: 'admin' } } },
    { userId: 'badtype', user: { privateMetadata: { role: ['admin'], betaAccess: true } } },
  ];
  for (const identity of identities) for (const [handler, path, methods] of [
    [handleAdminSettingsRequest, 'settings', ['GET', 'PUT']], [handleAdminDiscountsRequest, 'discounts', ['GET', 'POST', 'PATCH']],
  ]) for (const method of methods) {
    const response = await handler(context({}, path, method, method === 'GET' ? undefined : { role: 'admin' }), { identityResolver: async () => identity });
    assert.equal(response.status, identity ? 403 : 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('Clerk outages, missing credentials, missing D1 and missing migration fail closed without details', async () => {
  for (const handler of [handleAdminSettingsRequest, handleAdminDiscountsRequest]) {
    const configFailure = await handler(context({}, 'settings'), { identityResolver: async () => { throw new AccessConfigurationError('secret must never reach the response'); } });
    assert.equal(configFailure.status, 503); assert.doesNotMatch(await configFailure.text(), /secret must/);
    assert.equal((await handler(context({}, 'settings'))).status, 503);
    assert.equal((await handler(context({}, 'settings'), { identityResolver: ownerResolver })).status, 503);
  }
  const missingTable = { FEEVETO_BILLING: { prepare: () => { throw new Error('no such private table'); } } };
  assert.equal((await handleAdminSettingsRequest(context(missingTable, 'settings'), { identityResolver: ownerResolver })).status, 503);
  await assert.rejects(() => getOwnerSettings({ env: missingTable }), BillingConfigurationError);
});

test('default settings are paused, readonly, mode-isolated, and use primary reads', async t => {
  const { db, env } = await fixture(t);
  const sessions = [];
  const primaryEnv = { ...env, FEEVETO_BILLING: { prepare: db.prepare, withSession: value => { sessions.push(value); return db; } } };
  assert.deepEqual(await getOwnerSettings({ env: primaryEnv }), { revision: 0, acceptNewPurchases: false, monthlyEnabled: true, lifetimeEnabled: true, updatedAt: null, updatedBy: null });
  assert.deepEqual(sessions, ['first-primary']);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM owner_settings').first()).n, 0);
  await updateOwnerSettings({ env, actor, body: flags() });
  assert.equal((await getOwnerSettings({ env })).acceptNewPurchases, true);
  assert.equal((await getOwnerSettings({ env: { ...env, BILLING_MODE: 'live' } })).acceptNewPurchases, false);
});

test('settings updates use revision CAS, atomic audit logging, and cannot change launch locks', async t => {
  const { db, env } = await fixture(t);
  const response = await handleAdminSettingsRequest(context(env, 'settings', 'PUT', flags({ monthlyEnabled: false })), { identityResolver: ownerResolver });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.settings.revision, 1); assert.equal(value.settings.monthlyEnabled, false);
  assert.equal(value.runtime.billingEnabled, false); assert.equal(env.BILLING_ENABLED, 'false');
  assert.equal(value.settings.updatedBy, actor);
  const conflict = await handleAdminSettingsRequest(context(env, 'settings', 'PUT', flags()), { identityResolver: ownerResolver });
  assert.equal(conflict.status, 409);
  const history = (await db.prepare('SELECT * FROM owner_settings_history').all()).results;
  assert.equal(history.length, 1); assert.equal(history[0].updated_by, actor); assert.equal(history[0].monthly_enabled, 0);
  const forged = await handleAdminSettingsRequest(context(env, 'settings', 'PUT', flags({ revision: 1, BILLING_ENABLED: 'true' })), { identityResolver: ownerResolver });
  assert.equal(forged.status, 400);
  await db.prepare('DROP TABLE owner_settings_history').run();
  await assert.rejects(() => updateOwnerSettings({ env, actor, body: flags({ revision: 1 }) }));
  assert.equal((await getOwnerSettings({ env })).revision, 1, 'audit failure rolls back the settings update');
});

test('owner mutations reject cross-origin, missing Origin, non-JSON, malformed and oversized bodies', async t => {
  const { env } = await fixture(t);
  for (const [handler, path, method, body] of [[handleAdminSettingsRequest, 'settings', 'PUT', flags()], [handleAdminDiscountsRequest, 'discounts', 'POST', input()]]) {
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await handler(context(env, path, method, body, headers), { identityResolver: ownerResolver })).status, 403);
    }
    assert.equal((await handler(context(env, path, method, body, { 'Content-Type': 'text/plain' }), { identityResolver: ownerResolver })).status, 415);
    assert.equal((await handler(context(env, path, method, '{broken'), { identityResolver: ownerResolver })).status, 400);
    assert.equal((await handler(context(env, path, method, ' '.repeat(4097)), { identityResolver: ownerResolver })).status, 413);
    assert.equal((await handler(context(env, path, method, body, { 'Content-Length': '4097' }), { identityResolver: ownerResolver })).status, 413);
  }
});

test('strict settings and discount validation keeps booleans explicit and discounts below free', async () => {
  for (const invalid of [{ percentOff: 0 }, { percentOff: 100 }, { percentOff: 81 }, { percentOff: 20.5 }, { percentOff: '20' },
    { plan: 'enterprise' }, { plan: 'lifetime', duration: 'forever' }, { duration: 'repeating' }, { code: '<script>' },
    { code: 'SHORT' }, { code: 'A'.repeat(33) }, { expiresAt: now - 1 }, { expiresAt: now + 6 * 365 * 86400 },
    { maxRedemptions: 0 }, { maxRedemptions: 100001 }, { requestId: 'not-a-uuid' }, { active: true }, { role: 'admin' }]) {
    assert.throws(() => validateDiscountInput(input(invalid), now), OwnerControlsError);
  }
  const result = validateDiscountInput(input({ code: '  friends20  ', percentOff: 80, plan: 'both', duration: 'forever', maxRedemptions: 10 }), now);
  assert.equal(result.code, 'FRIENDS20'); assert.equal(result.expiresAt, null);
});

test('owner can save, list and discard a draft without any Stripe configuration or call', async t => {
  const { env, db } = await fixture(t);
  delete env.STRIPE_SECRET_KEY; delete env.STRIPE_MONTHLY_PRICE_ID; delete env.STRIPE_LIFETIME_PRICE_ID;
  const options = { identityResolver: ownerResolver, stripeClientFactory: () => { throw new Error('Stripe must not be touched'); } };
  const created = await handleAdminDiscountsRequest(context(env, 'discounts', 'POST', input()), options);
  assert.equal(created.status, 201);
  const { discount } = await created.json(); assert.equal(discount.status, 'draft'); assert.equal(discount.active, false);
  const listed = await handleAdminDiscountsRequest(context(env, 'discounts'), options);
  const list = await listed.json(); assert.equal(list.stripeReady, false); assert.equal(list.discounts[0].code, 'FRIENDS20');
  assert.equal(list.discounts[0].timesRedeemed, null, 'unqueried Stripe usage must not appear as zero');
  const activation = await handleAdminDiscountsRequest(context(env, 'discounts', 'PATCH', { id: discount.id, action: 'activate' }), { identityResolver: ownerResolver });
  assert.equal(activation.status, 503);
  assert.equal((await listOwnerDiscounts({ env })).discounts[0].status, 'draft');
  const disabled = await handleAdminDiscountsRequest(context(env, 'discounts', 'PATCH', { id: discount.id, active: false }), options);
  assert.equal(disabled.status, 200); assert.equal((await disabled.json()).discount.status, 'inactive');
  const history = (await db.prepare('SELECT * FROM owner_discount_history ORDER BY event_id').all()).results;
  assert.deepEqual(history.map(row => row.status), ['draft', 'inactive']);
  assert.ok(history.every(row => row.updated_by === actor));
});

test('draft creation is idempotent, rejects changed requests and permanently reserves unique codes per mode', async t => {
  const { env, create, calls } = await fixture(t);
  const body = input(), first = await create(body), retry = await create(body);
  assert.equal(first.id, retry.id); assert.equal(calls.prices, 0); assert.equal(calls.couponCreates, 0);
  await assert.rejects(() => create({ ...body, percentOff: 21 }), error => error.status === 409);
  await assert.rejects(() => create(input()), error => error.code === 'code_exists');
  await assert.rejects(() => createOwnerDiscount({ env, actor: 'another_admin', body }), error => error.code === 'request_changed');
  const live = await createOwnerDiscount({ env: { ...env, BILLING_MODE: 'live' }, actor, body });
  assert.notEqual(live.id, first.id);
});

test('explicit activation creates verified Stripe coupon and code, and real plan allowlist defeats shared-product bypass', async t => {
  const { env, stripe, create, activate, calls, coupons, promotions } = await fixture(t);
  const draft = await create(input({ duration: 'forever', maxRedemptions: 10, expiresAt: now + 86400 }));
  assert.equal(await resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: '' }), null);
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), error => error.code === 'discount_unavailable');
  const active = await activate(draft.id);
  assert.equal(active.active, true); assert.equal(calls.couponCreates, 1); assert.equal(calls.promotionCreates, 1);
  assert.equal(coupons.values().next().value.duration, 'forever');
  assert.deepEqual(coupons.values().next().value.applies_to, { products: ['prod_shared'] });
  assert.equal(promotions.values().next().value.active, true);
  assert.deepEqual(await resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: ' friends20 ' }), { promotionCodeId: 'promo_1', discountId: draft.id });
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'lifetime', code: draft.code }), error => error.status === 400);
  await assert.rejects(() => resolveCheckoutDiscount({ env: { ...env, BILLING_MODE: 'live' }, stripe, plan: 'monthly', code: draft.code }), error => error.status === 400);
  assert.equal((await activate(draft.id)).id, draft.id); assert.equal(calls.couponCreates, 1);
});

test('lifetime and both-plan discounts apply only with their validated durations and prices', async t => {
  const { env, stripe, create, activate } = await fixture(t);
  const life = await create(input({ code: 'LIFETIME20', plan: 'lifetime', duration: 'once' }));
  await activate(life.id);
  assert.equal((await resolveCheckoutDiscount({ env, stripe, plan: 'lifetime', code: life.code })).discountId, life.id);
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: life.code }), OwnerControlsError);
  const both = await create(input({ code: 'BOTHPLAN20', plan: 'both' })); await activate(both.id);
  for (const plan of ['monthly', 'lifetime']) assert.equal((await resolveCheckoutDiscount({ env, stripe, plan, code: both.code })).discountId, both.id);
});

test('activation retries recover coupon and promotion timeout orphans without duplicate Stripe resources', async t => {
  const { env, create, activate, calls } = await fixture(t);
  const draft = await create();
  calls.afterCouponCreate = async () => { throw new Error('network timeout after coupon creation'); };
  await assert.rejects(() => activate(draft.id));
  assert.equal((await listOwnerDiscounts({ env })).discounts[0].status, 'pending');
  calls.afterPromotionCreate = async () => { throw new Error('network timeout after promotion creation'); };
  await assert.rejects(() => activate(draft.id));
  assert.equal((await activate(draft.id)).status, 'active');
  assert.equal(calls.couponCreates, 1); assert.equal(calls.promotionCreates, 1);
});

test('Stripe conflicts, mismatched modes, prices, products and modified coupons fail closed', async t => {
  const { env, stripe, create, activate, coupons, promotions } = await fixture(t);
  const draft = await create(); await activate(draft.id);
  const promotion = promotions.get('promo_1'), coupon = [...coupons.values()][0];
  promotion.livemode = true;
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), BillingConfigurationError);
  promotion.livemode = false; coupon.percent_off = 100;
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), BillingConfigurationError);
  coupon.percent_off = 20; coupon.applies_to.products = ['prod_other'];
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), BillingConfigurationError);
  coupon.applies_to.products = ['prod_shared']; promotion.metadata.plan = 'both';
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), BillingConfigurationError);
  const second = await create(input({ code: 'OTHERPLAN' }));
  stripe.prices.retrieve = async () => ({ id: 'price_monthly', active: true, currency: 'usd', unit_amount: 299, livemode: true });
  await assert.rejects(() => activate(second.id), BillingConfigurationError);
  assert.equal((await listOwnerDiscounts({ env })).discounts.find(row => row.id === second.id).status, 'draft');
});

test('expired, exhausted, Stripe-disabled and changed-product discounts cannot reach checkout', async t => {
  const { env, stripe, create, activate, promotions } = await fixture(t);
  const draft = await create(input({ expiresAt: now + 86400, maxRedemptions: 2 })); await activate(draft.id);
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code, now: now + 86401 }), OwnerControlsError);
  const promotion = promotions.get('promo_1'); promotion.times_redeemed = 2;
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), OwnerControlsError);
  promotion.times_redeemed = 0; promotion.active = false;
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), OwnerControlsError);
  promotion.active = true;
  const original = stripe.prices.retrieve;
  stripe.prices.retrieve = async id => ({ ...await original(id), product: 'prod_new' });
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), OwnerControlsError);
});

test('deactivation denies locally before Stripe, retries safely, and never changes existing subscriptions', async t => {
  const { env, stripe, create, activate, deactivate, calls, promotions } = await fixture(t);
  const draft = await create(); await activate(draft.id);
  calls.duringDeactivate = async () => { throw new Error('lost deactivation response'); };
  await assert.rejects(() => deactivate(draft.id));
  assert.equal((await listOwnerDiscounts({ env })).discounts[0].status, 'deactivating');
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), OwnerControlsError);
  assert.equal((await deactivate(draft.id)).status, 'inactive'); assert.equal(promotions.get('promo_1').active, false);
  assert.equal((await deactivate(draft.id)).status, 'inactive');
  await assert.rejects(() => activate(draft.id), error => error.code === 'discount_inactive');
  assert.equal(stripe.subscriptions, undefined, 'owner controls never need a subscription mutation API');
});

test('deactivation racing activation wins the local allowlist and remote promotion is disabled again', async t => {
  const { env, stripe, create, activate, deactivate, calls, promotions } = await fixture(t);
  const draft = await create();
  calls.duringActivate = async () => { await deactivate(draft.id); };
  await assert.rejects(() => activate(draft.id), error => error.code === 'discount_inactive');
  assert.equal((await listOwnerDiscounts({ env })).discounts[0].status, 'inactive');
  assert.equal(promotions.get('promo_1').active, false);
  await assert.rejects(() => resolveCheckoutDiscount({ env, stripe, plan: 'monthly', code: draft.code }), OwnerControlsError);
});

test('two activation retries converge without disabling the code completed by the other request', async t => {
  const { env, create, activate, calls, promotions } = await fixture(t);
  const draft = await create();
  calls.afterPromotionCreate = async () => { assert.equal((await activate(draft.id)).status, 'active'); };
  assert.equal((await activate(draft.id)).status, 'active');
  assert.equal((await listOwnerDiscounts({ env })).discounts[0].active, true);
  assert.equal(calls.couponCreates, 1); assert.equal(calls.promotionCreates, 1);
  assert.equal(promotions.get('promo_1').active, true);
});

test('discount checkout rechecks deactivation on a new primary session after remote verification', async t => {
  const { db, env, stripe, create, activate, deactivate } = await fixture(t);
  const draft = await create(); await activate(draft.id);
  const sessions = [];
  const primaryEnv = { ...env, FEEVETO_BILLING: { prepare: db.prepare, withSession: value => { sessions.push(value); return db; } } };
  const original = stripe.prices.retrieve;
  stripe.prices.retrieve = async id => { const price = await original(id); await deactivate(draft.id); return price; };
  await assert.rejects(() => resolveCheckoutDiscount({ env: primaryEnv, stripe, plan: 'monthly', code: draft.code }), OwnerControlsError);
  assert.deepEqual(sessions, ['first-primary', 'first-primary']);
});

test('admin endpoints do not expose Stripe secrets or internal resource payloads and enforce methods', async t => {
  const { env, stripe } = await fixture(t);
  const options = { identityResolver: ownerResolver, stripeClientFactory: () => stripe };
  const created = await handleAdminDiscountsRequest(context(env, 'discounts', 'POST', input()), options);
  const { discount } = await created.json();
  const activated = await handleAdminDiscountsRequest(context(env, 'discounts', 'PATCH', { id: discount.id, action: 'activate' }), options);
  assert.equal(activated.status, 200);
  assert.doesNotMatch(await activated.text(), /sk_test|coupon_id|promotion_code_id|products_json|clerk_user_id/);
  assert.equal((await handleAdminSettingsRequest(context(env, 'settings', 'DELETE'), options)).status, 405);
  assert.equal((await handleAdminDiscountsRequest(context(env, 'discounts', 'PUT', {}), options)).status, 405);
  const invalidPatch = await handleAdminDiscountsRequest(context(env, 'discounts', 'PATCH', { id: discount.id, active: true }), options);
  assert.equal(invalidPatch.status, 400);
});
