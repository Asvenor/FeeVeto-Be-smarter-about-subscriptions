import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkedRating, freshnessFor, selectRecommendations } from '../functions/_shared/alternatives.js';
import { curatedRecommendations } from '../functions/_shared/catalogue-provider.js';
const fixture = JSON.parse(await readFile(new URL('../fixtures/catalogue.example.json', import.meta.url))).offers[0];
const offer = (extra = {}) => ({ ...fixture, switchingDifficulty: 'easy', priceMinor: 12000, priceCurrency: 'USD', priceVerifiedAt: '2026-09-06', billingInterval: 'yearly', upfrontCommitmentMonths: 12, ...extra });

test('legacy catalogue keeps unknown prices unknown and ratings require evidence and counts', () => {
  const result = selectRecommendations([fixture], { serviceId: 'canva' });
  assert.equal(result.items[0].price.amountMinor, null);
  assert.equal(result.items[0].reviewRating, null);
  assert.deepEqual(result.items[0].sourceUrls, fixture.sourceUrls);
  assert.equal(checkedRating({ value: 4.8, scale: 5 }), null);
  assert.equal(checkedRating({ value: 4.8, scale: 5, count: 32, source: 'Test source', sourceUrl: 'https://example.test/reviews', checkedAt: '2026-09-06' }).count, 32);
});
test('budget checks respect annual billing and never relabel a different currency', () => {
  const query = { serviceId: 'canva', budgetMinor: 1000, budgetCurrency: 'USD' };
  assert.equal(selectRecommendations([offer()], query).items.length, 1);
  assert.equal(selectRecommendations([offer()], { ...query, budgetMinor: 900 }).items.length, 0);
  const differentCurrency = selectRecommendations([offer({ priceCurrency: 'CHF' })], query).items[0];
  assert.equal(differentCurrency.price.currency, 'CHF');
  assert.ok(differentCurrency.verificationNotes.some(note => note.includes('budget')));
});
test('easier switching excludes difficult options without changing premium restrictions', () => {
  const records = [offer({ switchingDifficulty: 'complex' }), offer({ id: 'free', pricingModel: 'free', priceMinor: 0, priceCurrency: null, billingInterval: null })];
  assert.equal(selectRecommendations(records, { serviceId: 'canva', easierOnly: true }).items.length, 0);
  assert.equal(selectRecommendations(records, { serviceId: 'canva', easierOnly: true }, { premiumAccess: true }).items[0].id, 'free');
});
test('freshness has a concrete policy and old data cannot imply a confirmed match', () => {
  assert.equal(freshnessFor('2026-09-06', new Date('2026-09-07')).needsRecheck, false);
  assert.equal(freshnessFor('2025-01-01', new Date('2026-09-07')).needsRecheck, true);
  const result = selectRecommendations([offer({ verifiedAt: '2025-01-01' })], { serviceId: 'canva', platform: 'web', country: 'US', mustHave: ['templates'] });
  assert.equal(result.items[0].matchStatus, 'candidate');
});
test('curated provider has no external-API dependency and reports storage failure distinctly', async () => {
  assert.equal((await curatedRecommendations({}, { serviceId: 'canva' }, {}, { load: async () => [fixture] })).items.length, 1);
  await assert.rejects(() => curatedRecommendations({}, { serviceId: 'canva' }, {}, { load: async () => { throw new Error('catalogue unavailable'); } }), /catalogue unavailable/);
});
