import test from 'node:test';
import assert from 'node:assert/strict';
import { annualCost, estimatedCostPerUse, formatMoney, formatWholeMoney, monthlyCost, toMinorUnits, totalsForCurrency } from '../js/calculations.js';

test('weekly costs normalize to monthly and yearly amounts', () => {
  assert.equal(monthlyCost(1000, 'weekly'), 4333);
  assert.equal(annualCost(1000, 'weekly'), 52000);
});

test('quarterly costs normalize to monthly and yearly amounts', () => {
  assert.equal(monthlyCost(3000, 'quarterly'), 1000);
  assert.equal(annualCost(3000, 'quarterly'), 12000);
});

test('monthly and yearly cycles normalize correctly', () => {
  assert.equal(annualCost(1200, 'monthly'), 14400);
  assert.equal(monthlyCost(12000, 'yearly'), 1000);
});

test('invalid prices are rejected while zero is accepted', () => {
  assert.equal(toMinorUnits(''), null);
  assert.equal(toMinorUnits('-1'), null);
  assert.equal(toMinorUnits('invalid'), null);
  assert.equal(toMinorUnits('0'), 0);
});

test('cost per use is estimated only when usage is measurable', () => {
  assert.equal(estimatedCostPerUse(1200, 'monthly', 'monthly'), 1200);
  assert.equal(estimatedCostPerUse(1200, 'monthly', 'never'), null);
});

test('money formatting uses familiar symbols and keeps unknown prices unknown', () => {
  assert.equal(formatWholeMoney(218400, 'USD'), '$2,184');
  assert.equal(formatWholeMoney(218400, 'EUR'), '€2,184');
  assert.equal(formatWholeMoney(218400, 'GBP'), '£2,184');
  assert.match(formatWholeMoney(218400, 'CHF'), /^CHF/);
  assert.equal(formatMoney(null, 'USD'), 'Unknown');
});

test('currency totals never combine entries with different original currencies', () => {
  const subscriptions = [
    { amountMinor: 1000, currency: 'USD', cycle: 'monthly', status: 'active' },
    { amountMinor: 2000, currency: 'CHF', cycle: 'monthly', status: 'active' },
  ];
  const totals = totalsForCurrency(subscriptions, 'USD', () => ({ recommendation: 'keep' }));
  assert.equal(totals.monthlyMinor, 1000);
  assert.equal(totals.annualMinor, 12000);
  assert.equal(totals.subscriptionCount, 1);
  assert.equal(totals.excludedCount, 1);
});
