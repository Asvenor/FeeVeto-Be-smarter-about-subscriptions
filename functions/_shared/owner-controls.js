import { resolveAccess } from './access-policy.js';
import { AccessConfigurationError, getVerifiedIdentity } from './clerk-access.js';
import { BillingConfigurationError, assertStripeMode, billingMode, billingPriceIds, objectId, stripeKeyMatchesMode, validateCheckoutPrice } from './billing-config.js';
import { billingDatabase } from './billing-store.js';
import { BILLING_PLANS } from '../../js/billingPlans.js';
import { json } from './http.js';

export class OwnerControlsError extends Error {
  constructor(status, code, message) { super(message); this.name = 'OwnerControlsError'; this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new OwnerControlsError(status, code, message); };
const seconds = () => Math.floor(Date.now() / 1000);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CODE = /^[A-Z0-9]{8,32}$/;
const MAX_BODY_BYTES = 4096;
function database(env) {
  const db = billingDatabase(env);
  // Owner pauses are safety decisions: never begin from a potentially stale replica.
  return typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
}
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function onlyFields(value, fields) {
  if (!record(value) || Object.keys(value).some(key => !fields.includes(key))) fail(400, 'invalid_input', 'Only the displayed settings may be submitted.');
}
const changes = result => Number(result?.meta?.changes ?? result?.changes ?? 0);

export async function requireOwner(context, identityResolver = getVerifiedIdentity) {
  const identity = await identityResolver(context);
  if (!identity) fail(401, 'sign_in_required', 'Sign in to manage FeeVeto.');
  if (!identity.userId || !resolveAccess({ authenticated: true, privateMetadata: identity.user?.privateMetadata }).isAdmin) {
    fail(403, 'admin_required', 'Owner access is required.');
  }
  return identity;
}

export async function readOwnerJson(request) {
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    fail(403, 'same_origin_required', 'Open FeeVeto directly before changing settings.');
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    fail(415, 'json_required', 'Send these settings as JSON.');
  }
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) fail(413, 'body_too_large', 'This request is too large.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_input', 'Settings are required.');
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); fail(413, 'body_too_large', 'This request is too large.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(text); } catch { fail(400, 'invalid_input', 'The submitted settings could not be read.'); }
  if (!record(body)) fail(400, 'invalid_input', 'Settings must be an object.');
  return body;
}

function publicSettings(row) {
  return { revision: row?.revision ?? 0, acceptNewPurchases: row?.accept_new_purchases === 1,
    monthlyEnabled: row ? row.monthly_enabled === 1 : true, lifetimeEnabled: row ? row.lifetime_enabled === 1 : true,
    updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null };
}
export function ownerRuntime(env) {
  return { billingMode: billingMode(env), billingEnabled: env?.BILLING_ENABLED === 'true',
    stripeReady: stripeKeyMatchesMode(env?.STRIPE_SECRET_KEY, env)
      && ['monthly', 'lifetime'].every(plan => billingPriceIds(env, plan).length > 0) };
}
export async function getOwnerSettings({ env }) {
  try {
    return publicSettings(await database(env).prepare('SELECT * FROM owner_settings WHERE mode = ?').bind(billingMode(env)).first());
  } catch { throw new BillingConfigurationError('Owner settings are not available. New purchases remain paused.'); }
}
export async function updateOwnerSettings({ env, actor, body, now = seconds() }) {
  onlyFields(body, ['revision', 'acceptNewPurchases', 'monthlyEnabled', 'lifetimeEnabled']);
  if (!Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision >= Number.MAX_SAFE_INTEGER
    || ['acceptNewPurchases', 'monthlyEnabled', 'lifetimeEnabled'].some(key => typeof body[key] !== 'boolean')) {
    fail(400, 'invalid_input', 'Use the current revision and a yes/no value for each setting.');
  }
  const db = database(env), mode = billingMode(env);
  // A transaction plus a revision condition prevents a stale tab overwriting a newer pause.
  // The trigger records the actor and resulting flags in the very same transaction.
  const result = await db.batch([
    db.prepare('INSERT OR IGNORE INTO owner_settings (mode) VALUES (?)').bind(mode),
    db.prepare(`UPDATE owner_settings SET accept_new_purchases = ?, monthly_enabled = ?, lifetime_enabled = ?,
      revision = revision + 1, updated_at = ?, updated_by = ? WHERE mode = ? AND revision = ?`)
      .bind(Number(body.acceptNewPurchases), Number(body.monthlyEnabled), Number(body.lifetimeEnabled), now, actor, mode, body.revision),
  ]);
  if (!changes(result[1])) fail(409, 'settings_changed', 'Settings changed in another tab. Reload them before saving again.');
  return publicSettings(await db.prepare('SELECT * FROM owner_settings WHERE mode = ?').bind(mode).first());
}

export function validateDiscountInput(body, now = seconds()) {
  onlyFields(body, ['requestId', 'code', 'percentOff', 'plan', 'duration', 'expiresAt', 'maxRedemptions']);
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!UUID.test(body.requestId || '')) fail(400, 'invalid_input', 'A unique request identifier is required.');
  if (!CODE.test(code)) fail(400, 'invalid_input', 'Use 8–32 letters or numbers for the discount code.');
  if (!Number.isInteger(body.percentOff) || body.percentOff < 1 || body.percentOff > 80) fail(400, 'invalid_input', 'Choose a whole-number discount from 1% to 80%.');
  if (!['monthly', 'lifetime', 'both'].includes(body.plan) || !['once', 'forever'].includes(body.duration)
    || (body.plan === 'lifetime' && body.duration !== 'once')) fail(400, 'invalid_input', 'Choose a valid plan and discount duration. Lifetime discounts apply once.');
  const expiresAt = body.expiresAt ?? null, maxRedemptions = body.maxRedemptions ?? null;
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 5 * 365 * 86400)) {
    fail(400, 'invalid_input', 'Choose an expiry in the future, no more than five years away.');
  }
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000)) {
    fail(400, 'invalid_input', 'The redemption limit must be between 1 and 100,000.');
  }
  return { requestId: body.requestId.toLowerCase(), code, percentOff: body.percentOff, plan: body.plan, duration: body.duration, expiresAt, maxRedemptions };
}
function publicDiscount(row, now = seconds()) {
  return { id: row.id, requestId: row.request_id, code: row.code, percentOff: row.percent_off, plan: row.plan, duration: row.duration,
    expiresAt: row.expires_at, maxRedemptions: row.max_redemptions, timesRedeemed: null,
    active: row.status === 'active' && (!row.expires_at || row.expires_at > now), status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
const rowFor = (db, mode, id) => db.prepare('SELECT * FROM owner_discounts WHERE mode = ? AND id = ?').bind(mode, id).first();
function sameInput(row, input) {
  return row.request_id === input.requestId && row.code === input.code && row.percent_off === input.percentOff
    && row.plan === input.plan && row.duration === input.duration && row.expires_at === input.expiresAt && row.max_redemptions === input.maxRedemptions;
}
function metadata(row) { return { application: 'feeveto', owner_discount_id: row.id, billing_mode: row.mode, plan: row.plan }; }
function matchesMetadata(value, row) {
  const expected = metadata(row);
  return Object.keys(expected).every(key => value?.metadata?.[key] === expected[key]);
}
function validateCoupon(coupon, row, env, { requireValid = true } = {}) {
  assertStripeMode(coupon, env);
  const products = [...(coupon.applies_to?.products || [])].sort();
  if (coupon.id !== row.coupon_id || coupon.deleted || (requireValid && coupon.valid !== true) || !matchesMetadata(coupon, row)
    || coupon.percent_off !== row.percent_off || coupon.amount_off != null || coupon.duration !== row.duration
    || (coupon.redeem_by ?? null) !== row.expires_at || (coupon.max_redemptions ?? null) !== row.max_redemptions
    || JSON.stringify(products) !== row.products_json) throw new BillingConfigurationError('Discount validation failed.');
}
function validatePromotion(promotion, row, env) {
  assertStripeMode(promotion, env);
  if (promotion.code?.toUpperCase() !== row.code || !matchesMetadata(promotion, row)
    || promotion.promotion?.type !== 'coupon' || objectId(promotion.promotion.coupon) !== row.coupon_id
    || (row.promotion_code_id && promotion.id !== row.promotion_code_id)
    || (promotion.expires_at ?? null) !== row.expires_at || (promotion.max_redemptions ?? null) !== row.max_redemptions
    || promotion.customer || promotion.customer_account || promotion.restrictions?.minimum_amount
    || promotion.restrictions?.first_time_transaction === true) throw new BillingConfigurationError('Discount validation failed.');
}
async function verifiedProducts(env, stripe, plan) {
  if (!stripeKeyMatchesMode(env?.STRIPE_SECRET_KEY, env)) throw new BillingConfigurationError('Stripe is not configured.');
  const products = [];
  for (const selected of plan === 'both' ? ['monthly', 'lifetime'] : [plan]) {
    const priceId = billingPriceIds(env, selected)[0];
    if (!priceId) throw new BillingConfigurationError('The selected plan is not configured.');
    const price = await stripe.prices.retrieve(priceId);
    validateCheckoutPrice(price, { ...BILLING_PLANS[selected], priceId }, env);
    const product = objectId(price.product);
    if (!/^prod_[a-zA-Z0-9_]+$/.test(product)) throw new BillingConfigurationError('The plan product is not configured.');
    products.push(product);
  }
  return JSON.stringify([...new Set(products)].sort());
}
function notFound(error) { return error?.code === 'resource_missing' && error?.statusCode === 404; }

export async function listOwnerDiscounts({ env }) {
  const rows = (await database(env).prepare('SELECT * FROM owner_discounts WHERE mode = ? ORDER BY created_at DESC, id LIMIT 201').bind(billingMode(env)).all()).results;
  return { discounts: rows.slice(0, 200).map(row => publicDiscount(row)), hasMore: rows.length > 200 };
}

export async function createOwnerDiscount({ env, actor, body, now = seconds() }) {
  const input = validateDiscountInput(body, now), db = database(env), mode = billingMode(env);
  let row = await db.prepare('SELECT * FROM owner_discounts WHERE mode = ? AND request_id = ?').bind(mode, input.requestId).first();
  if (row && (!sameInput(row, input) || row.created_by !== actor)) fail(409, 'request_changed', 'This request was already used. Retry its original details or start a new code.');
  if (!row) {
    const id = crypto.randomUUID();
    await db.prepare(`INSERT OR IGNORE INTO owner_discounts (mode, id, request_id, code, percent_off, plan, duration,
      expires_at, max_redemptions, coupon_id, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(mode, id, input.requestId, input.code, input.percentOff, input.plan, input.duration, input.expiresAt, input.maxRedemptions,
        `fv_${mode}_${id.replaceAll('-', '')}`, now, actor, now, actor).run();
    row = await db.prepare('SELECT * FROM owner_discounts WHERE mode = ? AND request_id = ?').bind(mode, input.requestId).first();
    if (!row) fail(409, 'code_exists', 'That code is already reserved. Choose a different code.');
    if (!sameInput(row, input) || row.created_by !== actor) fail(409, 'request_changed', 'This request was already used for different details.');
  }
  return publicDiscount(row, now);
}

export async function activateOwnerDiscount({ env, stripe, actor, body, now = seconds() }) {
  onlyFields(body, ['id', 'action']);
  if (!UUID.test(body.id || '') || body.action !== 'activate') fail(400, 'invalid_input', 'Choose an existing draft to activate.');
  const db = database(env), mode = billingMode(env);
  let row = await rowFor(db, mode, body.id);
  if (!row) fail(404, 'discount_not_found', 'Discount code not found.');
  if (row.status === 'active') return publicDiscount(row, now);
  if (row.expires_at && row.expires_at <= now) fail(400, 'discount_expired', 'This draft has expired. Create a new code with a future expiry.');
  if (row.status === 'draft') {
    const products = await verifiedProducts(env, stripe, row.plan);
    await db.prepare(`UPDATE owner_discounts SET products_json = ?, status = 'pending', updated_at = ?, updated_by = ?
      WHERE mode = ? AND id = ? AND status = 'draft'`).bind(products, now, actor, mode, row.id).run();
    row = await rowFor(db, mode, row.id);
  }
  if (row.status !== 'pending') fail(409, 'discount_inactive', 'This discount has been deactivated. Create a new code instead.');

  // Stable coupon ID and promotion lookup recover even after Stripe's idempotency window.
  // No raw Stripe error, customer data, credentials, or request body is logged or returned.
  let coupon;
  try { coupon = await stripe.coupons.retrieve(row.coupon_id); } catch (error) { if (!notFound(error)) throw error; }
  if (!coupon) coupon = await stripe.coupons.create({ id: row.coupon_id, percent_off: row.percent_off, duration: row.duration,
    applies_to: { products: JSON.parse(row.products_json) }, metadata: metadata(row),
    ...(row.expires_at ? { redeem_by: row.expires_at } : {}), ...(row.max_redemptions ? { max_redemptions: row.max_redemptions } : {}),
  }, { idempotencyKey: `feeveto:owner:coupon:${mode}:${row.id}` });
  validateCoupon(coupon, row, env);

  let promotion;
  if (row.promotion_code_id) promotion = await stripe.promotionCodes.retrieve(row.promotion_code_id);
  else {
    const existing = await stripe.promotionCodes.list({ code: row.code, limit: 100 });
    if (existing.has_more || existing.data.some(value => !matchesMetadata(value, row))) fail(409, 'code_exists', 'That code already exists in Stripe. Choose a different code.');
    if (existing.data.length > 1) throw new BillingConfigurationError('Discount reconciliation requires review.');
    promotion = existing.data[0];
    if (!promotion) promotion = await stripe.promotionCodes.create({ promotion: { type: 'coupon', coupon: row.coupon_id },
      code: row.code, active: false, metadata: metadata(row),
      ...(row.expires_at ? { expires_at: row.expires_at } : {}), ...(row.max_redemptions ? { max_redemptions: row.max_redemptions } : {}),
    }, { idempotencyKey: `feeveto:owner:promotion:${mode}:${row.id}` });
  }
  validatePromotion(promotion, row, env);
  const bound = await db.prepare(`UPDATE owner_discounts SET promotion_code_id = ? WHERE mode = ? AND id = ? AND status = 'pending'
    AND (promotion_code_id IS NULL OR promotion_code_id = ?)`).bind(promotion.id, mode, row.id, promotion.id).run();
  if (!changes(bound)) {
    const latest = await rowFor(database(env), mode, row.id);
    // A concurrent retry may have completed this same activation already.
    if (latest?.status === 'active' && latest.promotion_code_id === promotion.id) return publicDiscount(latest, now);
    await stripe.promotionCodes.update(promotion.id, { active: false });
    fail(409, 'discount_inactive', 'The code was deactivated while it was being prepared.');
  }
  promotion = await stripe.promotionCodes.update(promotion.id, { active: true }, { idempotencyKey: `feeveto:owner:activate:${mode}:${row.id}` });
  validatePromotion(promotion, row, env);
  if (promotion.active !== true) throw new BillingConfigurationError('Discount activation requires review.');
  const activated = await db.prepare(`UPDATE owner_discounts SET status = 'active', updated_at = ?, updated_by = ?
    WHERE mode = ? AND id = ? AND status = 'pending'`).bind(now, actor, mode, row.id).run();
  row = await rowFor(db, mode, row.id);
  if (!changes(activated) && row.status !== 'active') {
    await stripe.promotionCodes.update(promotion.id, { active: false });
    fail(409, 'discount_inactive', 'The code was deactivated while it was being prepared.');
  }
  return publicDiscount(row, now);
}

export async function deactivateOwnerDiscount({ env, stripe, stripeClientFactory, actor, body, now = seconds() }) {
  onlyFields(body, ['id', 'active']);
  if (!UUID.test(body.id || '') || body.active !== false) fail(400, 'invalid_input', 'Choose an existing code to deactivate.');
  const db = database(env), mode = billingMode(env);
  let row = await rowFor(db, mode, body.id);
  if (!row) fail(404, 'discount_not_found', 'Discount code not found.');
  if (row.status === 'inactive') return publicDiscount(row, now);
  if (row.status === 'draft') {
    await db.prepare(`UPDATE owner_discounts SET status = 'inactive', updated_at = ?, updated_by = ?
      WHERE mode = ? AND id = ? AND status = 'draft'`).bind(now, actor, mode, row.id).run();
    row = await rowFor(db, mode, row.id);
    if (row.status === 'inactive') return publicDiscount(row, now);
  }
  // Deny new application before the network call. A Stripe outage cannot leave the
  // code usable through FeeVeto; retrying finishes remote deactivation safely.
  await db.prepare(`UPDATE owner_discounts SET status = 'deactivating', updated_at = ?, updated_by = ?
    WHERE mode = ? AND id = ? AND status IN ('pending', 'active')`).bind(now, actor, mode, row.id).run();
  row = await rowFor(db, mode, row.id);
  stripe ||= stripeClientFactory(env);
  let promotion;
  if (row.promotion_code_id) promotion = await stripe.promotionCodes.retrieve(row.promotion_code_id);
  else {
    const existing = await stripe.promotionCodes.list({ code: row.code, limit: 100 });
    if (existing.has_more) throw new BillingConfigurationError('Discount reconciliation requires review.');
    promotion = existing.data.find(value => matchesMetadata(value, row));
  }
  if (promotion) {
    validatePromotion(promotion, row, env);
    const disabled = await stripe.promotionCodes.update(promotion.id, { active: false }, { idempotencyKey: `feeveto:owner:deactivate:${mode}:${row.id}` });
    assertStripeMode(disabled, env);
    if (disabled.active !== false) throw new BillingConfigurationError('Discount deactivation requires review.');
  }
  await db.prepare(`UPDATE owner_discounts SET status = 'inactive', updated_at = ?, updated_by = ?
    WHERE mode = ? AND id = ? AND status = 'deactivating'`).bind(now, actor, mode, row.id).run();
  return publicDiscount(await rowFor(db, mode, row.id), now);
}

export async function resolveCheckoutDiscount({ env, stripe, plan, code, now = seconds() }) {
  if (code === undefined || code === null || code === '') return null;
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  const unavailable = () => fail(400, 'discount_unavailable', 'This discount code is not available for the selected plan.');
  if (!CODE.test(normalized) || !['monthly', 'lifetime'].includes(plan)) unavailable();
  const db = database(env), mode = billingMode(env);
  const row = await db.prepare('SELECT * FROM owner_discounts WHERE mode = ? AND code = ?').bind(mode, normalized).first();
  if (!row || row.status !== 'active' || (row.plan !== 'both' && row.plan !== plan) || (row.expires_at && row.expires_at <= now) || !row.promotion_code_id) unavailable();
  const promotion = await stripe.promotionCodes.retrieve(row.promotion_code_id);
  validatePromotion(promotion, row, env);
  if (promotion.active !== true || (promotion.expires_at && promotion.expires_at <= now)
    || (promotion.max_redemptions && promotion.times_redeemed >= promotion.max_redemptions)) unavailable();
  const coupon = await stripe.coupons.retrieve(row.coupon_id);
  validateCoupon(coupon, row, env);
  // Price/product configuration may have changed since the owner created this code.
  const products = JSON.parse(await verifiedProducts(env, stripe, plan));
  if (!products.every(product => JSON.parse(row.products_json).includes(product))) unavailable();
  // Recheck the local kill switch after remote verification, without trusting Stripe
  // product restrictions to separate monthly/lifetime prices on a shared product.
  if ((await rowFor(database(env), mode, row.id))?.status !== 'active') unavailable();
  return { promotionCodeId: promotion.id, discountId: row.id };
}

export function ownerErrorResponse(error) {
  if (error instanceof OwnerControlsError) return json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof AccessConfigurationError || error instanceof BillingConfigurationError) {
    return json({ error: 'Owner controls are not configured or could not be verified safely. Purchases remain subject to the launch lock.', code: 'owner_unavailable' }, { status: 503 });
  }
  return json({ error: 'The operation could not be completed safely. Reload settings, or retry the same discount request without changing its details.', code: 'owner_retry_required' }, { status: 503 });
}
