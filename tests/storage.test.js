import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_CONFIG } from '../js/config.js';
import { loadState, parseImportedState, saveState } from '../js/storage.js';

function memoryStorage(entries = {}, { throws = false } = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { if (throws) throw new Error('blocked'); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (throws) throw new Error('blocked'); values.set(key, value); },
  };
}

test('loads and saves the versioned FeeVeto state', () => {
  const storage = memoryStorage();
  const state = { version: 2, auditCurrency: 'EUR', subscriptions: [], migration: { legacyCompleted: true } };
  assert.equal(saveState(storage, state), true);
  assert.deepEqual(loadState(storage).state, state);
});

test('a clean or invalid preference defaults to USD', () => {
  assert.equal(loadState(memoryStorage()).state.auditCurrency, 'USD');
  const invalid = { version: 2, auditCurrency: 'CAD', subscriptions: [], migration: { legacyCompleted: true } };
  assert.equal(loadState(memoryStorage({ [APP_CONFIG.storageKey]: JSON.stringify(invalid) })).state.auditCurrency, 'USD');
});

test('changing the preference preserves saved CHF amounts and currencies', () => {
  const storage = memoryStorage();
  const state = {
    version: 2,
    auditCurrency: 'EUR',
    subscriptions: [{ id: 'chf-plan', name: 'CHF plan', amountMinor: 2450, currency: 'CHF', cycle: 'monthly', category: 'other', usage: 'monthly', importance: 'useful', status: 'active' }],
    migration: { legacyCompleted: true },
  };
  assert.equal(saveState(storage, state), true);
  const restored = loadState(storage).state;
  assert.equal(restored.auditCurrency, 'EUR');
  assert.equal(restored.subscriptions[0].amountMinor, 2450);
  assert.equal(restored.subscriptions[0].currency, 'CHF');
});

test('corrupted storage does not crash the application', () => {
  const result = loadState(memoryStorage({ [APP_CONFIG.storageKey]: '{broken' }));
  assert.equal(result.recovered, true);
  assert.deepEqual(result.state.subscriptions, []);
});

test('storage unavailability falls back without crashing', () => {
  const result = loadState(memoryStorage({}, { throws: true }));
  assert.equal(result.storageAvailable, false);
  assert.deepEqual(result.state.subscriptions, []);
});

test('current legacy data migrates once without losing values', () => {
  const storage = memoryStorage({
    subkiller_state: JSON.stringify({ currency: 'GBP', subscriptions: [{ id: 'old', name: 'Old plan', amountMinor: 1250, cycle: 'monthly', usage: 'rarely', importance: 'optional', category: 'software', status: 'active' }] }),
  });
  const first = loadState(storage);
  const second = loadState(storage);
  assert.equal(first.migrated, true);
  assert.equal(first.state.subscriptions[0].amountMinor, 1250);
  assert.equal(first.state.subscriptions[0].currency, 'GBP');
  assert.equal(first.state.subscriptions[0].usage, 'less_than_monthly');
  assert.equal(second.migrated, false);
  assert.equal(second.state.subscriptions.length, 1);
});

test('oldest legacy keys migrate without duplication', () => {
  const storage = memoryStorage({
    subkiller_subscriptions: JSON.stringify([{ name: 'Oldest plan', price: 9.99, cycle: 'monthly', usage: 'often', category: 'other' }]),
    subkiller_currency: 'CHF',
  });
  assert.equal(loadState(storage).state.subscriptions[0].amountMinor, 999);
  assert.equal(loadState(storage).state.subscriptions.length, 1);
});

test('backup import validates the expected shape', () => {
  assert.throws(() => parseImportedState('{broken'), /valid JSON/);
  assert.throws(() => parseImportedState('{}'), /valid FeeVeto backup/);
});
