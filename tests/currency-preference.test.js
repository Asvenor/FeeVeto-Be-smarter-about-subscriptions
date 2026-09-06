import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_CONFIG, CURRENCIES, CURRENCY_OPTIONS } from '../js/config.js';
import { EXAMPLE_AMOUNTS_MINOR, shouldApplyCurrencyDefault, validCurrencyPreference } from '../js/currencyPreference.js';

test('USD is the default and supported currencies use the required order and labels', () => {
  assert.equal(APP_CONFIG.defaultCurrency, 'USD');
  assert.deepEqual(CURRENCIES, ['USD', 'EUR', 'GBP', 'CHF']);
  assert.deepEqual(CURRENCY_OPTIONS, [['USD', 'USD ($)'], ['EUR', 'EUR (€)'], ['GBP', 'GBP (£)'], ['CHF', 'CHF']]);
  assert.equal(validCurrencyPreference('EUR'), 'EUR');
  assert.equal(validCurrencyPreference('CAD'), 'USD');
});

test('illustrative amounts are structured data rather than converted values', () => {
  assert.deepEqual(EXAMPLE_AMOUNTS_MINOR, {
    annualAudit: 218400,
    potentialSavings: 51600,
    annualCreativeToolkit: 21600,
    creativeToolkitCostPerUse: 138,
  });
});

test('a global preference never relabels an edit or unfinished price', () => {
  assert.equal(shouldApplyCurrencyDefault(), true);
  assert.equal(shouldApplyCurrencyDefault({ priceValue: '12.50' }), false);
  assert.equal(shouldApplyCurrencyDefault({ editingId: 'saved-entry' }), false);
  assert.equal(shouldApplyCurrencyDefault({ entryCurrencyExplicitlyChanged: true }), false);
});
