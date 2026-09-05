import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAlternativesProvider } from '../js/alternativeProvider.js';

const base = {
  id: 'base', serviceName: 'Base option', aliases: [], categories: ['software'], alternativeType: 'cheaper', description: 'Verified option.',
  monthlyPriceMinor: 500, yearlyPriceMinor: null, currency: 'CHF', pricingNote: '', supportedCountries: ['CH'], platforms: ['web'],
  featureTags: ['documents'], limitations: [], url: 'https://example.com/base', isAffiliate: false, lastVerified: '2026-09-05',
};
const subscription = { amountMinor: 2000, cycle: 'monthly', currency: 'CHF', category: 'software' };

test('required features influence ranking and eligibility', () => {
  const provider = new LocalAlternativesProvider([base, { ...base, id: 'match', serviceName: 'Feature match', featureTags: ['documents', 'collaboration'] }]);
  assert.deepEqual(provider.getAlternatives(subscription, { requiredFeatures: ['collaboration'], country: 'CH' }).map((item) => item.id), ['match']);
});

test('free alternatives can rank first', () => {
  const free = { ...base, id: 'free', serviceName: 'Free option', alternativeType: 'free', monthlyPriceMinor: 0 };
  const result = new LocalAlternativesProvider([base, free]).getAlternatives(subscription, { considerFree: true, country: 'CH' });
  assert.equal(result[0].id, 'free');
});

test('affiliate status never improves ranking', () => {
  const affiliate = { ...base, id: 'affiliate', serviceName: 'Affiliate option', isAffiliate: true };
  const result = new LocalAlternativesProvider([affiliate, base]).getAlternatives(subscription, { country: 'CH' });
  assert.equal(result.find((item) => item.id === 'affiliate').rankScore, result.find((item) => item.id === 'base').rankScore);
});

test('unsupported countries are excluded', () => {
  assert.equal(new LocalAlternativesProvider([base]).getAlternatives(subscription, { country: 'US' }).length, 0);
});

test('missing prices never create fake savings', () => {
  const unpriced = { ...base, id: 'unpriced', monthlyPriceMinor: null, yearlyPriceMinor: null };
  assert.equal(new LocalAlternativesProvider([unpriced]).getAlternatives(subscription, { country: 'CH' })[0].estimatedAnnualSavingsMinor, null);
});
