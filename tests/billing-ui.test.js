import test from 'node:test';
import assert from 'node:assert/strict';
import { beginPremiumCheckout, premiumPrice, validStripeCheckoutUrl } from '../js/billing.js';

test('premium price follows the selected supported currency', () => {
  assert.equal(premiumPrice('USD'), '$4.99');
  assert.equal(premiumPrice('EUR'), '€4.99');
  assert.equal(premiumPrice('GBP'), '£4.99');
  assert.match(premiumPrice('CHF'), /4\.99/);
  assert.equal(premiumPrice('CAD'), '$4.99');
});

test('checkout destinations are restricted to Stripe HTTPS', () => {
  assert.equal(validStripeCheckoutUrl('https://checkout.stripe.com/c/pay/test'), 'https://checkout.stripe.com/c/pay/test');
  assert.equal(validStripeCheckoutUrl('https://example.com/fake'), '');
  assert.equal(validStripeCheckoutUrl('javascript:alert(1)'), '');
});

test('checkout request uses a Clerk token and selected currency without sending access flags', async () => {
  let request;
  const result = await beginPremiumCheckout({
    clerk: { session: { getToken: async () => 'session_test' } },
    currency: 'GBP',
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/c/pay/test' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(result.state, 'checkout_ready');
  assert.equal(request.url, './api/billing/checkout?currency=GBP');
  assert.equal(request.options.headers.Authorization, 'Bearer session_test');
  assert.equal(request.options.body, undefined);
});

test('signed-out visitors are sent to sign-in instead of checkout', async () => {
  const result = await beginPremiumCheckout({ clerk: null, currency: 'USD', fetchImplementation: async () => { throw new Error('must not fetch'); } });
  assert.equal(result.state, 'sign_in_required');
});
