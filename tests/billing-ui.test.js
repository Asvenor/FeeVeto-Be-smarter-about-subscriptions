import test from 'node:test';
import assert from 'node:assert/strict';
import { beginPremiumCheckout, premiumPrice, validStripeCheckoutUrl } from '../js/billing.js';

test('approved purchase prices stay in USD independently of illustrative currency', () => {
  assert.equal(premiumPrice('monthly'), '$2.99');
  assert.equal(premiumPrice('lifetime'), '$49.99');
  assert.equal(premiumPrice('EUR'), '$49.99');
});

test('checkout destinations are restricted to Stripe HTTPS', () => {
  assert.equal(validStripeCheckoutUrl('https://checkout.stripe.com/c/pay/test'), 'https://checkout.stripe.com/c/pay/test');
  assert.equal(validStripeCheckoutUrl('https://example.com/fake'), '');
  assert.equal(validStripeCheckoutUrl('javascript:alert(1)'), '');
});

test('checkout request uses a Clerk token and approved plan without sending access flags', async () => {
  let request;
  const result = await beginPremiumCheckout({
    clerk: { session: { getToken: async () => 'session_test' } },
    plan: 'monthly',
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/c/pay/test' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(result.state, 'checkout_ready');
  assert.equal(request.url, './api/billing/checkout?plan=monthly&currency=USD');
  assert.equal(request.options.headers.Authorization, 'Bearer session_test');
  assert.equal(request.options.body, undefined);
});

test('signed-out visitors are sent to sign-in instead of checkout', async () => {
  const result = await beginPremiumCheckout({ clerk: null, currency: 'USD', fetchImplementation: async () => { throw new Error('must not fetch'); } });
  assert.equal(result.state, 'sign_in_required');
});

test('discount codes are sent only in the authenticated body, never as prices, entitlement flags, or URLs', async () => {
  let request;
  await beginPremiumCheckout({ clerk: { session: { getToken: async () => 'session_test' } }, plan: 'lifetime', discountCode: ' welcome25 ',
    fetchImplementation: async (url, options) => { request = { url, options }; return Response.json({ checkoutUrl: 'https://checkout.stripe.com/c/pay/test' }); } });
  assert.equal(request.url.includes('WELCOME25'), false);
  assert.deepEqual(JSON.parse(request.options.body), { discountCode: 'WELCOME25' });
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  await assert.rejects(() => beginPremiumCheckout({ clerk: { session: { getToken: async () => 'session_test' } }, discountCode: '<script>',
    fetchImplementation: async () => { throw new Error('must not fetch'); } }), /valid discount code/);
});
