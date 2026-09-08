// This controller only presents server-verified access. Every admin endpoint
// independently verifies the Clerk session and private-metadata admin role.
const isOwner = access => access?.authenticated === true && access.role === 'admin' && access.isAdmin === true;
const sessionIdentity = clerk => `${clerk?.user?.id || ''}:${clerk?.session?.id || ''}`;
const planLabel = plan => ({ monthly: 'Monthly', lifetime: 'Lifetime', both: 'Monthly + Lifetime' }[plan] || 'Unknown plan');

export function initializeAdmin({ root = document, getClerk, getAccess = () => null,
  fetchImplementation = root.defaultView.fetch.bind(root.defaultView),
  createRequestId = () => root.defaultView.crypto.randomUUID() } = {}) {
  const byId = id => root.getElementById(id);
  const link = byId('owner-settings-link'), content = byId('admin-content');
  if (!link || !content) return null;
  const settingsForm = byId('admin-settings-form'), discountForm = byId('admin-discount-form');
  const settingsFields = byId('admin-settings-fields'), discountFields = byId('admin-discount-fields');
  const accessMessage = byId('admin-access-message'), loadStatus = byId('admin-load-status');
  const settingsStatus = byId('admin-settings-status'), discountStatus = byId('admin-discount-status');
  const refreshButton = byId('admin-refresh'), list = byId('admin-discount-list');
  let allowed = false, generation = 0, busy = false, settings = null, runtime = null, discounts = [], pending = null;

  function activity(value) {
    busy = value;
    settingsFields.disabled = value || !allowed || !settings;
    discountFields.disabled = value || !allowed || !settings;
    refreshButton.disabled = value || !allowed;
    content.setAttribute('aria-busy', String(value));
    for (const button of list.querySelectorAll('button')) button.disabled = value || (button.dataset.requiresStripe === 'true' && runtime?.stripeReady !== true);
    updateDuration();
  }

  function updateDuration() {
    const lifetime = discountForm.elements.plan.value === 'lifetime';
    if (lifetime) discountForm.elements.duration.value = 'once';
    discountForm.elements.duration.disabled = lifetime;
  }

  function clearAccess(message = 'Owner access is required. Sign in with your owner account to continue.') {
    const hadOwnerAccess = allowed;
    generation++;
    allowed = false; settings = null; runtime = null; discounts = []; pending = null;
    link.hidden = true; content.hidden = true;
    root.body.classList.remove('has-owner-controls');
    settingsForm.reset(); discountForm.reset();
    list.replaceChildren(); byId('admin-runtime-status').replaceChildren();
    loadStatus.textContent = ''; settingsStatus.textContent = ''; discountStatus.textContent = '';
    accessMessage.textContent = message; accessMessage.hidden = false;
    activity(false);
    // Initial Clerk/access checks start unpaid. Keep a deep link on its neutral
    // sign-in notice until verification completes, but leave a revoked panel.
    if (hadOwnerAccess && root.body.dataset.activeView === 'admin') {
      root.dispatchEvent(new root.defaultView.CustomEvent('feeveto:navigate', { detail: { id: 'top', focus: true } }));
    }
  }

  function assertCurrent(request, clerk, key) {
    if (!allowed || request !== generation || sessionIdentity(clerk) !== key) {
      const error = new Error('Account changed. Reopen owner settings after signing in.');
      error.stale = true;
      throw error;
    }
  }

  async function call(path, method = 'GET', data, request = generation) {
    const clerk = await getClerk(), key = sessionIdentity(clerk);
    assertCurrent(request, clerk, key);
    const token = await clerk?.session?.getToken?.();
    assertCurrent(request, await getClerk(), key);
    if (!token) {
      clearAccess('Your owner session has ended. Sign in again to continue.');
      throw new Error('Owner sign-in is required.');
    }
    let response;
    try {
      response = await fetchImplementation(path, {
        method, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}),
        cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('Owner settings could not be reached. Your changes are still here; retry when connected.');
    }
    assertCurrent(request, await getClerk(), key);
    const body = await response.json().catch(() => ({}));
    assertCurrent(request, await getClerk(), key);
    if (response.status === 401 || response.status === 403) {
      clearAccess('Owner access could not be verified. Sign in with an authorized owner account.');
      throw new Error('Owner access is required.');
    }
    if (!response.ok) {
      if (response.status === 409 && path.endsWith('/settings')) throw new Error('Settings changed elsewhere. Refresh owner settings before saving again. Your unsaved choices are still shown.');
      throw new Error(typeof body.error === 'string' ? body.error : 'The change could not be completed. Retry with the same answers.');
    }
    return body;
  }

  function renderRuntime() {
    const target = byId('admin-runtime-status');
    target.replaceChildren();
    const rows = [
      ['Deployment launch gate', runtime?.billingEnabled === true ? 'Enabled' : 'Paused — this panel cannot override it'],
      ['Stripe configuration', runtime?.stripeReady === true ? 'Configured' : 'Not ready — save drafts now; activation needs payment setup'],
      ['Payment environment', runtime?.billingMode === 'live' ? 'Live — changes affect real purchase offers' : 'Test only — no real charges'],
    ];
    for (const [label, value] of rows) {
      const dt = root.createElement('dt'), dd = root.createElement('dd');
      dt.textContent = label; dd.textContent = value; target.append(dt, dd);
    }
  }

  function dateLabel(seconds) {
    const date = new Date(Number(seconds) * 1000);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown date';
  }

  function renderDiscounts() {
    list.replaceChildren();
    if (!discounts.length) {
      const empty = root.createElement('p'); empty.className = 'admin-empty';
      empty.textContent = 'No owner-created discount codes yet.'; list.append(empty); return;
    }
    for (const discount of discounts) {
      const card = root.createElement('article'); card.className = 'admin-discount-card';
      const heading = root.createElement('h4'); heading.textContent = String(discount.code || 'Unnamed code');
      const offer = root.createElement('p');
      offer.textContent = `${discount.percentOff}% off · ${planLabel(discount.plan)} · ${discount.plan === 'lifetime' ? 'One payment' : discount.duration === 'forever' ? 'Every monthly payment' : 'First monthly payment'}${discount.plan === 'both' ? '; lifetime once' : ''}`;
      const state = root.createElement('p'); state.className = 'admin-code-state';
      const expired = discount.expiresAt && discount.expiresAt * 1000 <= Date.now();
      const exhausted = discount.maxRedemptions && discount.timesRedeemed >= discount.maxRedemptions;
      state.textContent = discount.status === 'draft' ? 'Draft — not redeemable yet'
        : discount.status === 'pending' ? 'Activation pending — retry to confirm'
        : discount.status === 'deactivating' ? 'Deactivation pending — retry to confirm'
        : expired ? 'Expired' : exhausted ? 'Redemption limit reached' : discount.active === true ? 'Active for new uses' : 'Inactive';
      const limits = root.createElement('p'); limits.className = 'field-help';
      limits.textContent = `${Number.isInteger(discount.timesRedeemed) ? discount.timesRedeemed : 'Unknown'} uses${discount.maxRedemptions ? ` of ${discount.maxRedemptions}` : '; no use limit'} · ${discount.expiresAt ? `Redeem before ${dateLabel(discount.expiresAt)}` : 'No expiry date'}`;
      card.append(heading, offer, state, limits);
      if (['draft', 'pending'].includes(discount.status)) {
        const button = root.createElement('button'); button.type = 'button'; button.className = 'button button-secondary';
        button.textContent = discount.status === 'pending' ? 'Retry activation' : 'Activate code';
        button.setAttribute('aria-label', `${button.textContent} ${discount.code}`);
        button.dataset.requiresStripe = 'true'; button.disabled = runtime?.stripeReady !== true;
        button.addEventListener('click', () => void activateDiscount(discount)); card.append(button);
        if (!runtime?.stripeReady) {
          const note = root.createElement('p'); note.className = 'field-help';
          note.textContent = discount.status === 'draft' ? 'Payment setup is needed before activation. This draft is safely saved.'
            : 'Payment setup is needed to finish activation. You can request deactivation instead.';
          card.append(note);
        }
      }
      if (discount.active === true || ['draft', 'pending', 'deactivating'].includes(discount.status)) {
        const button = root.createElement('button'); button.type = 'button'; button.className = 'button button-secondary';
        button.textContent = discount.status === 'draft' ? 'Discard draft' : discount.status === 'deactivating' ? 'Retry deactivation'
          : discount.status === 'pending' ? 'Stop activation' : 'Deactivate code';
        button.setAttribute('aria-label', `${button.textContent} ${discount.code}`);
        // Keep this action available even if Stripe setup is unavailable: the
        // backend denies new uses first and can discard unpublished drafts locally.
        button.addEventListener('click', () => void deactivate(discount)); card.append(button);
      }
      list.append(card);
    }
  }

  function fillSettings(next) {
    if (!next || !Number.isInteger(next.revision)) throw new Error('Purchase settings could not be verified. Refresh before changing them.');
    settings = next;
    for (const key of ['acceptNewPurchases', 'monthlyEnabled', 'lifetimeEnabled']) settingsForm.elements[key].checked = next[key] === true;
  }

  async function refresh() {
    if (!allowed || busy) return;
    const request = generation;
    activity(true); loadStatus.textContent = 'Loading owner settings securely…';
    try {
      const next = await call('./api/admin/settings', 'GET', undefined, request);
      if (request !== generation) return;
      fillSettings(next.settings); runtime = next.runtime; renderRuntime();
      const codes = await call('./api/admin/discounts', 'GET', undefined, request);
      if (request !== generation) return;
      discounts = Array.isArray(codes.discounts) ? codes.discounts : [];
      renderDiscounts(); loadStatus.textContent = '';
    } catch (error) {
      if (request === generation) loadStatus.textContent = error.message || 'Owner settings could not be loaded. Use Refresh owner settings to retry.';
    } finally { if (request === generation) activity(false); }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!allowed || busy || !settings) return;
    const request = generation;
    const body = { revision: settings.revision };
    for (const key of ['acceptNewPurchases', 'monthlyEnabled', 'lifetimeEnabled']) body[key] = settingsForm.elements[key].checked;
    activity(true); settingsStatus.textContent = 'Saving purchase settings…';
    try {
      const next = await call('./api/admin/settings', 'PUT', body, request);
      if (request !== generation) return;
      fillSettings(next.settings);
      if (next.runtime) { runtime = next.runtime; renderRuntime(); }
      settingsStatus.textContent = settings.acceptNewPurchases ? 'Saved. New purchases still require the deployment launch gate and a ready Stripe configuration.' : 'Saved. New purchases are paused. Existing subscriptions and paid access are unchanged.';
      root.dispatchEvent(new root.defaultView.CustomEvent('feeveto:owner-settings-change'));
    } catch (error) { if (request === generation) settingsStatus.textContent = error.message; }
    finally { if (request === generation) activity(false); }
  }

  function discountInput() {
    const fields = discountForm.elements;
    const body = { code: fields.code.value.trim().toUpperCase(), percentOff: Number(fields.percentOff.value), plan: fields.plan.value,
      duration: fields.plan.value === 'lifetime' ? 'once' : fields.duration.value };
    if (fields.expiresAt.value) body.expiresAt = Math.floor(new Date(fields.expiresAt.value).getTime() / 1000);
    if (fields.maxRedemptions.value) body.maxRedemptions = Number(fields.maxRedemptions.value);
    return body;
  }

  async function createDiscount(event) {
    event.preventDefault();
    if (!allowed || busy || !settings || !discountForm.reportValidity()) return;
    const request = generation, input = discountInput();
    if (input.expiresAt && input.expiresAt <= Date.now() / 1000) {
      discountStatus.textContent = 'Choose a future redemption date, or leave it empty.'; discountForm.elements.expiresAt.focus(); return;
    }
    const fingerprint = JSON.stringify(input);
    if (pending?.fingerprint !== fingerprint) pending = { fingerprint, requestId: createRequestId() };
    activity(true); discountStatus.textContent = 'Saving the discount draft securely…';
    try {
      const result = await call('./api/admin/discounts', 'POST', { ...input, requestId: pending.requestId }, request);
      if (request !== generation) return;
      if (!result.discount?.id) throw new Error('The result could not be confirmed. Retry with the same answers; do not create a different code yet.');
      discounts = [result.discount, ...discounts.filter(code => code.id !== result.discount.id)];
      renderDiscounts(); discountForm.reset(); pending = null;
      discountStatus.textContent = `Draft ${result.discount.code} saved. It is not redeemable until you activate it. Purchase availability has not changed.`;
    } catch (error) { if (request === generation) discountStatus.textContent = `${error.message} Your answers are kept. Retry uses the same request when the answers are unchanged.`; }
    finally { if (request === generation) activity(false); }
  }

  async function activateDiscount(discount) {
    if (!allowed || busy || runtime?.stripeReady !== true) return;
    const request = generation;
    activity(true); loadStatus.textContent = `Activating ${discount.code} in ${runtime.billingMode === 'live' ? 'live Stripe' : 'test Stripe'}…`;
    try {
      const result = await call('./api/admin/discounts', 'PATCH', { id: discount.id, action: 'activate' }, request);
      if (request !== generation) return;
      if (!result.discount?.id) throw new Error('Activation could not be confirmed. Retry activation with this same code.');
      discounts = discounts.map(code => code.id === result.discount.id ? result.discount : code);
      renderDiscounts();
      loadStatus.textContent = result.discount.status === 'active' && result.discount.active === true
        ? `${discount.code} is active. Purchase availability has not changed.`
        : 'Activation is not confirmed yet. Retry activation with the same code.';
    } catch (error) { if (request === generation) loadStatus.textContent = `${error.message} Retry activation with the same code; do not save a duplicate.`; }
    finally { if (request === generation) activity(false); }
  }

  async function deactivate(discount) {
    if (!allowed || busy) return;
    const request = generation;
    activity(true); loadStatus.textContent = discount.status === 'draft' ? `Discarding draft ${discount.code}…` : `Deactivating ${discount.code}…`;
    try {
      const result = await call('./api/admin/discounts', 'PATCH', { id: discount.id, active: false }, request);
      if (request !== generation) return;
      if (!result.discount?.id) throw new Error('Deactivation could not be confirmed. Refresh before trying again.');
      discounts = discounts.map(code => code.id === result.discount.id ? result.discount : code);
      renderDiscounts(); loadStatus.textContent = discount.status === 'draft' ? `Draft ${discount.code} discarded. No Stripe discount was activated.`
        : `${discount.code} is inactive for new uses. Existing subscription discounts are unchanged.`;
    } catch (error) { if (request === generation) loadStatus.textContent = `${error.message} Deactivation is not confirmed. Use this code’s discard or deactivation action to retry.`; }
    finally { if (request === generation) activity(false); }
  }

  function updateAccess(access) {
    if (!isOwner(access)) { clearAccess(); return; }
    if (allowed) return;
    generation++; allowed = true; link.hidden = false; content.hidden = false;
    root.body.classList.add('has-owner-controls');
    accessMessage.hidden = true; accessMessage.textContent = '';
    void refresh();
  }
  settingsForm.addEventListener('submit', event => void saveSettings(event));
  discountForm.addEventListener('submit', event => void createDiscount(event));
  discountForm.elements.plan.addEventListener('change', updateDuration);
  refreshButton.addEventListener('click', () => void refresh());
  root.addEventListener('feeveto:access-change', event => updateAccess(event.detail));
  updateAccess(getAccess());
  return { refresh, get allowed() { return allowed; } };
}
