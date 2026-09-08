import { safeProductEvent } from './telemetrySchema.js';

const PREFERENCE = 'feeveto_analytics_consent_v1', VISITED = 'feeveto_analytics_visited_v1';
let controller = null;
export function productEvent(event, fields = {}) { return controller?.send({ event, ...fields }) ?? Promise.resolve(false); }
export function feedbackEvent(fields) { return controller?.send({ event: 'result_feedback', ...fields }, true) ?? Promise.resolve(false); }

export function initializeAnalytics({ root = document, storage, fetchImplementation = globalThis.fetch, navigator = root.defaultView.navigator } = {}) {
  let enabled = false, sent = 0, visited = false;
  try { enabled = storage?.getItem(PREFERENCE) === 'yes'; visited = storage?.getItem(VISITED) === 'yes'; } catch { /* optional storage */ }
  const blocked = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  const pending = new Set();
  async function send(value, explicitFeedback = false) {
    if (blocked() || (!explicitFeedback && !enabled) || sent >= 60 || !safeProductEvent(value)) return false;
    sent++;
    const abort = new AbortController(); pending.add(abort);
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await fetchImplementation('./api/events', { method: 'POST', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', keepalive: true, signal: abort.signal });
      const result = await response.json().catch(() => null);
      return response.ok && result?.accepted === true;
    } catch { return false; }
    finally { clearTimeout(timer); pending.delete(abort); }
  }
  let landingSent = false;
  function landing() {
    if (landingSent || !enabled || blocked() || !root.getElementById('intent-form')) return;
    landingSent = true;
    void send({ event: 'landing_visit', returning: visited });
    try { storage?.setItem(VISITED, 'yes'); } catch { /* no identifier fallback */ }
  }
  const checkbox = root.getElementById('analytics-consent');
  if (checkbox) {
    checkbox.checked = enabled && !blocked(); checkbox.disabled = blocked();
    const status = root.getElementById('analytics-consent-status');
    if (blocked() && status) status.textContent = 'Your browser privacy signal disables measurement.';
    checkbox.addEventListener('change', () => {
      enabled = checkbox.checked && !blocked();
      try { storage?.setItem(PREFERENCE, enabled ? 'yes' : 'no'); if (!enabled) storage?.removeItem(VISITED); } catch { if (status) status.textContent = 'This preference could not be saved; it applies to this page only.'; }
      if (!enabled) for (const abort of pending) abort.abort();
      else landing();
    });
  }
  root.addEventListener('click', event => {
    const link = event.target.closest?.('[data-alternative-outbound]');
    if (link) void send({ event: 'alternative_clicked', ...(link.dataset.serviceId ? { serviceId: link.dataset.serviceId } : {}), surface: link.closest('#personal-audit') ? 'advanced' : link.closest('#subscription-list') ? 'subscription' : 'discover' });
    if (event.target.closest?.('#sign-up-button')) void send({ event: 'account_signup_started', surface: 'account' });
  });
  root.defaultView?.addEventListener('storage', event => {
    if (event.key !== PREFERENCE && event.key !== null) return;
    enabled = event.newValue === 'yes' && !blocked();
    if (checkbox) checkbox.checked = enabled;
    if (!enabled) { visited = false; for (const abort of pending) abort.abort(); }
    else landing();
  });
  controller = { send }; landing();
  return { send, get enabled() { return enabled && !blocked(); } };
}
