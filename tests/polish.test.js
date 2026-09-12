import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDetailedReview } from '../js/formModel.js';
import { normalizeDetailedReview, normalizeSubscription, parseImportedState } from '../js/storage.js';
import { recommendationRequestFor, BackendAlternativesProvider } from '../js/alternativeProvider.js';
import { avatarPresentation, CLERK_APPEARANCE } from '../js/authAppearance.js';
import { fetchAccessStatus } from '../js/access.js';
import { requirementLabel } from '../js/serviceCatalog.js';
import { evaluateSubscription } from '../js/recommendationEngine.js';
import { selectRecommendations, validateOffer } from '../functions/_shared/alternatives.js';
import { handleRecommendationsRequest } from '../functions/api/alternatives/recommendations.js';
import { handleWorkerRequest } from '../worker.js';

const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
const entry = { id: 'test', name: 'Canva', amountMinor: 1000, currency: 'CHF', cycle: 'monthly', category: 'software', usage: 'daily', importance: 'useful' };
const fixture = JSON.parse(await readFile(new URL('../fixtures/catalogue.example.json', import.meta.url))).offers[0];

test('public canonical and crawler metadata point at the selected production domain', async () => {
  for (const name of ['index.html', 'privacy.html', 'robots.txt', 'sitemap.xml']) {
    const source = await readFile(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.match(source, /https:\/\/feeveto\.com\//);
    assert.doesNotMatch(source, /asvenor\.github\.io|feeveto\.edward-nyarko\.workers\.dev/);
  }
});

test('custom service correction persists and never redetects a rejected name', () => {
  const detailedReview = buildDetailedReview(form({ serviceId: '', productType: 'cloud_storage', country: 'ch', platform: 'web', requirement_file_sharing: 'must', acceptFreeLimits: 'false' }));
  const saved = normalizeSubscription({ ...entry, detailedReview });
  const query = recommendationRequestFor(saved);
  assert.equal(query.serviceId, '');
  assert.equal(query.productType, 'cloud_storage');
  assert.equal(query.country, 'CH');
  assert.equal(query.platform, 'web');
  assert.equal(query.acceptFreeLimits, false);
  assert.deepEqual(query.mustHave, ['file_sharing']);
  assert.equal(recommendationRequestFor({ ...entry, detailedReview: { serviceSelectionConfirmed: true } }), null);
});

test('generic product requirements survive storage and exclude unrelated old priorities', () => {
  const review = normalizeDetailedReview({ productType: 'cloud_storage', mustHaveRequirements: ['templates', 'file_sharing'] });
  assert.deepEqual(review.mustHaveRequirements, ['file_sharing']);
  assert.equal(requirementLabel('', 'file_sharing'), 'File sharing');
});

test('one advertisement priority supplies matching and audit, and can return to unanswered', () => {
  for (const [priority, expected] of [['must', false], ['not_needed', true], ['nice', null], ['', null]]) {
    const review = buildDetailedReview(form({ productType: 'streaming_video', category: 'streaming', requirement_ad_free: priority, acceptAds: 'true' }));
    assert.equal(review.acceptAds, expected);
  }
  const review = buildDetailedReview(form({ productType: 'graphic_design', category: 'software', requirement_team_collaboration: 'must' }));
  assert.equal(review.categoryAnswers.collaborationRequired, true);
});

test('optional notes never act as structured audit answers', () => {
  const original = evaluateSubscription({ ...entry, detailedReview: { categoryAnswers: {} } });
  const withNotes = evaluateSubscription({ ...entry, detailedReview: { neededFeatures: 'Not just basic features', categoryAnswers: {} } });
  assert.deepEqual(withNotes, original);
});

test('unknown storage is not zero and stays a candidate requiring verification', () => {
  assert.equal(validateOffer({ ...fixture, priceMinor: false, priceCurrency: 'USD', priceVerifiedAt: '2026-09-06' }), null, 'False must never become a zero-priced offer');
  for (const storageGb of [null, undefined, '', false]) assert.equal(validateOffer({ ...fixture, storageGb }).storageGb, null);
  const result = selectRecommendations([{ ...fixture, productType: 'cloud_storage', relevantServices: ['dropbox'], features: [], unsupportedFeatures: [], unknownFeatures: [], storageGb: null }], { serviceId: 'dropbox', storageRequiredGb: 500 });
  assert.equal(result.items.length, 1);
  assert.match(JSON.stringify(result.items), /Confirm that the plan has enough storage/);
});

test('malformed backup amounts and billing units cannot silently replace valid data', () => {
  for (const amountMinor of [null, undefined, '', false, -1]) {
    assert.equal(normalizeSubscription({ ...entry, amountMinor }), null);
    assert.throws(() => parseImportedState(JSON.stringify({ subscriptions: [entry, { ...entry, amountMinor }] })), /invalid/);
  }
  assert.throws(() => parseImportedState(JSON.stringify({ subscriptions: [{ ...entry, currency: 'XYZ' }] })), /unknown billing/);
  assert.equal(parseImportedState(JSON.stringify({ subscriptions: [entry] })).subscriptions[0].currency, 'CHF');
});

test('unknown API routes return JSON and never call the static HTML fallback', async () => {
  const response = await handleWorkerRequest(new Request('https://example.com/api/unknown'), { ASSETS: { fetch() { throw new Error('Must not fall through'); } } });
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /application\/json/);
});

test('invalid and unavailable sessions have distinct retryable errors without catalogue disclosure', async () => {
  for (const [accessResolver, status] of [[async () => ({ authenticated: false }), 401], [async () => { throw new Error('private diagnostic'); }, 503]]) {
    const request = new Request('https://example.com/api/alternatives/recommendations', { method: 'POST', headers: { Authorization: 'Bearer expired', 'Content-Type': 'application/json' }, body: JSON.stringify({ serviceId: 'canva', role: 'admin', premiumAccess: true }) });
    const response = await handleRecommendationsRequest({ request }, { accessResolver, catalogueLoader() { throw new Error('Do not load catalogue'); } });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.state, 'authentication_failed');
    assert.doesNotMatch(JSON.stringify(body), /private diagnostic|fictional/);
  }
});

test('failed token lookup defaults to unpaid access without an unhandled rejection', async () => {
  const access = await fetchAccessStatus({ session: { getToken() { throw new Error('expired'); } } }, () => { throw new Error('Must not fetch'); });
  assert.equal(access.premiumAccess, false);
});

test('alternative requests are time bounded and retain authentication failure state', async () => {
  const provider = new BackendAlternativesProvider(async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ state: 'authentication_failed', error: 'Sign in again.' }, { status: 401 });
  });
  await assert.rejects(provider.getAlternatives(entry, 'expired'), (error) => error.resultState === 'authentication_failed');
});

test('backend provider sends the selected currency as a validated market hint', async () => {
  let sent;
  const provider = new BackendAlternativesProvider(async (_url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ state: 'general_suggestions', items: [] });
  });
  await provider.getAlternatives({ name: 'Netflix', detailedReview: null }, '', 'CHF');
  assert.equal(sent.marketCurrency, 'CHF');
  await provider.getAlternatives({ name: 'Netflix', detailedReview: null }, '', 'CAD');
  assert.equal(sent.marketCurrency, '');
});

test('generated profile initials are green-themed while uploaded or unknown photos are untouched', () => {
  assert.deepEqual(avatarPresentation({ hasImage: false, firstName: 'Test', lastName: 'Person' }), { generated: true, initials: 'TP' });
  assert.equal(avatarPresentation({ hasImage: true }).generated, false);
  assert.equal(avatarPresentation({}).generated, false);
  assert.equal(CLERK_APPEARANCE.variables.colorPrimary, '#16673d');
});
