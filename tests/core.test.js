import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTotals,
  daysUntil,
  filterAndSortSubscriptions,
  migrateLegacyState,
  monthlyEquivalentMinor,
  normalizeSubscription,
  recommendationFor,
  toMinorUnits,
  upcomingRenewals,
  yearlyEquivalentMinor,
  normalizeState,
} from '../src/core.js';

function subscription(overrides = {}) {
  return normalizeSubscription({
    id: 'test-id',
    name: 'Example',
    amountMinor: 1200,
    cycle: 'monthly',
    usage: 'sometimes',
    category: 'software',
    importance: 'useful',
    status: 'active',
    renewalDate: '',
    cancellationUrl: '',
    ...overrides,
  });
}

test('money is stored in integer minor units', () => {
  assert.equal(toMinorUnits('19.99'), 1999);
  assert.equal(toMinorUnits(''), null);
  assert.equal(toMinorUnits('-1'), null);
  assert.equal(toMinorUnits('not-a-number'), null);
  assert.equal(toMinorUnits('10000000'), null);
});

test('billing cycles calculate monthly and yearly equivalents', () => {
  assert.equal(monthlyEquivalentMinor(1200, 'monthly'), 1200);
  assert.equal(yearlyEquivalentMinor(1200, 'monthly'), 14400);
  assert.equal(monthlyEquivalentMinor(12000, 'yearly'), 1000);
  assert.equal(yearlyEquivalentMinor(1000, 'weekly'), 52000);
});

test('totals exclude cancelled subscriptions and include explainable savings', () => {
  const items = [
    subscription({ id: 'one', amountMinor: 1000, usage: 'often' }),
    subscription({ id: 'two', amountMinor: 2000, usage: 'rarely', importance: 'optional' }),
    subscription({ id: 'three', amountMinor: 5000, status: 'cancelled' }),
  ];
  assert.deepEqual(calculateTotals(items), {
    totalMonthlyMinor: 3000,
    totalYearlyMinor: 36000,
    possibleYearlySavingsMinor: 24000,
    activeCount: 2,
  });
});

test('essential subscriptions are not counted as easy savings', () => {
  const item = subscription({ usage: 'never', importance: 'essential' });
  assert.equal(recommendationFor(item).label, 'Review');
  assert.equal(calculateTotals([item]).possibleYearlySavingsMinor, 0);
});

test('legacy subscriptions migrate without losing their value', () => {
  const state = migrateLegacyState([{ id: 'old', name: 'Legacy', price: 9.99, cycle: 'monthly', usage: 'often', category: 'other' }], 'CHF');
  assert.equal(state.currency, 'CHF');
  assert.equal(state.subscriptions[0].amountMinor, 999);
  assert.equal(state.subscriptions[0].importance, 'useful');
  assert.equal(state.subscriptions[0].status, 'active');
});

test('imported duplicate IDs are replaced to keep editing unambiguous', () => {
  const original = subscription({ id: 'duplicate' });
  const state = normalizeState({ version: 1, currency: 'USD', subscriptions: [original, original] });
  assert.equal(state.subscriptions.length, 2);
  assert.notEqual(state.subscriptions[0].id, state.subscriptions[1].id);
});

test('renewal calculations use local calendar days', () => {
  const now = new Date(2026, 8, 5, 22, 30);
  assert.equal(daysUntil('2026-09-05', now), 0);
  assert.equal(daysUntil('2026-09-06', now), 1);
  assert.deepEqual(upcomingRenewals([
    subscription({ id: 'later', renewalDate: '2026-09-20' }),
    subscription({ id: 'soon', renewalDate: '2026-09-06' }),
    subscription({ id: 'cancelled', status: 'cancelled', renewalDate: '2026-09-05' }),
  ], now, 30).map(({ item }) => item.id), ['soon', 'later']);
});

test('search, filters, and sorting can be combined', () => {
  const items = [
    subscription({ id: 'b', name: 'Beta Cloud', category: 'cloud', amountMinor: 500 }),
    subscription({ id: 'a', name: 'Alpha Cloud', category: 'cloud', amountMinor: 1500 }),
    subscription({ id: 'c', name: 'Cinema', category: 'entertainment', amountMinor: 3000 }),
  ];
  const result = filterAndSortSubscriptions(items, { query: 'cloud', category: 'cloud', sort: 'name-asc' });
  assert.deepEqual(result.map((item) => item.id), ['a', 'b']);
});
