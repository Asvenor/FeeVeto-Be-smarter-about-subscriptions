import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { handleCheckoutRequest } from '../functions/api/billing/checkout.js';
import { handleWebhookRequest } from '../functions/api/billing/webhook.js';

function checkoutContext(currency = 'USD') {
  return {
    env: {},
    request: new Request(`https://feeveto.example/api/billing/checkout?plan=lifetime&currency=${currency}`, { method: 'POST' }),
  };
}

const ordinaryIdentity = Object.freeze({
  userId: 'user_test',
  user: {
    privateMetadata: { role: 'user', betaAccess: false },
    primaryEmailAddressId: 'email_primary',
    emailAddresses: [{ id: 'email_primary', emailAddress: 'buyer@example.test' }],
  },
});

test('checkout requires a verified Clerk identity', async () => {
  const response = await handleCheckoutRequest(checkoutContext(), { identityResolver: async () => null });
  assert.equal(response.status, 401);
});

test('checkout fails safely instead of risking a duplicate charge when billing is unavailable', async () => {
  const response = await handleCheckoutRequest(checkoutContext(), {
    identityResolver: async () => ordinaryIdentity,
  });
  assert.equal(response.status, 503);
});

test('checkout accepts only supported currencies', async () => {
  const response = await handleCheckoutRequest(checkoutContext('CAD'), {
    identityResolver: async () => ordinaryIdentity,
    paidAccessResolver: async () => false,
  });
  assert.equal(response.status, 400);
});

test('complimentary users are not sent through checkout again', async () => {
  const betaResponse = await handleCheckoutRequest(checkoutContext(), {
    identityResolver: async () => ({ ...ordinaryIdentity, user: { ...ordinaryIdentity.user, privateMetadata: { role: 'user', betaAccess: true } } }),
    paidAccessResolver: async () => false,
  });
  assert.deepEqual(await betaResponse.json(), { state: 'already_premium' });
});

test('checkout does not invent unapproved EUR prices', async () => {
  let created;
  const response = await handleCheckoutRequest(checkoutContext('EUR'), {
    identityResolver: async () => ordinaryIdentity,
    paidAccessResolver: async () => false,
    priceIdResolver: () => 'price_test',
    stripeClientFactory: () => ({ checkout: { sessions: { create: async (input) => {
      created = input;
      return { url: 'https://checkout.stripe.com/c/pay/test' };
    } } } }),
  });
  assert.equal(response.status, 400);
  assert.equal(created, undefined);
});

function webhookRequest() {
  return {
    env: {},
    request: new Request('https://feeveto.example/api/billing/webhook', {
      method: 'POST',
      headers: { 'Stripe-Signature': 'test-signature' },
      body: '{"id":"evt_test"}',
    }),
  };
}

function completedEvent(overrides = {}) {
  return {
    id: 'evt_test', type: 'checkout.session.completed', created: 1_788_800_000,
    data: { object: {
      id: 'cs_test', mode: 'payment', payment_status: 'paid', amount_total: 499, currency: 'usd',
      client_reference_id: 'user_test', customer: 'cus_test', payment_intent: 'pi_test',
      metadata: { clerk_user_id: 'user_test', product_key: 'feeveto_premium_lifetime' },
      ...overrides,
    } },
  };
}

function webhookStripe(event, priceId = 'price_test') {
  return {
    webhooks: { constructEventAsync: async () => event },
    checkout: { sessions: { listLineItems: async () => ({ data: [{ price: { id: priceId } }] }) } },
  };
}

const webhookDependencies = (stripe, additions = {}) => ({
  stripeClientFactory: () => stripe,
  cryptoProviderFactory: () => ({}),
  webhookSecretResolver: () => 'whsec_test',
  priceIdResolver: () => 'price_test',
  eventRecorder: async () => {},
  accessActivator: async () => {},
  refundRevoker: async () => {},
  ...additions,
});

test('webhook grants lifetime access only after a valid paid product event', async () => {
  const event = completedEvent();
  let activation;
  const response = await handleWebhookRequest(webhookRequest(), webhookDependencies(webhookStripe(event), {
    accessActivator: async (value) => { activation = value; },
  }));
  assert.equal(response.status, 200);
  assert.equal(activation.session.clerkUserId, 'user_test');
  assert.equal(activation.session.paymentIntentId, 'pi_test');
  assert.equal(activation.session.amountTotal, 499);
  assert.equal(activation.session.currency, 'USD');
});

test('webhook refuses to grant access for another price or mismatched identity', async () => {
  let activations = 0;
  let recorded = 0;
  const wrongPrice = await handleWebhookRequest(webhookRequest(), webhookDependencies(webhookStripe(completedEvent(), 'price_other'), {
    accessActivator: async () => { activations += 1; },
    eventRecorder: async () => { recorded += 1; },
  }));
  const mismatch = completedEvent({ client_reference_id: 'user_other' });
  await handleWebhookRequest(webhookRequest(), webhookDependencies(webhookStripe(mismatch), {
    accessActivator: async () => { activations += 1; },
    eventRecorder: async () => { recorded += 1; },
  }));
  assert.equal(wrongPrice.status, 200);
  assert.equal(activations, 0);
  assert.equal(recorded, 2);
});

test('webhook revokes matching access after a full refund', async () => {
  const event = {
    id: 'evt_refund', type: 'charge.refunded', created: 1_788_800_000,
    data: { object: { refunded: true, payment_intent: 'pi_test' } },
  };
  let revoked;
  const response = await handleWebhookRequest(webhookRequest(), webhookDependencies(webhookStripe(event), {
    refundRevoker: async (value) => { revoked = value; },
  }));
  assert.equal(response.status, 200);
  assert.equal(revoked.paymentIntentId, 'pi_test');
});

test('webhook rejects missing and invalid signatures', async () => {
  const unsigned = webhookRequest();
  unsigned.request = new Request(unsigned.request.url, { method: 'POST', body: '{}' });
  assert.equal((await handleWebhookRequest(unsigned)).status, 400);

  const invalid = Object.assign(new Error('bad signature'), { type: 'StripeSignatureVerificationError' });
  const response = await handleWebhookRequest(webhookRequest(), webhookDependencies({
    webhooks: { constructEventAsync: async () => { throw invalid; } },
  }));
  assert.equal(response.status, 400);
});

test('webhook accepts a signature generated by Stripe with the Worker crypto provider', async () => {
  const stripe = new Stripe('sk_test_not_a_real_key', { httpClient: Stripe.createFetchHttpClient(), telemetry: false });
  const secret = 'whsec_not_a_real_secret';
  const payload = JSON.stringify({
    id: 'evt_signed', object: 'event', type: 'customer.created', created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'cus_test' } },
  });
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
  let recorded = false;
  const response = await handleWebhookRequest({
    env: {},
    request: new Request('https://feeveto.example/api/billing/webhook', {
      method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload,
    }),
  }, webhookDependencies(stripe, {
    webhookSecretResolver: () => secret,
    cryptoProviderFactory: () => Stripe.createSubtleCryptoProvider(),
    eventRecorder: async () => { recorded = true; },
  }));
  assert.equal(response.status, 200);
  assert.equal(recorded, true);
});
