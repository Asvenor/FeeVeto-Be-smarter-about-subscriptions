import { formatMoney } from './calculations.js';

export const PREMIUM_PRICE_MINOR = 499;
export const PREMIUM_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);

export class CheckoutRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutRequestError';
  }
}

export function premiumPrice(currency) {
  const safeCurrency = PREMIUM_CURRENCIES.includes(currency) ? currency : 'USD';
  return formatMoney(PREMIUM_PRICE_MINOR, safeCurrency);
}

export function validStripeCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' ? url.href : '';
  } catch {
    return '';
  }
}

export async function beginPremiumCheckout({ clerk, currency, fetchImplementation = window.fetch.bind(window) }) {
  const token = await clerk?.session?.getToken?.();
  if (!token) return { state: 'sign_in_required' };

  const safeCurrency = PREMIUM_CURRENCIES.includes(currency) ? currency : 'USD';
  let response;
  try {
    response = await fetchImplementation(`./api/billing/checkout?currency=${encodeURIComponent(safeCurrency)}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CheckoutRequestError('Checkout could not be reached. Please try again.');
  }

  const body = await response.json().catch(() => ({}));
  if (response.status === 401) return { state: 'sign_in_required' };
  if (!response.ok) throw new CheckoutRequestError(body.error || 'Checkout could not be started. Please try again.');
  if (body.state === 'already_premium') return { state: 'already_premium' };

  const checkoutUrl = validStripeCheckoutUrl(body.checkoutUrl);
  if (!checkoutUrl) throw new CheckoutRequestError('Checkout returned an invalid destination.');
  return { state: 'checkout_ready', checkoutUrl };
}
