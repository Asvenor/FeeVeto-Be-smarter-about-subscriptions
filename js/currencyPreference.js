import { formatMoney, formatWholeMoney } from './calculations.js';
import { APP_CONFIG, CURRENCIES, CURRENCY_OPTIONS } from './config.js';

export const EXAMPLE_AMOUNTS_MINOR = Object.freeze({
  annualAudit: 218_400,
  potentialSavings: 51_600,
  annualCreativeToolkit: 21_600,
  creativeToolkitCostPerUse: 138,
});

export function validCurrencyPreference(value) {
  return CURRENCIES.includes(value) ? value : APP_CONFIG.defaultCurrency;
}

export function fillCurrencyOptions(select, selectedCurrency) {
  const selected = validCurrencyPreference(selectedCurrency);
  const options = CURRENCY_OPTIONS.map(([value, label]) => {
    const option = select.ownerDocument.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    return option;
  });
  select.replaceChildren(...options);
}

export function renderIllustrativeMoney(root, currency) {
  const selected = validCurrencyPreference(currency);
  for (const node of root.querySelectorAll('[data-example-money]')) {
    const key = node.dataset.exampleMoney;
    const minor = EXAMPLE_AMOUNTS_MINOR[key];
    if (!Number.isFinite(minor)) continue;
    const formatted = key === 'creativeToolkitCostPerUse'
      ? formatMoney(minor, selected)
      : formatWholeMoney(minor, selected);
    node.textContent = `${node.dataset.moneyPrefix || ''}${formatted}${node.dataset.moneySuffix || ''}`;
  }
}

export function shouldApplyCurrencyDefault({ editingId = '', priceValue = '', entryCurrencyExplicitlyChanged = false } = {}) {
  return !editingId && !String(priceValue).trim() && !entryCurrencyExplicitlyChanged;
}
