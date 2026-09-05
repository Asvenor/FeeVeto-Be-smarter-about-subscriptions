import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, parseImportedState, saveState, STORAGE_KEY } from '../src/storage.js';

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('loads and saves the versioned state', () => {
  const storage = memoryStorage();
  const state = { version: 1, currency: 'EUR', subscriptions: [] };
  assert.equal(saveState(storage, state), true);
  assert.deepEqual(loadState(storage).state, state);
});

test('migrates the original storage keys', () => {
  const storage = memoryStorage({
    subkiller_subscriptions: JSON.stringify([{ name: 'Old plan', price: 12.5, cycle: 'monthly', usage: 'rarely', category: 'software' }]),
    subkiller_currency: 'GBP',
  });
  const result = loadState(storage);
  assert.equal(result.migrated, true);
  assert.equal(result.state.currency, 'GBP');
  assert.equal(result.state.subscriptions[0].amountMinor, 1250);
  assert.ok(storage.getItem(STORAGE_KEY));
});

test('recovers from corrupted storage', () => {
  const result = loadState(memoryStorage({ [STORAGE_KEY]: '{broken' }));
  assert.equal(result.recovered, true);
  assert.deepEqual(result.state.subscriptions, []);
});

test('backup import validates the expected shape', () => {
  assert.throws(() => parseImportedState('{broken'), /valid JSON/);
  assert.throws(() => parseImportedState('{}'), /valid SubKiller backup/);
  const imported = parseImportedState(JSON.stringify({ version: 1, currency: 'USD', subscriptions: [] }));
  assert.equal(imported.currency, 'USD');
});
