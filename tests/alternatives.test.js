import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecommendationQuery, selectRecommendations, validateOffer } from '../functions/_shared/alternatives.js';
import { CatalogueConfigurationError, loadPrivateCatalogue } from '../functions/_shared/catalogue-store.js';
import { handleRecommendationsRequest } from '../functions/api/alternatives/recommendations.js';
import { AlternativeRequestError, AlternativeRequestTracker, BackendAlternativesProvider, alternativeUpdateAnnouncement, normalizeAlternativesResponse, recommendationRequestFor } from '../js/alternativeProvider.js';

test('failed refresh announces the error instead of claiming alternatives updated', () => {
  const message = 'Too many requests. Wait a minute, then retry.';
  assert.equal(alternativeUpdateAnnouncement({ status: 'error', message }), message);
  assert.match(alternativeUpdateAnnouncement({ status: 'error' }), /could not be loaded.*saved.*retry/i);
  assert.match(alternativeUpdateAnnouncement({ status: 'ready' }), /Alternatives updated/);
});
import { detectSupportedService, serviceById, SERVICE_IDS } from '../js/serviceCatalog.js';

function offer(overrides = {}) {
  const item = {
    id: 'fictional-paid', productId: 'fictional-studio', offerId: 'standard', productName: 'Fictional Studio', planName: 'Standard', providerServiceId: '',
    relevantServices: ['canva'], productType: 'graphic_design', relationship: 'replacement', pricingModel: 'subscription',
    description: 'A fictional test-only product.', priceMinor: 999, priceCurrency: 'USD', billingInterval: 'monthly',
    upfrontCommitmentMonths: 0, introductoryTerms: null, renewalTerms: 'Fictional monthly renewal.', priceVerifiedAt: '2026-09-06',
    features: ['social_graphics', 'templates'], unsupportedFeatures: [], unknownFeatures: [], limitations: ['Fictional limitation.'], usageLimits: [],
    platforms: ['web'], countryAvailability: { status: 'worldwide', countries: [] }, advertisements: false,
    storageGb: null, freePlanLimits: false, languages: [], levels: [], serverCountries: [], switchingDifficulty: 'easy',
    officialUrl: 'https://fictional.example/product', pricingUrl: 'https://fictional.example/pricing',
    sourceUrls: ['https://fictional.example/source'], verifiedAt: '2026-09-06', trialOnly: false,
    affiliateUrl: null, affiliateStatus: 'not_applied', ...overrides,
  };
  if (item.pricingModel === 'free') {
    if (!Object.hasOwn(overrides, 'priceMinor')) item.priceMinor = 0;
    if (!Object.hasOwn(overrides, 'priceCurrency')) item.priceCurrency = null;
    if (!Object.hasOwn(overrides, 'billingInterval')) item.billingInterval = null;
  }
  return item;
}

function query(serviceId, overrides = {}) {
  return {
    serviceId, productType: serviceById(serviceId).productType, mustHave: [], niceToHave: [], notNeeded: [],
    acceptAds: null, acceptFreeLimits: null, includePaid: null, includeFree: null, storageRequiredGb: null, ...overrides,
  };
}

function access(premiumAccess, authenticated = premiumAccess) {
  return { authenticated, premiumAccess, isAdmin: premiumAccess, betaAccess: false };
}

function request(body, { token = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('https://feeveto.example/api/alternatives/recommendations', { method: 'POST', headers, body: JSON.stringify(body) });
}

test('common aliases detect originals and expanded supported subscriptions', () => {
  assert.equal(detectSupportedService('Adobe Photoshop')?.id, 'photoshop');
  assert.equal(detectSupportedService('Chat GPT')?.id, 'chatgpt');
  assert.equal(detectSupportedService('Some unknown software'), null);
});

test('the six original subscriptions can be matched by product type', () => {
  const expectedMissingDetail = {
    canva: 'Main design tasks', netflix: 'Country', chatgpt: 'Main assistant tasks',
    photoshop: 'PSD or other file-format requirements', claude: 'Main assistant tasks', dropbox: 'Storage capacity',
  };
  for (const serviceId of ['canva', 'netflix', 'chatgpt', 'photoshop', 'claude', 'dropbox']) {
    const service = serviceById(serviceId);
    const item = offer({ id: `fictional-${serviceId}`, productId: `fictional-${serviceId}`, relevantServices: [serviceId], productType: service.productType, features: [], unsupportedFeatures: [], unknownFeatures: [] });
    const result = selectRecommendations([item], query(serviceId), { premiumAccess: true });
    assert.equal(result.items.length, 1, serviceId);
    assert.equal(result.state, 'general_suggestions', serviceId);
    assert.equal(result.items[0].matchLabel, 'General suggestion', serviceId);
    assert.ok(result.missingDetails.includes(expectedMissingDetail[serviceId]), serviceId);
  }
});

test('a specific supported product type can start discovery without a recognized service', () => {
  const result = selectRecommendations([offer()], { serviceId: '', productType: 'graphic_design' }, { premiumAccess: true });
  assert.equal(result.state, 'general_suggestions');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].relationship, 'replacement');
});

test('different requirements produce different deterministic results', () => {
  const social = offer({ id: 'fictional-social', features: ['social_graphics'] });
  const presentation = offer({ id: 'fictional-slides', features: ['presentations'] });
  assert.equal(selectRecommendations([social, presentation], query('canva', { mustHave: ['social_graphics'] }), { premiumAccess: true }).items[0].id, 'fictional-social');
  assert.equal(selectRecommendations([social, presentation], query('canva', { mustHave: ['presentations'] }), { premiumAccess: true }).items[0].id, 'fictional-slides');
});

test('selected needs produce tailored state and use the matched label only when verified', () => {
  const result = selectRecommendations([offer()], query('canva', {
    mustHave: ['templates'], country: 'US', platform: 'web', acceptAds: false,
  }), { premiumAccess: true });
  assert.equal(result.state, 'matched_suggestions');
  assert.equal(result.items[0].matchStatus, 'matched');
  assert.equal(result.items[0].matchLabel, 'Matches your selected needs');
});

test('Canva solo design and brand requirements select different fictional plans', () => {
  const solo = offer({ id: 'solo-design', productId: 'solo-design', features: ['social_graphics', 'templates'], unsupportedFeatures: ['brand_assets', 'team_collaboration'] });
  const teams = offer({ id: 'team-design', productId: 'team-design', features: ['social_graphics', 'templates', 'brand_assets', 'team_collaboration'] });
  assert.equal(selectRecommendations([solo, teams], query('canva', { mustHave: ['templates'] }), { premiumAccess: true }).items[0].id, 'solo-design');
  assert.deepEqual(selectRecommendations([solo, teams], query('canva', { mustHave: ['brand_assets', 'team_collaboration'] }), { premiumAccess: true }).items.map(({ id }) => id), ['team-design']);
});

test('Photoshop PSD and offline requirements exclude a casual browser editor', () => {
  const casual = offer({ id: 'casual-editor', productId: 'casual-editor', relevantServices: ['photoshop'], productType: 'photo_editor', features: ['basic_adjustments'], unsupportedFeatures: ['psd_import_export', 'offline_desktop'] });
  const desktop = offer({ id: 'desktop-editor', productId: 'desktop-editor', relevantServices: ['photoshop'], productType: 'photo_editor', features: ['basic_adjustments', 'psd_import_export', 'offline_desktop'] });
  const result = selectRecommendations([casual, desktop], query('photoshop', { mustHave: ['psd_import_export', 'offline_desktop'] }), { premiumAccess: true });
  assert.deepEqual(result.items.map(({ id }) => id), ['desktop-editor']);
});

test('general AI writing does not prove specialised terminal-agent support', () => {
  const general = offer({ id: 'general-ai', productId: 'general-ai', relevantServices: ['chatgpt', 'claude'], productType: 'ai_assistant', features: ['general_writing'], unsupportedFeatures: ['ide_terminal_agent'] });
  const agent = offer({ id: 'coding-agent', productId: 'coding-agent', relevantServices: ['chatgpt', 'claude'], productType: 'ai_assistant', features: ['general_writing', 'ide_terminal_agent'] });
  assert.deepEqual(selectRecommendations([general, agent], query('claude', { mustHave: ['ide_terminal_agent'] }), { premiumAccess: true }).items.map(({ id }) => id), ['coding-agent']);
});

test('a different streaming catalogue cannot satisfy a required exclusive', () => {
  const broadCatalogue = offer({ id: 'broad-streaming', productId: 'broad-streaming', relevantServices: ['netflix'], productType: 'streaming_video', features: ['films', 'series'], unsupportedFeatures: ['specific_exclusives'] });
  assert.equal(selectRecommendations([broadCatalogue], query('netflix', { mustHave: ['specific_exclusives'], requiredTitle: 'Fictional exclusive' }), { premiumAccess: true }).items.length, 0);
});

test('unsupported services keep the honest basic-audit state', () => {
  assert.equal(normalizeRecommendationQuery({ serviceId: 'unknown-service', productType: 'other' }), null);
  const result = selectRecommendations([], { serviceId: 'unknown-service' });
  assert.equal(result.state, 'unsupported');
  assert.equal(result.message, 'Choose a supported service or a specific supported product type for curated alternatives.');
});

test('an offer explicitly missing a must-have feature is excluded', () => {
  const result = selectRecommendations([offer({ unsupportedFeatures: ['background_removal'] })], query('canva', { mustHave: ['background_removal'] }), { premiumAccess: true });
  assert.equal(result.items.length, 0);
});

test('an unknown must-have remains a candidate and never a confirmed match', () => {
  const result = selectRecommendations([offer({ unknownFeatures: ['background_removal'] })], query('canva', { mustHave: ['background_removal'] }), { premiumAccess: true });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].matchStatus, 'candidate');
  assert.match(result.items[0].verificationNotes[0], /must-have/i);
});

test('known incompatible country and platform are excluded while unknown compatibility is labelled', () => {
  const limited = offer({ id: 'limited', platforms: ['windows'], countryAvailability: { status: 'limited', countries: ['US'] } });
  assert.equal(selectRecommendations([limited], query('canva', { country: 'CH', platform: 'macos' }), { premiumAccess: true }).items.length, 0);
  const unknown = offer({ id: 'unknown', platforms: [], countryAvailability: { status: 'unknown', countries: [] }, advertisements: null });
  const result = selectRecommendations([unknown], query('canva', { country: 'CH', platform: 'macos', acceptAds: false }), { premiumAccess: true });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].verificationNotes.length, 3);
  assert.ok(result.items[0].verificationNotes.some((note) => /country/i.test(note)));
  assert.ok(result.items[0].verificationNotes.some((note) => /platform/i.test(note)));
});

test('display currency supplies a server-controlled market when country is unanswered', () => {
  const swiss = offer({ id: 'swiss-only', productId: 'swiss-only', countryAvailability: { status: 'limited', countries: ['CH'] } });
  const us = offer({ id: 'us-only', productId: 'us-only', countryAvailability: { status: 'limited', countries: ['US'] } });
  const worldwide = offer({ id: 'worldwide', productId: 'worldwide' });
  const unknown = offer({ id: 'unknown-market', productId: 'unknown-market', countryAvailability: { status: 'unknown', countries: [] } });
  const catalogue = [swiss, us, worldwide, unknown];

  const usd = selectRecommendations(catalogue, query('canva', { marketCurrency: 'USD' }), { premiumAccess: true });
  assert.equal(usd.items.some(({ id }) => id === 'swiss-only'), false);
  assert.equal(usd.items.some(({ id }) => id === 'us-only'), true);
  assert.equal(usd.items.some(({ id }) => id === 'worldwide'), true);

  const chf = selectRecommendations(catalogue, query('canva', { marketCurrency: 'CHF' }), { premiumAccess: true });
  assert.equal(chf.items.some(({ id }) => id === 'swiss-only'), true);
  assert.equal(chf.items.some(({ id }) => id === 'us-only'), false);
  assert.ok(chf.items.find(({ id }) => id === 'unknown-market')?.verificationNotes.some((note) => /CHF/));
});

test('an explicit country overrides the currency market and client-supplied country lists are ignored', () => {
  const swiss = offer({ id: 'swiss-only', productId: 'swiss-only', countryAvailability: { status: 'limited', countries: ['CH'] } });
  const us = offer({ id: 'us-only', productId: 'us-only', countryAvailability: { status: 'limited', countries: ['US'] } });
  const result = selectRecommendations([swiss, us], query('canva', {
    country: 'CH', marketCurrency: 'USD', marketCountries: ['US'],
  }), { premiumAccess: true });
  assert.deepEqual(result.items.map(({ id }) => id), ['swiss-only']);
  assert.equal(normalizeRecommendationQuery(query('canva', { marketCurrency: 'XYZ' })).marketCurrency, '');
});

test('free-plan limits require explicit acceptance', () => {
  const free = offer({ id: 'fictional-free', planName: 'Free', pricingModel: 'free', pricingUrl: null, freePlanLimits: true });
  assert.equal(selectRecommendations([free], query('canva', { acceptFreeLimits: false }), { premiumAccess: true }).items.length, 0);
  assert.equal(selectRecommendations([free], query('canva', { acceptFreeLimits: true }), { premiumAccess: true }).items.length, 1);
});

test('unanswered advertisement preference does not become an explicit No', () => {
  const withAds = offer({ id: 'with-ads', advertisements: true });
  assert.equal(selectRecommendations([withAds], query('canva', { acceptAds: null }), { premiumAccess: true }).items.length, 1);
  assert.equal(selectRecommendations([withAds], query('canva', { acceptAds: false }), { premiumAccess: true }).items.length, 0);
});

test('capacity above a known plan limit is excluded', () => {
  const small = offer({ id: 'small-cloud', productId: 'small-cloud', relevantServices: ['dropbox'], productType: 'cloud_storage', features: ['device_sync'], storageGb: 5 });
  assert.equal(selectRecommendations([small], query('dropbox', { storageRequiredGb: 6 }), { premiumAccess: true }).items.length, 0);
});

test('free and paid preferences filter independently without changing access control', () => {
  const paid = offer({ id: 'paid-choice' });
  const free = offer({ id: 'free-choice', pricingModel: 'free', pricingUrl: null, freePlanLimits: false });
  const freeOnly = selectRecommendations([paid, free], query('canva', { includePaid: false, includeFree: true }), { premiumAccess: true });
  const paidOnly = selectRecommendations([paid, free], query('canva', { includePaid: true, includeFree: false }), { premiumAccess: true });
  assert.deepEqual(freeOnly.items.map(({ id }) => id), ['free-choice']);
  assert.deepEqual(paidOnly.items.map(({ id }) => id), ['paid-choice']);
  assert.equal(selectRecommendations([free], query('canva', { includePaid: false, includeFree: true }), { premiumAccess: false }).items.length, 0);
});

test('unanswered matching preferences remain distinct from No', () => {
  const normalized = normalizeRecommendationQuery(query('canva', { acceptAds: null, acceptFreeLimits: null, includePaid: null, includeFree: null }));
  assert.equal(normalized.acceptAds, null);
  assert.equal(normalized.acceptFreeLimits, null);
  assert.equal(normalized.includePaid, null);
  assert.equal(normalized.includeFree, null);
});

test('unanswered capacity remains distinct from an explicit zero requirement', () => {
  assert.equal(normalizeRecommendationQuery(query('dropbox', { storageRequiredGb: null })).storageRequiredGb, null);
  assert.equal(normalizeRecommendationQuery(query('dropbox', { storageRequiredGb: 0 })).storageRequiredGb, 0);
});

test('the unified save creates a minimal alternative request with preserved preferences', () => {
  const requestBody = recommendationRequestFor({
    name: 'Private entered name', amountMinor: 9999, neededNotes: 'Do not send',
    detailedReview: {
      serviceId: 'canva', productType: 'graphic_design', mustHaveRequirements: ['templates'], niceToHaveRequirements: [],
      country: 'CH', platform: 'web', acceptAds: null, acceptFreeLimits: false, considerCheaper: true, considerFree: false,
      storageRequiredGb: null, neededFeatures: 'Private note',
    },
  }, 'USD');
  assert.equal(requestBody.marketCurrency, 'USD');
  assert.equal(requestBody.includePaid, true);
  assert.equal(requestBody.includeFree, false);
  assert.equal(requestBody.acceptAds, null);
  assert.equal('name' in requestBody, false);
  assert.equal('amountMinor' in requestBody, false);
  assert.equal('neededFeatures' in requestBody, false);
});

test('an older recognized record without detailed review still creates a general request', () => {
  const requestBody = recommendationRequestFor({ name: 'Dropbox', detailedReview: null });
  assert.equal(requestBody.serviceId, 'dropbox');
  assert.equal(requestBody.productType, 'cloud_storage');
  assert.equal(requestBody.acceptAds, undefined);
  assert.equal(requestBody.storageRequiredGb, null);
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
  assert.equal(result.state, 'no_verified_alternatives');
  assert.match(result.message, /doesn't have verified alternatives/);
});

test('duplicate offers are returned once', () => {
  const duplicate = offer();
  assert.equal(selectRecommendations([duplicate, duplicate], query('canva'), { premiumAccess: true }).items.length, 1);
});

test('private catalogue loading rejects empty, invalid, and duplicate catalogues', async () => {
  const contextFor = (catalogue) => ({ env: { FEEVETO_ALTERNATIVES: { get: async () => catalogue } } });
  await assert.rejects(() => loadPrivateCatalogue(contextFor({ schemaVersion: 2, offers: [] })), CatalogueConfigurationError);
  await assert.rejects(() => loadPrivateCatalogue(contextFor({ schemaVersion: 2, offers: [{}] })), CatalogueConfigurationError);
  const duplicate = offer();
  await assert.rejects(() => loadPrivateCatalogue(contextFor({ schemaVersion: 2, offers: [duplicate, duplicate] })), CatalogueConfigurationError);
  await assert.rejects(() => loadPrivateCatalogue(contextFor({ schemaVersion: 2, offers: [duplicate, offer({ id: 'different-id' })] })), CatalogueConfigurationError);
  assert.equal((await loadPrivateCatalogue(contextFor({ schemaVersion: 2, offers: [offer()] }))).length, 1);
});

test('catalogue configuration and unexpected request failures return distinct API states', async () => {
  const unavailable = await handleRecommendationsRequest(
    { request: request(query('canva')), env: {} },
    { catalogueLoader: async () => { throw new CatalogueConfigurationError('missing'); }, accessResolver: async () => access(false, false) },
  );
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).state, 'catalogue_unavailable');
  const failed = await handleRecommendationsRequest(
    { request: request(query('canva')), env: {} },
    { catalogueLoader: async () => { throw new Error('storage failure'); }, accessResolver: async () => access(false, false) },
  );
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).state, 'request_failed');
});

test('unsafe and non-HTTPS destinations are rejected', () => {
  assert.equal(validateOffer(offer({ officialUrl: 'javascript:alert(1)' })), null);
  assert.equal(validateOffer(offer({ officialUrl: 'http://fictional.example' })), null);
  assert.equal(validateOffer(offer({ pricingUrl: 'http://fictional.example/pricing' })), null);
});

test('responses never invent numerical savings or expose affiliate destinations', () => {
  const [result] = selectRecommendations([offer()], query('canva'), { premiumAccess: true }).items;
  assert.equal('estimatedSavings' in result, false);
  assert.equal('affiliateUrl' in result, false);
  assert.equal(result.pricingLabel, 'Paid alternative');
});

test('unknown prices stay null and source currencies are preserved', () => {
  const unknown = offer({ id: 'unknown-price', productId: 'unknown-price', priceMinor: null, priceCurrency: null, priceVerifiedAt: null, billingInterval: 'varies' });
  const eur = offer({ id: 'eur-price', productId: 'eur-price', priceMinor: 1200, priceCurrency: 'EUR', billingInterval: 'yearly' });
  const results = selectRecommendations([unknown, eur], query('canva'), { premiumAccess: true }).items;
  assert.equal(results.find(({ id }) => id === 'unknown-price').price.amountMinor, null);
  assert.equal(results.find(({ id }) => id === 'eur-price').price.currency, 'EUR');
  assert.equal(results.some((item) => 'estimatedSavings' in item), false);
});

test('unknown prices cannot carry a misleading currency or verification date', () => {
  assert.equal(validateOffer(offer({ priceMinor: null, priceCurrency: 'USD', priceVerifiedAt: null, billingInterval: 'varies' })), null);
  assert.equal(validateOffer(offer({ priceMinor: null, priceCurrency: null, priceVerifiedAt: '2026-09-06', billingInterval: 'varies' })), null);
});

test('one-time and annual commitments are returned without monthly-equivalent claims', () => {
  const once = offer({ id: 'one-time', productId: 'one-time', pricingModel: 'one_time', priceMinor: 25000, billingInterval: 'one_time', upfrontCommitmentMonths: 0, renewalTerms: 'No recurring fee.' });
  const annual = offer({ id: 'annual', productId: 'annual', offerId: 'annual', priceMinor: 4900, billingInterval: 'yearly', upfrontCommitmentMonths: 12, introductoryTerms: 'First year only.', renewalTerms: 'Renews yearly.' });
  const results = selectRecommendations([once, annual], query('canva'), { premiumAccess: true }).items;
  assert.equal(results.find(({ id }) => id === 'one-time').pricingLabel, 'One-time purchase');
  assert.equal(results.find(({ id }) => id === 'one-time').price.amountMinor, 25000);
  assert.equal(results.find(({ id }) => id === 'annual').price.upfrontCommitmentMonths, 12);
  assert.equal(results.find(({ id }) => id === 'annual').price.introductoryTerms, 'First year only.');
  assert.equal(results.find(({ id }) => id === 'annual').price.renewalTerms, 'Renews yearly.');
});

test('invalid requirement identifiers and product types are normalized safely', () => {
  assert.deepEqual(normalizeRecommendationQuery(query('canva', { mustHave: ['templates', 'invented'], productType: 'invented' })).mustHave, ['templates']);
  assert.equal(normalizeRecommendationQuery(query('canva', { productType: 'invented' })).productType, 'graphic_design');
});

test('catalogue records cannot claim feature identifiers outside their product type', () => {
  assert.equal(validateOffer(offer({ features: ['templates', 'invented_feature'] })), null);
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

test('a free-only accessible match returns a generic access state without leaking the offer', async () => {
  const free = offer({ id: 'private-free-id', productName: 'Private Free Name', pricingModel: 'free', pricingUrl: null });
  const response = await handleRecommendationsRequest(
    { request: request(query('canva')), env: {} },
    { catalogueLoader: async () => [free], accessResolver: async () => access(false, false) },
  );
  const raw = await response.text();
  const body = JSON.parse(raw);
  assert.equal(body.state, 'access_restricted');
  assert.deepEqual(body.items, []);
  assert.equal(raw.includes('Private Free Name'), false);
  assert.equal(raw.includes('private-free-id'), false);
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

test('response normalization preserves structured states and safe official links', () => {
  const normalized = normalizeAlternativesResponse({
    accessScope: 'complete', state: 'general_suggestions', missingDetails: ['Main design tasks'],
    items: [{ officialUrl: 'https://fictional.example/offer' }],
  });
  assert.equal(normalized.state, 'general_suggestions');
  assert.deepEqual(normalized.missingDetails, ['Main design tasks']);
  assert.equal(normalized.items.length, 1);
});

test('backend provider distinguishes catalogue unavailability from retryable request failure', async () => {
  const subscription = { name: 'Canva', detailedReview: null };
  const unavailable = new BackendAlternativesProvider(async () => new Response(JSON.stringify({
    state: 'catalogue_unavailable', error: 'The alternatives catalogue is unavailable.',
  }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(
    () => unavailable.getAlternatives(subscription),
    (error) => error instanceof AlternativeRequestError && error.resultState === 'catalogue_unavailable',
  );
  const failed = new BackendAlternativesProvider(async () => new Response(JSON.stringify({
    state: 'request_failed', error: 'Try again.',
  }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(
    () => failed.getAlternatives(subscription),
    (error) => error instanceof AlternativeRequestError && error.resultState === 'request_failed',
  );
});

test('outdated alternative requests cannot replace newer results', () => {
  const tracker = new AlternativeRequestTracker();
  const older = tracker.begin('subscription-1');
  const newer = tracker.begin('subscription-1');
  assert.equal(tracker.isCurrent('subscription-1', older), false);
  assert.equal(tracker.isCurrent('subscription-1', newer), true);
  tracker.invalidateAll();
  assert.equal(tracker.isCurrent('subscription-1', newer), false);
});
