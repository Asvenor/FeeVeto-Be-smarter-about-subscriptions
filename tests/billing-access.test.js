import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateLifetimeAccess,
  getPaidPremiumAccess,
  getPaidPremiumAccessStrict,
  revokeRefundedAccess,
} from '../functions/_shared/billing-access.js';

function fakeDatabase({ accessRow = null, failFirst = false } = {}) {
  const calls = { prepared: [], batches: [] };
  const database = {
    prepare(sql) {
      calls.prepared.push(sql);
      return {
        bind(...values) {
          return {
            sql,
            values,
            first: async () => {
              if (failFirst) throw new Error('storage failed');
              return accessRow;
            },
            run: async () => ({ success: true }),
          };
        },
      };
    },
    async batch(statements) {
      calls.batches.push(statements);
      return statements.map(() => ({ success: true }));
    },
  };
  return { database, calls };
}

const event = Object.freeze({ id: 'evt_test', type: 'checkout.session.completed', created: 1_788_800_000 });

test('paid access defaults to false when billing storage is absent or fails', async () => {
  assert.equal(await getPaidPremiumAccess({ userId: 'user_test', env: {} }), false);
  const { database } = fakeDatabase({ failFirst: true });
  assert.equal(await getPaidPremiumAccess({ userId: 'user_test', env: { FEEVETO_BILLING: database } }), false);
});

test('checkout-grade paid access lookup reports missing or failed storage', async () => {
  await assert.rejects(() => getPaidPremiumAccessStrict({ userId: 'user_test', env: {} }), /not configured/);
  const { database } = fakeDatabase({ failFirst: true });
  await assert.rejects(() => getPaidPremiumAccessStrict({ userId: 'user_test', env: { FEEVETO_BILLING: database } }), /storage failed/);
});

test('paid access is granted only by an active server record', async () => {
  const active = fakeDatabase({ accessRow: { has_access: 1 } });
  const inactive = fakeDatabase({ accessRow: null });
  assert.equal(await getPaidPremiumAccess({ userId: 'user_test', env: { FEEVETO_BILLING: active.database } }), true);
  assert.equal(await getPaidPremiumAccess({ userId: 'user_test', env: { FEEVETO_BILLING: inactive.database } }), false);
});

test('verified checkout activation stores a lifetime entitlement and event together', async () => {
  const { database, calls } = fakeDatabase();
  await activateLifetimeAccess({
    env: { FEEVETO_BILLING: database },
    event,
    session: {
      clerkUserId: 'user_test', customerId: 'cus_test', paymentIntentId: 'pi_test',
      checkoutSessionId: 'cs_test', priceId: 'price_test', amountTotal: 499, currency: 'USD',
    },
  });
  assert.equal(calls.batches.length, 1);
  assert.equal(calls.batches[0].length, 2);
  assert.match(calls.batches[0][1].sql, /ON CONFLICT\(clerk_user_id\)/);
  assert.deepEqual(calls.batches[0][1].values.slice(0, 8), [
    'user_test', 'cus_test', 'pi_test', 'cs_test', 'feeveto_premium_lifetime', 'price_test', 499, 'USD',
  ]);
});

test('a full refund revokes only the matching active payment entitlement', async () => {
  const { database, calls } = fakeDatabase();
  await revokeRefundedAccess({ env: { FEEVETO_BILLING: database }, event: { ...event, type: 'charge.refunded' }, paymentIntentId: 'pi_test' });
  assert.match(calls.batches[0][1].sql, /status = 'refunded'/);
  assert.equal(calls.batches[0][1].values[1], 'pi_test');
});
