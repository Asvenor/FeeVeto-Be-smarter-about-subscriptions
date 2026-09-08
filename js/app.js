import { APP_CONFIG } from './config.js';
import { fromMinorUnits } from './calculations.js';
import { fillCurrencyOptions, renderIllustrativeMoney, shouldApplyCurrencyDefault, validCurrencyPreference } from './currencyPreference.js';
import { AlternativeRequestError, AlternativeRequestTracker, BackendAlternativesProvider, recommendationRequestFor } from './alternativeProvider.js';
import { buildDetailedReview, categoryForProductType, upsertSubscription } from './formModel.js';
import { renderDashboard } from './render.js';
import { detectSupportedService, matchingProfileFor, PRODUCT_TYPES, serviceById, supportedServiceFor, SUPPORTED_SERVICES } from './serviceCatalog.js';
import { loadState, normalizeSubscription, parseImportedState, saveState } from './storage.js';
import { createId, validateSubscriptionInput } from './validation.js';
import { initializeAuth } from './auth.js';
import { ORDINARY_ACCESS } from './access.js';
import { initializeBilling } from './billing.js';
import { initializeAdmin } from './admin.js';
import { initializeJourney } from './journey.js';
import { journeyFromSubscription } from './journeyModel.js';
import { initializeExperience, openDisclosures, revealContent } from './experience.js';

document.title = `${APP_CONFIG.brandName} — ${APP_CONFIG.slogan}`;
document.querySelector('meta[name="description"]')?.setAttribute('content', APP_CONFIG.description);
initializeExperience(document);

const byId = (id) => document.getElementById(id);
const elements = {
  form: byId('subscription-form'), formTitle: byId('form-title'), editBadge: byId('edit-badge'), submitButton: byId('submit-button'), cancelEdit: byId('cancel-edit'),
  currencyPreference: byId('currency-preference'), priceCurrency: byId('price-currency'), list: byId('subscription-list'), listSummary: byId('list-summary'),
  totalMonthly: byId('total-monthly'), totalAnnual: byId('total-annual'), potentialSavings: byId('potential-savings'), subscriptionCount: byId('subscription-count'),
  actionCount: byId('action-count'), currencySummary: byId('currency-summary'), summaryGrid: byId('summary-grid'), monthlyTotalLabel: byId('monthly-total-label'),
  annualTotalLabel: byId('annual-total-label'), savingsTotalLabel: byId('savings-total-label'), search: byId('result-search'), clearAll: byId('clear-all'), clearDialog: byId('clear-dialog'),
  confirmClear: byId('confirm-clear'), exportData: byId('export-data'), importData: byId('import-data'), importFile: byId('import-file'),
  toast: byId('toast'), toastMessage: byId('toast-message'), toastAction: byId('toast-action'), announcer: byId('announcer'),
  requirementQuestions: byId('requirement-questions'), serviceSupport: byId('service-support'),
  premiumPrice: byId('premium-price'), premiumButton: byId('premium-button'), premiumStatus: byId('premium-status'),
};

const browserStorage = (() => {
  try { return window.localStorage; } catch { return { getItem() { return null; }, setItem() { throw new Error('Storage unavailable'); } }; }
})();
const loaded = loadState(browserStorage);
let state = loaded.state;
let activeFilter = 'all';
let toastTimer;
let autoServiceSelection = true;
let categoryManuallyChanged = false;
let entryCurrencyExplicitlyChanged = false;
let renderedRequirementServiceId = '';
let currentAccess = ORDINARY_ACCESS;
let billingController;
const requirementDrafts = new Map();
const alternativesProvider = new BackendAlternativesProvider();
const alternativeResults = new Map();
const alternativeRequests = new AlternativeRequestTracker();

function invalidateAlternativeRequest(id) {
  alternativeRequests.invalidate(id);
  alternativeResults.delete(id);
}

function invalidateAllAlternativeRequests() {
  alternativeRequests.invalidateAll();
  alternativeResults.clear();
}

function persist() {
  const saved = saveState(browserStorage, state);
  byId('storage-warning').hidden = saved;
  if (!saved) showToast('Your changes work for now, but this browser could not save them.');
}

function render() {
  elements.currencyPreference.value = state.auditCurrency;
  renderIllustrativeMoney(document, state.auditCurrency);
  renderPremium();
  renderDashboard({ state, elements, filter: activeFilter, query: elements.search.value, alternativeResults });
  document.dispatchEvent(new CustomEvent('feeveto:currency-change'));
}

function renderPremium() { billingController?.render(); }

function announce(message) {
  elements.announcer.textContent = '';
  window.setTimeout(() => { elements.announcer.textContent = message; }, 20);
}

function showToast(message, actionLabel = '', action = null) {
  window.clearTimeout(toastTimer);
  elements.toastMessage.textContent = message;
  elements.toastAction.hidden = !action;
  elements.toastAction.textContent = actionLabel;
  elements.toastAction.onclick = action;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, action ? 7000 : 4200);
}

const errorFields = {
  name: ['name', 'name-error'], price: ['price', 'price-error'], cancellationUrl: ['cancellationUrl', 'url-error'],
  productType: ['productType', 'product-type-error'], country: ['country', 'country-error'], storageRequiredGb: ['storageRequiredGb', 'storage-error'],
  requiredServerCountry: ['requiredServerCountry', 'server-country-error'],
};

function clearErrors() {
  for (const [field, error] of Object.values(errorFields)) {
    byId(error).textContent = '';
    elements.form.elements[field].removeAttribute('aria-invalid');
  }
}

function showErrors(errors) {
  clearErrors();
  let first;
  for (const [name, message] of Object.entries(errors)) {
    const mapping = errorFields[name];
    if (!mapping) continue;
    const [field, error] = mapping;
    byId(error).textContent = message;
    elements.form.elements[field].setAttribute('aria-invalid', 'true');
    first ||= elements.form.elements[field];
  }
  openDisclosures(first);
  first?.focus();
}

function adaptiveErrors(formData) {
  const errors = {};
  const serviceId = String(formData.get('serviceId') || '');
  const productType = String(formData.get('productType') || '');
  const country = String(formData.get('country') || '').trim();
  const storage = String(formData.get('storageRequiredGb') || '').trim();
  const requiredServerCountry = String(formData.get('requiredServerCountry') || '').trim();
  if (serviceId && !productType) errors.productType = 'Choose the product type for this supported service.';
  if (productType && country && !/^[A-Za-z]{2}$/.test(country)) errors.country = 'Use a two-letter country code, such as US.';
  if (productType === 'cloud_storage' && storage && (!Number.isFinite(Number(storage)) || Number(storage) < 0 || Number(storage) > 100_000)) errors.storageRequiredGb = 'Enter storage from 0 to 100,000 GB.';
  if (productType === 'vpn' && requiredServerCountry && !/^[A-Za-z]{2}$/.test(requiredServerCountry)) errors.requiredServerCountry = 'Use a two-letter country code, such as US.';
  return errors;
}

function setRadio(name, value) {
  for (const input of elements.form.querySelectorAll(`[name="${name}"]`)) input.checked = input.value === (typeof value === 'boolean' ? String(value) : '');
}

function fillAlternativeSelectors() {
  const serviceSelect = elements.form.elements.serviceId;
  const productTypeSelect = elements.form.elements.productType;
  serviceSelect.replaceChildren(new Option('Custom or unsupported service', ''));
  for (const service of SUPPORTED_SERVICES) serviceSelect.append(new Option(service.name, service.id));
  productTypeSelect.replaceChildren(new Option('Unanswered', ''));
  for (const [id, label] of PRODUCT_TYPES) productTypeSelect.append(new Option(label, id));
}

function captureRequirementDraft() {
  if (!renderedRequirementServiceId) return;
  const draft = { mustHaveRequirements: [], niceToHaveRequirements: [], notNeededRequirements: [] };
  for (const select of elements.requirementQuestions.querySelectorAll('select[data-requirement-id]')) {
    if (select.value === 'must') draft.mustHaveRequirements.push(select.dataset.requirementId);
    if (select.value === 'nice') draft.niceToHaveRequirements.push(select.dataset.requirementId);
    if (select.value === 'not_needed') draft.notNeededRequirements.push(select.dataset.requirementId);
  }
  requirementDrafts.set(renderedRequirementServiceId, draft);
}

function renderRequirementQuestions(service, initialReview = null) {
  const serviceId = service?.id || '';
  renderedRequirementServiceId = serviceId;
  elements.requirementQuestions.replaceChildren();
  if (!service) return;
  const saved = initialReview || requirementDrafts.get(serviceId) || {};
  const mustHave = new Set(saved.mustHaveRequirements || []);
  const niceToHave = new Set(saved.niceToHaveRequirements || []);
  const notNeeded = new Set(saved.notNeededRequirements || []);
  // Migrate the older duplicate advertisement answer into the one visible priority.
  if (!mustHave.has('ad_free') && !niceToHave.has('ad_free') && !notNeeded.has('ad_free')) {
    if (saved.acceptAds === false) mustHave.add('ad_free');
    if (saved.acceptAds === true || saved.categoryAnswers?.adSupportedPlan === true) notNeeded.add('ad_free');
  }
  for (const [id, legacy] of [['team_collaboration', 'collaborationRequired'], ['specific_exclusives', 'exclusiveContent']]) {
    if (!mustHave.has(id) && !niceToHave.has(id) && !notNeeded.has(id)) {
      if (saved.categoryAnswers?.[legacy] === true) mustHave.add(id);
      if (saved.categoryAnswers?.[legacy] === false) notNeeded.add(id);
    }
  }
  const heading = document.createElement('h4');
  heading.textContent = `${service.name} requirements`;
  const help = document.createElement('p');
  help.className = 'field-help';
  help.textContent = 'Optional: choose what matters to you. Leave anything you are unsure about unanswered.';
  elements.requirementQuestions.append(heading, help);
  for (const [id, label] of service.requirements) {
    const row = document.createElement('label');
    row.className = 'requirement-row';
    const labelText = document.createElement('span');
    labelText.textContent = label;
    const select = document.createElement('select');
    select.name = `requirement_${id}`;
    select.dataset.requirementId = id;
    select.setAttribute('aria-label', `${label} priority`);
    select.append(new Option('Unanswered', ''), new Option('Must have', 'must'), new Option('Nice to have', 'nice'), new Option('Not needed', 'not_needed'));
    select.value = mustHave.has(id) ? 'must' : niceToHave.has(id) ? 'nice' : notNeeded.has(id) ? 'not_needed' : '';
    row.append(labelText, select);
    elements.requirementQuestions.append(row);
  }
}

function setApplicable(node, applicable) {
  node.hidden = !applicable;
  for (const control of node.querySelectorAll('input, select, textarea')) control.disabled = !applicable;
}

function updateCategoryQuestions() {
  const category = elements.form.elements.category.value;
  for (const section of byId('category-questions').querySelectorAll('[data-category]')) setApplicable(section, section.dataset.category === category);
  for (const [id, name] of [['team_collaboration', 'collaborationRequired'], ['specific_exclusives', 'exclusiveContent']]) {
    const group = elements.form.querySelector(`[name="${name}"]`)?.closest('fieldset');
    if (group) setApplicable(group, !group.closest('section').hidden && !elements.form.elements[`requirement_${id}`]);
  }
}

function renderRequirementsForSelection(initialReview = null) {
  const service = serviceById(elements.form.elements.serviceId.value);
  const productType = elements.form.elements.productType.value;
  const applicableService = matchingProfileFor(service?.id, productType);
  renderRequirementQuestions(applicableService, initialReview);
  if (!service) elements.serviceSupport.textContent = productType ? 'We will use your chosen product type to look for alternatives. Your service name stays as entered.' : 'Unknown services still work in the basic audit. Choose a product type to look for relevant alternatives.';
  else if (!applicableService) elements.serviceSupport.textContent = `${service.name} is recognized, but the selected product type differs. Catalogue matching will remain unconfirmed until corrected.`;
  else elements.serviceSupport.textContent = `${service.name} is recognized. You can correct the service or product type before saving.`;
}

function updateAdaptiveVisibility() {
  const service = serviceById(elements.form.elements.serviceId.value);
  const productType = elements.form.elements.productType.value;
  const supportedUseCase = Boolean(service || productType);
  setApplicable(byId('alternative-country-field'), supportedUseCase);
  setApplicable(byId('alternative-platform-field'), supportedUseCase);
  setApplicable(byId('free-limits-field'), supportedUseCase);
  setApplicable(byId('free-alternatives-field'), supportedUseCase);
  const hasAdPriority = Boolean(elements.form.elements.requirement_ad_free);
  setApplicable(byId('advertisement-field'), !hasAdPriority && ['streaming_video', 'ai_assistant', 'photo_editor', 'music_streaming', 'home_workouts'].includes(productType));
  setApplicable(byId('storage-requirement'), productType === 'cloud_storage');
  setApplicable(byId('required-title-field'), ['streaming_video', 'audiobooks'].includes(productType));
  setApplicable(byId('required-game-field'), productType === 'game_catalogue');
  setApplicable(byId('server-country-field'), productType === 'vpn');
  setApplicable(byId('target-language-field'), productType === 'language_learning');
  setApplicable(byId('learner-level-field'), productType === 'language_learning');
  setApplicable(byId('specific-subject-field'), productType === 'online_courses');
  updateCategoryQuestions();
}

function resetForm() {
  elements.form.reset();
  elements.form.elements.subscriptionId.value = '';
  elements.form.elements.currency.value = state.auditCurrency;
  elements.form.elements.cycle.value = 'monthly';
  elements.form.elements.usage.value = 'several_per_month';
  elements.form.elements.importance.value = 'useful';
  elements.form.elements.status.value = 'active';
  elements.form.elements.serviceId.value = '';
  elements.form.elements.productType.value = '';
  elements.priceCurrency.textContent = state.auditCurrency;
  elements.formTitle.textContent = 'Add a subscription';
  elements.submitButton.textContent = 'Save and review';
  elements.cancelEdit.hidden = true;
  elements.editBadge.hidden = true;
  autoServiceSelection = true;
  categoryManuallyChanged = false;
  entryCurrencyExplicitlyChanged = false;
  renderedRequirementServiceId = '';
  requirementDrafts.clear();
  renderRequirementsForSelection();
  updateAdaptiveVisibility();
  clearErrors();
  for (const detail of elements.form.querySelectorAll('details')) detail.open = false;
  byId('show-entry').textContent = 'Add subscription +';
}

function populateReview(review) {
  if (!review) return;
  for (const name of ['satisfaction', 'switchingDifficulty', 'country', 'platform', 'neededFeatures', 'storageRequiredGb', 'requiredTitle', 'requiredGame', 'requiredServerCountry', 'targetLanguage', 'learnerLevel', 'specificSubject']) {
    const control = elements.form.elements[name];
    if (control) control.value = review[name] ?? '';
  }
  for (const name of ['householdUse', 'overlap', 'considerCheaper', 'considerFree', 'acceptAds', 'acceptFreeLimits', 'seasonal', 'activeContract']) setRadio(name, review[name]);
  if (review.acceptAds === null && review.categoryAnswers?.adSupportedPlan === true) setRadio('acceptAds', true);
  for (const [name, value] of Object.entries(review.categoryAnswers || {})) {
    const controls = elements.form.querySelectorAll(`[name="${name}"]`);
    if (!controls.length) continue;
    if (controls[0].type === 'radio') setRadio(name, value);
    else controls[0].value = value ?? '';
  }
}

function beginEdit(id) {
  const item = state.subscriptions.find((entry) => entry.id === id);
  if (!item) return;
  resetForm();
  const review = item.detailedReview;
  const detectedService = supportedServiceFor(item);
  for (const [name, value] of Object.entries({
    subscriptionId: item.id, name: item.name, price: fromMinorUnits(item.amountMinor).toFixed(2), currency: item.currency,
    cycle: item.cycle, category: item.category, usage: item.usage, importance: item.importance, renewalDate: item.renewalDate,
    status: item.status, cancellationUrl: item.cancellationUrl, serviceId: detectedService?.id || '', productType: review?.productType || detectedService?.productType || '',
  })) elements.form.elements[name].value = value;
  elements.priceCurrency.textContent = item.currency;
  autoServiceSelection = false;
  categoryManuallyChanged = true;
  const profile = matchingProfileFor(detectedService?.id, review?.productType || detectedService?.productType);
  if (profile && review) requirementDrafts.set(profile.id, review);
  renderRequirementsForSelection(review);
  populateReview(review);
  updateAdaptiveVisibility();
  elements.formTitle.textContent = `Edit ${item.name}`;
  elements.cancelEdit.hidden = false;
  elements.editBadge.hidden = false;
  byId('show-entry').textContent = 'Continue editing';
  if (review) { byId('needs-disclosure').open = true; byId('switching-disclosure').open = true; }
  if (item.renewalDate || item.cancellationUrl || typeof review?.activeContract === 'boolean') byId('billing-details').open = true;
  revealContent('subscription-editor');
  byId('subscription-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  elements.form.elements.name.focus({ preventScroll: true });
}

function applyRecognizedService(service, updateCategory = true) {
  captureRequirementDraft();
  elements.form.elements.serviceId.value = service?.id || '';
  if (service) {
    elements.form.elements.productType.value = service.productType;
    if (updateCategory) elements.form.elements.category.value = categoryForProductType(service.productType) || elements.form.elements.category.value;
  }
  renderRequirementsForSelection();
  updateAdaptiveVisibility();
}

function focusResult(id) {
  revealContent('results');
  const card = elements.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card?.focus({ preventScroll: true });
}

function deleteSubscription(id) {
  const index = state.subscriptions.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = state.subscriptions.splice(index, 1);
  invalidateAlternativeRequest(id);
  persist(); render(); announce(`${removed.name} deleted.`);
  showToast(`${removed.name} deleted.`, 'Undo', () => { state.subscriptions.splice(index, 0, removed); persist(); render(); elements.toast.hidden = true; announce(`${removed.name} restored.`); });
}

async function refreshAlternatives(item, focus = false) {
  if (alternativeResults.get(item.id)?.status === 'loading') return;
  const request = alternativeRequests.begin(item.id);
  const isCurrent = () => alternativeRequests.isCurrent(item.id, request);
  const previousScope = alternativeResults.get(item.id)?.accessScope || 'public';
  alternativeResults.set(item.id, { status: 'loading', state: 'request_pending', accessScope: previousScope, items: [], message: '', missingDetails: [] });
  render();
  if (focus) focusResult(item.id);
  try {
    const clerk = await clerkPromise;
    const token = await clerk?.session?.getToken?.() || '';
    const result = await alternativesProvider.getAlternatives(item, token, state.auditCurrency);
    if (!isCurrent() || !state.subscriptions.some((entry) => entry.id === item.id && entry.updatedAt === item.updatedAt)) return;
    if (result.accessScope === 'public') {
      for (const [resultId, cached] of alternativeResults) {
        if (cached.accessScope === 'complete' && resultId !== item.id) invalidateAlternativeRequest(resultId);
      }
    }
    alternativeResults.set(item.id, { status: 'ready', ...result });
  } catch (error) {
    if (!isCurrent()) return;
    if (error instanceof AlternativeRequestError && error.resultState === 'authentication_failed') invalidateAllAlternativeRequests();
    alternativeResults.set(item.id, {
      status: 'error', state: error instanceof AlternativeRequestError ? error.resultState : 'request_failed',
      accessScope: 'public', items: [], missingDetails: [],
      message: error instanceof AlternativeRequestError ? error.message : 'Alternatives could not be loaded. Your subscription is saved. Please retry.',
    });
  }
  const resultHadFocus = document.activeElement === elements.list.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  render();
  if (resultHadFocus) elements.list.querySelector(`[data-id="${CSS.escape(item.id)}"]`)?.focus({ preventScroll: true });
  announce('Alternatives updated. Your subscription is saved.');
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (elements.submitButton.disabled) return;
  const formData = new FormData(elements.form);
  const validation = validateSubscriptionInput(formData);
  const errors = { ...validation.errors, ...adaptiveErrors(formData) };
  if (Object.keys(errors).length) return showErrors(errors);
  const editingId = String(formData.get('subscriptionId') || '');
  const previous = state.subscriptions.find((entry) => entry.id === editingId);
  const now = new Date().toISOString();
  const item = normalizeSubscription({
    id: editingId || createId(), name: validation.values.name, amountMinor: validation.values.amountMinor, currency: formData.get('currency'),
    cycle: formData.get('cycle'), category: formData.get('category'), usage: formData.get('usage'), importance: formData.get('importance'),
    renewalDate: formData.get('renewalDate'), status: formData.get('status'), cancellationUrl: validation.values.cancellationUrl,
    detailedReview: buildDetailedReview(formData, now), createdAt: previous?.createdAt || now, updatedAt: now,
  });
  if (!item) return showToast('Check the subscription details and try again.');
  state.subscriptions = upsertSubscription(state.subscriptions, item);
  invalidateAlternativeRequest(item.id);
  activeFilter = 'all';
  elements.search.value = '';
  for (const tab of document.querySelectorAll('.filter-tab')) {
    tab.classList.toggle('active', tab.dataset.filter === 'all');
    tab.setAttribute('aria-pressed', String(tab.dataset.filter === 'all'));
  }
  persist(); resetForm(); render();
  byId('subscription-editor').open = false;
  showToast(`${item.name} ${editingId ? 'updated' : 'saved'} in this browser. Checking account save…`);
  announce(`${item.name} ${editingId ? 'updated' : 'saved'} in this browser and reviewed.`);
  void refreshAlternatives(item, true);
  elements.submitButton.disabled = true;
  try { await journey.saveSubscription(item); }
  finally { elements.submitButton.disabled = false; }
});

elements.form.elements.name.addEventListener('input', () => {
  if (!autoServiceSelection) return;
  const service = detectSupportedService(elements.form.elements.name.value);
  if ((service?.id || '') === elements.form.elements.serviceId.value) return;
  if (!service) elements.form.elements.productType.value = '';
  applyRecognizedService(service, !categoryManuallyChanged);
});

elements.form.elements.serviceId.addEventListener('change', () => {
  autoServiceSelection = false;
  applyRecognizedService(serviceById(elements.form.elements.serviceId.value), true);
  categoryManuallyChanged = false;
});

elements.form.elements.productType.addEventListener('change', () => {
  captureRequirementDraft();
  const service = serviceById(elements.form.elements.serviceId.value);
  if (service && service.productType !== elements.form.elements.productType.value) {
    elements.form.elements.serviceId.value = '';
    autoServiceSelection = false;
  }
  if (!categoryManuallyChanged) {
    const category = categoryForProductType(elements.form.elements.productType.value);
    if (category) elements.form.elements.category.value = category;
  }
  renderRequirementsForSelection();
  updateAdaptiveVisibility();
});

elements.form.elements.category.addEventListener('change', () => { categoryManuallyChanged = true; updateCategoryQuestions(); });
elements.form.elements.currency.addEventListener('change', () => {
  entryCurrencyExplicitlyChanged = true;
  elements.priceCurrency.textContent = elements.form.elements.currency.value;
});

elements.list.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'edit') beginEdit(target.dataset.id);
  if (target.dataset.action === 'improve') beginEdit(target.dataset.id);
  if (target.dataset.action === 'personalize') {
    const item=state.subscriptions.find(entry=>entry.id===target.dataset.id);
    if(item){journey?.setDraft(journeyFromSubscription(item,state.auditCurrency));journey?.openGuide();}
  }
  if (target.dataset.action === 'alternatives') {
    const item = state.subscriptions.find((entry) => entry.id === target.dataset.id);
    if (item) void refreshAlternatives(item, true);
  }
  if (target.dataset.action === 'delete') deleteSubscription(target.dataset.id);
});

for (const tab of document.querySelectorAll('.filter-tab')) tab.addEventListener('click', () => {
  activeFilter = tab.dataset.filter;
  for (const item of document.querySelectorAll('.filter-tab')) {
    item.classList.toggle('active', item === tab);
    item.setAttribute('aria-pressed', String(item === tab));
  }
  render();
});

elements.search.addEventListener('input', render);
elements.currencyPreference.addEventListener('change', () => {
  state.auditCurrency = validCurrencyPreference(elements.currencyPreference.value);
  const updatedEntryDefault = shouldApplyCurrencyDefault({
    editingId: elements.form.elements.subscriptionId.value,
    priceValue: elements.form.elements.price.value,
    entryCurrencyExplicitlyChanged,
  });
  if (updatedEntryDefault) {
    elements.form.elements.currency.value = state.auditCurrency;
    elements.priceCurrency.textContent = state.auditCurrency;
  }
  persist();
  invalidateAllAlternativeRequests();
  render();
  for (const item of state.subscriptions) {
    if (recommendationRequestFor(item, state.auditCurrency)) void refreshAlternatives(item);
  }
  const formNote = updatedEntryDefault ? 'The next new entry defaults to it.' : 'The currency on the current form was left unchanged.';
  showToast(`Examples and ${state.auditCurrency} dashboard totals updated. Alternatives are updating for that market. ${formNote} Existing prices were not converted.`);
});

elements.cancelEdit.addEventListener('click', () => { resetForm(); byId('subscription-editor').open = false; byId('show-entry').focus(); });
elements.clearAll.addEventListener('click', () => elements.clearDialog.showModal());
elements.confirmClear.addEventListener('click', () => {
  const previous = [...state.subscriptions];
  state.subscriptions = [];
  invalidateAllAlternativeRequests();
  persist(); resetForm(); render();
  showToast('Audit cleared.', 'Undo', () => { state.subscriptions = previous; persist(); render(); elements.toast.hidden = true; announce('Audit restored.'); });
});

elements.exportData.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `feeveto-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); showToast('Backup exported.');
});
elements.importData.addEventListener('click', () => elements.importFile.click());
elements.importFile.addEventListener('change', async () => {
  const [file] = elements.importFile.files;
  elements.importFile.value = '';
  if (!file) return;
  try {
    const imported = parseImportedState(await file.text());
    if (!window.confirm(`Replace this audit with ${imported.subscriptions.length} subscriptions from the selected backup?`)) return;
    state = imported;
    invalidateAllAlternativeRequests();
    persist(); resetForm(); render(); showToast('Backup imported.'); announce('Backup imported successfully.');
  } catch (error) { showToast(error instanceof Error ? error.message : 'The backup could not be imported.'); }
});

fillCurrencyOptions(elements.currencyPreference, state.auditCurrency);
fillCurrencyOptions(elements.form.elements.currency, state.auditCurrency);
fillAlternativeSelectors();
for (const tab of document.querySelectorAll('.filter-tab')) tab.setAttribute('aria-pressed', String(tab.dataset.filter === 'all'));
// Every optional yes/no group can be cleared again without resetting the form.
for (const fieldset of elements.form.querySelectorAll('fieldset')) {
  const radio = fieldset.querySelector('input[type="radio"]');
  if (!radio) continue;
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio'; input.name = radio.name; input.value = ''; input.defaultChecked = true;
  label.append(input, document.createTextNode('Unanswered'));
  fieldset.append(label);
}
resetForm();
render();
let accessSignature = '';
const clerkPromise = initializeAuth({
  onAccessChange(access) {
    currentAccess = access;
    renderPremium();
    const nextSignature = JSON.stringify({ authenticated: access.authenticated, premiumAccess: access.premiumAccess });
    if (accessSignature && accessSignature !== nextSignature) {
      invalidateAllAlternativeRequests();
      render();
      announce('Account access changed. Curated results were cleared and can be refreshed.');
    }
    accessSignature = nextSignature;
    document.dispatchEvent(new CustomEvent('feeveto:access-change', {detail:access}));
  },
});

billingController = initializeBilling({
  getClerk: () => clerkPromise, getAccess: () => currentAccess, notify: showToast,
  onVerifiedAccess(access) {
    currentAccess = access;
    invalidateAllAlternativeRequests(); render();
    document.dispatchEvent(new CustomEvent('feeveto:access-change', { detail: access }));
  },
});

const journey = initializeJourney({ getClerk: () => clerkPromise, getCurrency: () => state.auditCurrency, storage: browserStorage });
initializeAdmin({ getClerk: () => clerkPromise, getAccess: () => currentAccess });
if (loaded.migrated) showToast('Your earlier subscription entries were migrated to FeeVeto.');
if (loaded.recovered) showToast('Saved data could not be read, so FeeVeto opened an empty audit.');
if (!loaded.storageAvailable) showToast('Browser storage is unavailable. Changes may not remain after this tab closes.');
byId('storage-warning').hidden = loaded.storageAvailable;

window.addEventListener('storage', (event) => {
  if (event.key !== APP_CONFIG.storageKey) return;
  const nextCurrency = loadState(browserStorage).state.auditCurrency;
  if (nextCurrency === state.auditCurrency) return;
  state.auditCurrency = nextCurrency;
  if (shouldApplyCurrencyDefault({
    editingId: elements.form.elements.subscriptionId.value,
    priceValue: elements.form.elements.price.value,
    entryCurrencyExplicitlyChanged,
  })) {
    elements.form.elements.currency.value = nextCurrency;
    elements.priceCurrency.textContent = nextCurrency;
  }
  invalidateAllAlternativeRequests();
  render();
  for (const item of state.subscriptions) {
    if (recommendationRequestFor(item, state.auditCurrency)) void refreshAlternatives(item);
  }
  announce(`Display currency changed to ${nextCurrency}. Alternatives are updating for that market; existing billing currencies were not changed.`);
});
