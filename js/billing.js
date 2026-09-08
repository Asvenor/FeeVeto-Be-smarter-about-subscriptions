import { formatMoney } from './calculations.js';
import { BILLING_PLANS } from './billingPlans.js';
import { fetchAccessStatus } from './access.js';

export const PREMIUM_CURRENCIES = Object.freeze(['USD']);

export class CheckoutRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutRequestError';
  }
}

export function premiumPrice(plan = 'lifetime') {
  const price = BILLING_PLANS[plan] || BILLING_PLANS.lifetime;
  return formatMoney(price.amountMinor, price.currency);
}

export function validStripeCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' ? url.href : '';
  } catch {
    return '';
  }
}

export async function beginPremiumCheckout({ clerk, plan = 'lifetime', discountCode = '', fetchImplementation = window.fetch.bind(window) }) {
  let token;
  try { token = await clerk?.session?.getToken?.(); } catch { throw new CheckoutRequestError('Sign-in could not be verified. Please retry.'); }
  if (!token) return { state: 'sign_in_required' };
  if (!Object.hasOwn(BILLING_PLANS, plan)) throw new CheckoutRequestError('Choose a billing plan.');
  const code = String(discountCode || '').trim().toUpperCase();
  if (code && !/^[A-Z0-9]{8,32}$/.test(code)) throw new CheckoutRequestError('Enter a valid discount code.');
  let response;
  try {
    response = await fetchImplementation(`./api/billing/checkout?plan=${plan}&currency=USD`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(code ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(code ? { body: JSON.stringify({ discountCode: code }) } : {}),
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
  if (['already_premium', 'manage_subscription', 'confirmation_pending'].includes(body.state)) return { state: body.state };

  const checkoutUrl = validStripeCheckoutUrl(body.checkoutUrl);
  if (!checkoutUrl) throw new CheckoutRequestError('Checkout returned an invalid destination.');
  return { state: 'checkout_ready', checkoutUrl };
}

export function initializeBilling({ root = document, getClerk, getAccess, onVerifiedAccess = () => {}, notify = () => {},
  fetchImplementation = window.fetch.bind(window), navigate = url => window.location.assign(url) }) {
  const buttons = { monthly: root.getElementById('premium-monthly-button'), lifetime: root.getElementById('premium-button') };
  const statusElement = root.getElementById('premium-status');
  const manage = root.getElementById('billing-manage'), retry = root.getElementById('billing-refresh');
  const modeNotice = root.getElementById('billing-mode-notice');
  const discountInput = root.getElementById('premium-discount-code');
  const holdNote = root.getElementById('payment-hold-note');
  let configuration = { available: false, mode: 'test' }, status = null, busy = false, refreshing = false, revision = 0, error = '', owner = '';
  const returnUrl = new URL(root.defaultView.location.href);
  let pendingPlan = returnUrl.searchParams.get('payment') === 'success' ? (returnUrl.searchParams.get('plan') === 'monthly' ? 'monthly' : 'lifetime') : '';
  const identity = clerk => `${clerk?.user?.id || ''}:${clerk?.session?.id || ''}`;
  function render() {
    root.getElementById('premium-price').textContent = premiumPrice('lifetime');
    root.getElementById('premium-monthly-price').textContent = premiumPrice('monthly');
    const access = getAccess(), complimentary = access.isAdmin || access.betaAccess;
    for (const [plan, button] of Object.entries(buttons)) {
      const planAvailable = configuration.available && configuration.plans?.find(item => item.id === plan)?.available !== false;
      const managesMonthly = plan === 'monthly' && status?.subscription && !['canceled', 'incomplete_expired'].includes(status.subscription.status);
      button.disabled = busy || (!planAvailable && !managesMonthly) || complimentary || Boolean(status?.lifetimeAccess);
      button.textContent = complimentary ? (access.isAdmin ? 'Owner access active' : 'Beta access active')
        : status?.lifetimeAccess ? 'Lifetime access active'
        : managesMonthly ? 'Manage monthly plan'
        : !planAvailable ? 'New purchases paused'
        : !access.authenticated ? (plan === 'monthly' ? 'Sign in for monthly' : 'Sign in for lifetime')
        : plan === 'monthly' ? 'Subscribe — $2.99/month' : status?.subscriptionAccess ? 'Upgrade — $49.99 once' : 'Buy lifetime — $49.99';
    }
    manage.hidden = !status?.canManageBilling; manage.disabled = busy;
    if (holdNote) holdNote.hidden = configuration.available;
    if (discountInput) discountInput.disabled = busy || !configuration.available || complimentary || Boolean(status?.lifetimeAccess);
    retry.hidden = !error && !pendingPlan && !status?.renewalCancellationPending; retry.disabled = busy;
    modeNotice.textContent = !configuration.available ? 'Checkout is not enabled yet. The free audit still works.'
      : configuration.mode === 'test' ? 'Test checkout only — use Stripe test cards. No real payments.' : 'Secure checkout through Stripe.';
    statusElement.textContent = error || (busy ? 'Checking securely…' : pendingPlan ? 'Payment confirmation is pending. Access changes only after server verification.'
      : complimentary ? 'Premium is included with your account. No purchase is needed.'
      : status?.renewalCancellationPending ? 'Lifetime Premium is active. Monthly cancellation is still pending. Check billing and contact support if it persists; do not purchase again.'
      : status?.lifetimeAccess ? 'Lifetime Premium is active. No monthly subscription is renewing.'
      : status?.subscriptionAccess ? `Monthly Premium is active${status.subscription.cancelAtPeriodEnd ? '; renewal is cancelled' : ''}. Paid access ends ${new Date(status.subscription.paidThrough * 1000).toLocaleDateString()}.`
      : status?.subscription ? 'Your monthly plan needs attention or has ended. Manage billing to review its status.'
      : 'Sign in to connect your purchase to your account. Both plans unlock the same Premium features.');
  }
  async function authenticatedCall(path, method = 'GET') {
    const clerk = await getClerk(), key = identity(clerk), token = await clerk?.session?.getToken?.();
    if (!token) return { signedOut: true };
    const response = await fetchImplementation(path, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    if (key !== identity(await getClerk())) throw new CheckoutRequestError('Account changed. Please retry.');
    const body = await response.json();
    if (!response.ok) throw new CheckoutRequestError(body.error || 'Billing is temporarily unavailable. Please retry.');
    return body;
  }
  async function refresh() {
    const request = ++revision; refreshing = true;
    try {
      const clerk = await getClerk(), key = identity(clerk);
      if (owner !== key) { if (owner && owner !== ':') pendingPlan = ''; owner = key; status = null; error = ''; render(); }
      const next = await authenticatedCall('./api/billing/status');
      if (request !== revision || key !== identity(await getClerk())) return;
      status = next.signedOut ? null : next; error = '';
      if (pendingPlan && (pendingPlan === 'lifetime' ? status?.lifetimeAccess : status?.subscriptionAccess)) {
        const access = await fetchAccessStatus(clerk, fetchImplementation);
        if (request !== revision || key !== identity(await getClerk())) return;
        if (!access.paidPremiumAccess) throw new CheckoutRequestError('Payment is recorded, but access could not be verified yet. Please retry; do not purchase again.');
        pendingPlan = ''; onVerifiedAccess(access); notify('Your paid Premium access is confirmed.');
      }
    } catch (failure) { if (request === revision) { status = null; error = failure.message || 'Billing could not be checked. Retry without purchasing again.'; } }
    finally { if (request === revision) { refreshing = false; render(); } }
  }
  async function openPortal() {
    const result = await authenticatedCall('./api/billing/portal', 'POST');
    if (result.signedOut) { (await getClerk())?.openSignIn(); return; }
    const url = new URL(result.portalUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com') throw new CheckoutRequestError('Invalid billing destination.');
    navigate(url.href);
  }
  async function act(action) {
    if (busy) return; busy = true; error = ''; render();
    try { await action(); } catch (failure) { error = failure.message || 'Billing is unavailable. Please retry.'; notify(error); }
    finally { busy = false; render(); }
  }
  for (const [plan, button] of Object.entries(buttons)) button.addEventListener('click', () => void act(async () => {
    const clerk = await getClerk();
    if (!clerk?.session) { if (clerk) clerk.openSignIn(); else throw new CheckoutRequestError('Sign-in is unavailable.'); return; }
    const key = identity(clerk);
    if (plan === 'monthly' && status?.subscription && !['canceled', 'incomplete_expired'].includes(status.subscription.status)) return openPortal();
    const result = await beginPremiumCheckout({ clerk, plan, discountCode: discountInput?.value || '', fetchImplementation });
    if (key !== identity(await getClerk())) return;
    if (result.state === 'sign_in_required') clerk.openSignIn();
    else if (result.state === 'manage_subscription') await openPortal();
    else if (result.state === 'confirmation_pending') { pendingPlan = plan; await refresh(); }
    else if (result.state === 'already_premium') await refresh();
    else navigate(result.checkoutUrl);
  }));
  manage.addEventListener('click', () => void act(openPortal));
  retry.addEventListener('click', () => void act(refresh));
  root.addEventListener('feeveto:access-change', () => {
    // Never retain another account's billing state while a refresh is in flight.
    if (discountInput) discountInput.value = '';
    revision++; status = null; render(); if (!refreshing) void refresh(); else { refreshing = false; void refresh(); }
  });
  let configurationRevision = 0;
  async function refreshConfiguration() {
    const request = ++configurationRevision;
    try {
      const response = await fetchImplementation('./api/billing/plans', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Plans unavailable');
      const value = await response.json();
      if (request === configurationRevision) configuration = value;
    } catch { if (request === configurationRevision) configuration = { available: false, mode: 'test' }; }
    if (request === configurationRevision) render();
  }
  root.addEventListener('feeveto:owner-settings-change', () => void refreshConfiguration());
  root.addEventListener('visibilitychange', () => { if (root.visibilityState === 'visible') { void refreshConfiguration(); void refresh(); } });
  const ready = (async () => {
    await refreshConfiguration(); await refresh();
    if (returnUrl.searchParams.has('payment')) {
      returnUrl.searchParams.delete('payment'); returnUrl.searchParams.delete('plan');
      root.defaultView.history.replaceState({}, '', `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
    }
    for (let attempt = 0; pendingPlan && attempt < 5; attempt++) {
      await new Promise(resolve => root.defaultView.setTimeout(resolve, 1000)); await refresh();
    }
  })();
  render();
  return { render, refresh, ready };
}
