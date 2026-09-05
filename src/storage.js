import { migrateLegacyState, normalizeState, SCHEMA_VERSION } from './core.js';

export const STORAGE_KEY = 'subkiller_state';
const LEGACY_SUBSCRIPTIONS_KEY = 'subkiller_subscriptions';
const LEGACY_CURRENCY_KEY = 'subkiller_currency';

function safeRead(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function emptyState(currency = 'USD') {
  return { version: SCHEMA_VERSION, currency, subscriptions: [] };
}

export function loadState(storage) {
  const raw = safeRead(storage, STORAGE_KEY);
  if (raw) {
    try {
      const state = normalizeState(JSON.parse(raw));
      return state ? { state, recovered: false, migrated: false } : { state: emptyState(), recovered: true, migrated: false };
    } catch {
      return { state: emptyState(), recovered: true, migrated: false };
    }
  }

  const legacyRaw = safeRead(storage, LEGACY_SUBSCRIPTIONS_KEY);
  const legacyCurrency = safeRead(storage, LEGACY_CURRENCY_KEY) || 'USD';
  if (!legacyRaw) return { state: emptyState(legacyCurrency), recovered: false, migrated: false };

  try {
    const state = migrateLegacyState(JSON.parse(legacyRaw), legacyCurrency);
    safeWrite(storage, STORAGE_KEY, JSON.stringify(state));
    return { state, recovered: false, migrated: true };
  } catch {
    return { state: emptyState(legacyCurrency), recovered: true, migrated: false };
  }
}

export function saveState(storage, state) {
  return safeWrite(storage, STORAGE_KEY, JSON.stringify(state));
}

export function parseImportedState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.subscriptions)) {
    throw new Error('That file is not a valid SubKiller backup.');
  }

  const state = normalizeState(parsed);
  if (!state) throw new Error('That file is not a valid SubKiller backup.');
  return state;
}
