import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecommendationQuery, selectRecommendations, validateOffer } from '../functions/_shared/alternatives.js';
import { handleRecommendationsRequest } from '../functions/api/alternatives/recommendations.js';
import { detectSupportedService, serviceById, SERVICE_IDS } from '../js/serviceCatalog.js';

function offer(overrides = {}) {
  return {
    id: 'fictional-paid', productName: 'Fictional Studio', planName: 'Standard', providerServiceId: '',
    relevantServices: ['canva'], productType: 'graphic_design', relationship: 'replacement', pricingModel: 'subscription',
    description: 'A fictional test-only product.', features: ['social_graphics', 'templates'], limitations: ['Fictional limitation.'],
    platforms: ['web'], countryAvailability: { status: 'worldwide', countries: [] }, advertisements: false,
    storageGb: null, freePlanLimits: false, officialUrl: 'https://fictional.example/product', pricingUrl: 'https://fictional.example/pricing',
    sourceUrls: ['https://fictional.example/source'], verifiedAt: '2026-09-06', trialOnly: false,
    affiliateUrl: null, affiliateStatus: 'not_applied', ...overrides,
  };
}

function query(serviceId, overrides = {}) {
  return { serviceId, productType: serviceById(serviceId).productType, mustHave: [], niceToHave: [], acceptAds: true, acceptFreeLimits: true, ...overrides };
}

function access(premiumAccess, authenticated = premiumAccess) {
  return { authenticated, premiumAccess, isAdmin: premiumAccess, betaAccess: false };
}

function request(body, { token = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('https://feeveto.example/api/alternatives/recommendations', { method: 'POST', headers, body: JSON.stringify(body) });
}

test('common aliases detect only the six supported subscriptions', () => {
  assert.equal(detectSupportedService('Adobe Photoshop')?.id, 'photoshop');
  assert.equal(detectSupportedService('Chat GPT')?.id, 'chatgpt');
  assert.equal(detectSupportedService('Some unknown software'), null);
});

test('all six original subscriptions can be matched by product type', () => {
  for (const serviceId of SERVICE_IDS) {
    const service = serviceById(serviceId);
    const item = offer({ id: `fictional-${serviceId}`, relevantServices: [serviceId], productType: service.productType });
    assert.equal(selectRecommendations([item], query(serviceId), { premiumAccess: true }).items.length, 1, serviceId);
  }
});

test('different requirements produce different deterministic results', () => {
  const social = offer({ id: 'fictional-social', features: ['social_graphics'] });
  const presentation = offer({ id: 'fictional-slides', features: ['presentations'] });
  assert.equal(selectRecommendations([social, presentation], query('canva', { mustHave: ['social_graphics'] }), { premiumAccess: true }).items[0].id, 'fictional-social');
  assert.equal(selectRecommendations([social, presentation], query('canva', { mustHave: ['presentations'] }), { premiumAccess: true }).items[0].id, 'fictional-slides');
});

test('an offer missing a must-have feature is excluded', () => {
  const result = selectRecommendations([offer()], query('canva', { mustHave: ['background_removal'] }), { premiumAccess: true });
  assert.equal(result.items.length, 0);
});

test('known incompatible country and platform are excluded while unknown compatibility is labelled', () => {
  const limited = offer({ id: 'limited', platforms: ['windows'], countryAvailability: { status: 'limited', countries: ['US'] } });
  assert.equal(selectRecommendations([limited], query('canva', { country: 'CH', platform: 'macos' }), { premiumAccess: true }).items.length, 0);
  const unknown = offer({ id: 'unknown', platforms: [], countryAvailability: { status: 'unknown', countries: [] }, advertisements: null });
  const result = selectRecommendations([unknown], query('canva', { country: 'CH', platform: 'macos', acceptAds: false }), { premiumAccess: true });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].verificationNotes.length, 3);
});

test('free-plan limits require explicit acceptance', () => {
  const free = offer({ id: 'fictional-free', planName: 'Free', pricingModel: 'free', pricingUrl: null, freePlanLimits: true });
  assert.equal(selectRecommendations([free], query('canva', { acceptFreeLimits: false }), { premiumAccess: true }).items.length, 0);
  assert.equal(selectRecommendations([free], query('canva', { acceptFreeLimits: true }), { premiumAccess: true }).items.length, 1);
});

test('a temporary free trial cannot be classified as a permanent free plan', () => {
  assert.equal(validateOffer(offer({ pricingModel: 'free', trialOnly: true })), null);
});

test('the same service is allowed only as an explicit downgrade', () => {
  const replacement = offer({ id: 'self-replacement', providerServiceId: 'canva', relationship: 'replacement' });
  const downgrade = offer({ id: 'self-downgrade', providerServiceId: 'canva', relationship: 'downgrade' });
  const ids = selectRecommendations([replacement, downgrade], query('canva'), { premiumAccess: true }).items.map((item) => item.id);
  assert.deepEqual(ids, ['self-downgrade']);
  assert.equal(selectRecommendations([downgrade], query('canva'), { premiumAccess: true }).items[0].pricingLabel, 'Downgrade option');
});

test('no supported match returns the honest empty state', () => {
  const result = selectRecommendations([], query('dropbox'), { premiumAccess: true });
  assert.equal(result.items.length, 0);
  assert.equal(result.message, 'No verified alternative matches these requirements yet.');
});

test('duplicate offers are returned once', () => {
  const duplicate = offer();
  assert.equal(selectRecommendations([duplicate, duplicate], query('canva'), { premiumAccess: true }).items.length, 1);
});

test('unsafe and non-HTTPS destinations are rejected', () => {
  assert.equal(validateOffer(offer({ officialUrl: 'javascript:alert(1)' })), null);
  assert.equal(validateOffer(offer({ officialUrl: 'http://fictional.example' })), null);
});

test('responses never invent numerical savings or expose affiliate destinations', () => {
  const [result] = selectRecommendations([offer()], query('canva'), { premiumAccess: true }).items;
  assert.equal('estimatedSavings' in result, false);
  assert.equal('affiliateUrl' in result, false);
  assert.equal(result.pricingLabel, 'Paid alternative');
});

test('invalid requirement identifiers and product types are normalized safely', () => {
  assert.deepEqual(normalizeRecommendationQuery(query('canva', { mustHave: ['templates', 'invented'], productType: 'invented' })).mustHave, ['templates']);
  assert.equal(normalizeRecommendationQuery(query('canva', { productType: 'invented' })).productType, 'graphic_design');
});

test('signed-out and ordinary users cannot retrieve restricted free records directly', async () => {
  const records = [offer(), offer({ id: 'fictional-free', productName: 'Fictional Free Vault', pricingModel: 'free', pricingUrl: null })];
  const catalogueLoader = async () => records;
  const signedOut = await handleRecommendationsRequest({ request: request(query('canva')), env: {} }, { catalogueLoader, accessResolver: async () => access(false, false) });
  const ordinary = await handleRecommendationsRequest({ request: request(query('canva'), { token: 'ordinary' }), env: {} }, { catalogueLoader, accessResolver: async () => access(false, true) });
  for (const response of [signedOut, ordinary]) {
    const raw = await response.text();
    assert.equal(response.status, 200);
    assert.equal(raw.includes('Fictional Free Vault'), false);
    assert.equal(JSON.parse(raw).items.length, 1);
  }
});

test('beta and admin access receive the complete comparison including free records', async () => {
  const free = offer({ id: 'fictional-free', productName: 'Fictional Free Vault', pricingModel: 'free', pricingUrl: null });
  const catalogueLoader = async () => [offer(), free];
  for (const premium of [access(true, true), { ...access(true, true), isAdmin: false, betaAccess: true }]) {
    const response = await handleRecommendationsRequest(
      { request: request(query('canva'), { token: 'premium' }), env: {} },
      { catalogueLoader, accessResolver: async () => premium },
    );
    const body = await response.json();
    assert.equal(body.accessScope, 'complete');
    assert.equal(body.items.some((item) => item.productName === 'Fictional Free Vault'), true);
  }
});
