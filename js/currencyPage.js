import { APP_CONFIG } from './config.js';
import { fillCurrencyOptions, validCurrencyPreference } from './currencyPreference.js';
import { loadState, saveState } from './storage.js';
import { initializeAnalytics } from './analytics.js';

const select = document.getElementById('page-currency-preference');
const status = document.getElementById('page-currency-status');
const browserStorage = (() => {
  try { return window.localStorage; } catch { return { getItem() { return null; }, setItem() { throw new Error('Storage unavailable'); } }; }
})();

let state = loadState(browserStorage).state;
initializeAnalytics({ storage: browserStorage });
fillCurrencyOptions(select, state.auditCurrency);

select.addEventListener('change', () => {
  state.auditCurrency = validCurrencyPreference(select.value);
  const saved = saveState(browserStorage, state);
  status.textContent = saved
    ? `Display currency changed to ${state.auditCurrency}. Existing subscription currencies were not changed.`
    : 'The display currency changed for this page, but this browser could not save it.';
});

window.addEventListener('storage', (event) => {
  if (event.key !== APP_CONFIG.storageKey) return;
  state = loadState(browserStorage).state;
  select.value = state.auditCurrency;
  status.textContent = `Display currency changed to ${state.auditCurrency} in another FeeVeto page.`;
});
