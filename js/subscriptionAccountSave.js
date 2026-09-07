import { journeyFromSubscription, journeySubmission } from './journeyModel.js';
import { journeyRequest, journeySession } from './journeyApi.js';

export const SUBSCRIPTION_SAVE_KEY = 'feeveto_subscription_account_outbox_v1';

// Only explicitly submitted entries enter this outbox. Never scan or upload the local list.
export function initializeSubscriptionAccountSave({ getClerk, getCurrency, storage, onSaved }) {
  const status = document.getElementById('subscription-save-status');
  const retry = document.getElementById('retry-subscription-save');
  const savedLink = document.getElementById('subscription-saved-link');
  let pending = [];
  let running = null;
  let revision = 0;
  try {
    const stored = JSON.parse(storage?.getItem(SUBSCRIPTION_SAVE_KEY));
    if (Array.isArray(stored)) pending = stored.filter((entry) =>
      typeof entry.expectedOwner === 'string' && entry.expectedOwner &&
      typeof entry.sourceSubscriptionId === 'string' && entry.sourceSubscriptionId &&
      typeof entry.requestKey === 'string' && entry.draft,
    ).slice(0, 50).map((entry) => ({
      expectedOwner: entry.expectedOwner,
      sourceSubscriptionId: entry.sourceSubscriptionId,
      requestKey: entry.requestKey,
      marketCurrency: entry.marketCurrency,
      draft: journeySubmission(entry.draft),
    }));
  } catch {}
  function persist() {
    try {
      if (pending.length) storage?.setItem(SUBSCRIPTION_SAVE_KEY, JSON.stringify(pending));
      else storage?.removeItem(SUBSCRIPTION_SAVE_KEY);
      return true;
    } catch { return false; }
  }
  async function drain() {
    if (running) return running;
    running = (async () => {
      retry.disabled = true;
      const epoch = revision;
      try {
        while (pending.length) {
          const { clerk, user, token } = await journeySession(getClerk);
          if (epoch !== revision) return;
          if (!user || !token || clerk.user?.id !== user) {
            status.textContent = 'Saved in this browser. Sign in to the original account, then retry the account save.';
            retry.hidden = false;
            return;
          }
          const ticket = pending.find((entry) => entry.expectedOwner === user);
          if (!ticket) return; // A different account must never receive another account's pending save.
          status.textContent = 'Saved in this browser. Saving to your account…';
          const value = await journeyRequest('audits', { token, body: ticket });
          pending = pending.filter((entry) => entry !== ticket);
          persist();
          if (epoch !== revision || clerk.user?.id !== user) return;
          status.textContent = 'Saved to your account and this browser. Open Saved audits to revisit it.';
          savedLink.hidden = false;
          retry.hidden = !pending.some((entry) => entry.expectedOwner === user);
          await onSaved?.(value.saved);
        }
      } catch (error) {
        if (epoch === revision) {
          status.textContent = `Saved in this browser, but the account save did not finish. ${error.message} Retry without entering your answers again.`;
          retry.hidden = false;
        }
      } finally { retry.disabled = false; }
    })();
    try { await running; } finally { running = null; }
  }
  async function save(subscription) {
    const epoch = revision;
    const draft = journeySubmission(journeyFromSubscription(subscription, getCurrency()));
    const marketCurrency = getCurrency();
    status.textContent = 'Saved in this browser. Checking account sign-in…';
    savedLink.hidden = true;
    try {
      const { clerk, user, token } = await journeySession(getClerk);
      if (epoch !== revision || clerk?.user?.id !== user || !user || !token) {
        status.textContent = 'Saved in this browser only. To add it to Saved audits, sign in, then edit this entry and choose Save and review.';
        return;
      }
      // Repeated clicks/retries use the same request; edits remain dated versions of one audit.
      if (!pending.some((entry) => entry.expectedOwner === user &&
        entry.sourceSubscriptionId === subscription.id &&
        JSON.stringify(entry.draft) === JSON.stringify(draft) && entry.marketCurrency === marketCurrency)) {
        if (pending.length >= 50) throw new Error('Retry the unfinished account saves before adding more.');
        pending.push({ expectedOwner: user, sourceSubscriptionId: subscription.id,
          requestKey: crypto.randomUUID(), draft, marketCurrency });
        if (!persist()) status.textContent = 'The account save is pending in this tab. Keep it open until saving finishes.';
      }
      await drain();
    } catch (error) {
      status.textContent = `Saved in this browser only. ${error.message} Edit the entry and save again to add it to your account.`;
    }
  }
  async function authChanged() {
    const epoch = ++revision;
    savedLink.hidden = true;
    retry.hidden = true;
    status.textContent = '';
    try {
      const { user } = await journeySession(getClerk);
      if (epoch === revision && user && pending.some((entry) => entry.expectedOwner === user)) {
        status.textContent = 'An account save is unfinished. Your answers are kept; retry to finish saving.';
        retry.hidden = false;
      }
    } catch {} // Existing sign-in UI reports outages; never send without a session.
  }
  retry.addEventListener('click', () => void drain());
  document.addEventListener('feeveto:access-change', () => void authChanged());
  void authChanged();
  return { save, retry: drain };
}
