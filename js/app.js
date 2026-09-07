import { APP_CONFIG } from './config.js';
import { fromMinorUnits } from './calculations.js';
import { fillCurrencyOptions, renderIllustrativeMoney, shouldApplyCurrencyDefault, validCurrencyPreference } from './currencyPreference.js';
import { AlternativeRequestError, AlternativeRequestTracker, BackendAlternativesProvider } from './alternativeProvider.js';
import { buildDetailedReview, categoryForProductType, upsertSubscription } from './formModel.js';
import { renderDashboard } from './render.js';
import { detectSupportedService, PRODUCT_TYPES, serviceById, SUPPORTED_SERVICES } from './serviceCatalog.js';
import { loadState, normalizeSubscription, parseImportedState, saveState } from './storage.js';
import { createId, validateSubscriptionInput } from './validation.js';
import { initializeAuth } from './auth.js';

document.title = `${APP_CONFIG.brandName} — ${APP_CONFIG.slogan}`;
document.querySelector('meta[name="description"]')?.setAttribute('content', APP_CONFIG.description);

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
  if (!saveState(browserStorage, state)) showToast('Your changes work for now, but this browser could not save them.');
}

function render() {
  elements.currencyPreference.value = state.auditCurrency;
  renderIllustrativeMoney(document, state.auditCurrency);
  renderDashboard({ state, elements, filter: activeFilter, query: elements.search.value, alternativeResults });
}

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
  if (serviceId && country && !/^[A-Za-z]{2}$/.test(country)) errors.country = 'Use a two-letter country code, such as CH.';
  if (productType === 'cloud_storage' && storage && (!Number.isFinite(Number(storage)) || Number(storage) < 0 || Number(storage) > 100_000)) errors.storageRequiredGb = 'Enter storage from 0 to 100,000 GB.';
  if (productType === 'vpn' && requiredServerCountry && !/^[A-Za-z]{2}$/.test(requiredServerCountry)) errors.requiredServerCountry = 'Use a two-letter country code, such as US.';
  return errors;
}

function setRadio(name, value) {
  for (const input of elements.form.querySelectorAll(`[name="${name}"]`)) input.checked = typeof value === 'boolean' && input.value === String(value);
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

function renderRequirementQuestions(serviceId, initialReview = null) {
  renderedRequirementServiceId = serviceId;
  elements.requirementQuestions.replaceChildren();
  const service = serviceById(serviceId);
  if (!service) return;
  const saved = initialReview || requirementDrafts.get(serviceId) || {};
  const mustHave = new Set(saved.mustHaveRequirements || []);
  const niceToHave = new Set(saved.niceToHaveRequirements || []);
  const notNeeded = new Set(saved.notNeededRequirements || []);
  const heading = document.createElement('h4');
  heading.textContent = `${service.name} requirements`;
  const help = document.createElement('p');
  help.className = 'field-help';
  help.textContent = 'Leave a requirement unanswered if you are unsure; FeeVeto will not call it a confirmed fit.';
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
}

function renderRequirementsForSelection(initialReview = null) {
  const service = serviceById(elements.form.elements.serviceId.value);
  const productType = elements.form.elements.productType.value;
  const applicableService = service?.productType === productType ? service : null;
  renderRequirementQuestions(applicableService?.id || '', initialReview);
  if (!service) elements.serviceSupport.textContent = 'Unknown services still work in the basic audit. Select a supported service only when it is the subscription you use.';
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
  setApplicable(byId('advertisement-field'), ['streaming_video', 'ai_assistant', 'photo_editor', 'music_streaming', 'home_workouts'].includes(productType));
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
  const detectedService = serviceById(review?.serviceId) || detectSupportedService(item.name);
  for (const [name, value] of Object.entries({
    subscriptionId: item.id, name: item.name, price: fromMinorUnits(item.amountMinor).toFixed(2), currency: item.currency,
    cycle: item.cycle, category: item.category, usage: item.usage, importance: item.importance, renewalDate: item.renewalDate,
    status: item.status, cancellationUrl: item.cancellationUrl, serviceId: detectedService?.id || '', productType: review?.productType || detectedService?.productType || '',
  })) elements.form.elements[name].value = value;
  elements.priceCurrency.textContent = item.currency;
  autoServiceSelection = false;
  categoryManuallyChanged = true;
  if (detectedService && review) requirementDrafts.set(detectedService.id, review);
  renderRequirementsForSelection(review);
  populateReview(review);
  updateAdaptiveVisibility();
  elements.formTitle.textContent = `Edit ${item.name}`;
  elements.cancelEdit.hidden = false;
  elements.editBadge.hidden = false;
  byId('audit').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const request = alternativeRequests.begin(item.id);
  const isCurrent = () => alternativeRequests.isCurrent(item.id, request);
  alternativeResults.set(item.id, { status: 'loading', state: 'request_pending', accessScope: 'public', items: [], message: '', missingDetails: [] });
  render();
  if (focus) focusResult(item.id);
  try {
    const clerk = await clerkPromise;
    const token = await clerk?.session?.getToken?.() || '';
    const result = await alternativesProvider.getAlternatives(item, token);
    if (!isCurrent() || !state.subscriptions.some((entry) => entry.id === item.id && entry.updatedAt === item.updatedAt)) return;
    if (result.accessScope === 'public') {
      for (const [resultId, cached] of alternativeResults) {
        if (cached.accessScope === 'complete') alternativeResults.delete(resultId);
      }
    }
    alternativeResults.set(item.id, { status: 'ready', ...result });
  } catch (error) {
    if (!isCurrent()) return;
    alternativeResults.set(item.id, {
      status: 'error', state: error instanceof AlternativeRequestError ? error.resultState : 'request_failed',
      accessScope: 'public', items: [], missingDetails: [],
      message: error instanceof Error ? error.message : 'Alternatives could not be loaded. Try again.',
    });
  }
  render();
  if (focus) focusResult(item.id);
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
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
  persist(); resetForm(); render();
  showToast(`${item.name} ${editingId ? 'updated' : 'saved'}.`);
  announce(`${item.name} ${editingId ? 'updated' : 'saved'} and reviewed.`);
  void refreshAlternatives(item, true);
});

elements.form.elements.name.addEventListener('input', () => {
  if (!autoServiceSelection) return;
  const service = detectSupportedService(elements.form.elements.name.value);
  if ((service?.id || '') === elements.form.elements.serviceId.value) return;
  applyRecognizedService(service, !categoryManuallyChanged);
});

elements.form.elements.serviceId.addEventListener('change', () => {
  autoServiceSelection = false;
  applyRecognizedService(serviceById(elements.form.elements.serviceId.value), true);
  categoryManuallyChanged = false;
});

elements.form.elements.productType.addEventListener('change', () => {
  captureRequirementDraft();
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
  if (target.dataset.action === 'alternatives') {
    const item = state.subscriptions.find((entry) => entry.id === target.dataset.id);
    if (item) void refreshAlternatives(item, true);
  }
  if (target.dataset.action === 'delete') deleteSubscription(target.dataset.id);
});

for (const tab of document.querySelectorAll('.filter-tab')) tab.addEventListener('click', () => {
  activeFilter = tab.dataset.filter;
  for (const item of document.querySelectorAll('.filter-tab')) item.classList.toggle('active', item === tab);
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
  persist(); render();
  const formNote = updatedEntryDefault ? 'The next new entry defaults to it.' : 'The currency on the current form was left unchanged.';
  showToast(`Examples and ${state.auditCurrency} dashboard totals updated. ${formNote} Existing prices were not converted.`);
});
elements.cancelEdit.addEventListener('click', () => { resetForm(); elements.form.elements.name.focus(); });
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
resetForm();
render();
let accessSignature = '';
const clerkPromise = initializeAuth({
  onAccessChange(access) {
    const nextSignature = JSON.stringify({ authenticated: access.authenticated, premiumAccess: access.premiumAccess });
    if (accessSignature && accessSignature !== nextSignature) {
      invalidateAllAlternativeRequests();
      render();
      announce('Account access changed. Curated results were cleared and can be refreshed.');
    }
    accessSignature = nextSignature;
  },
});
if (loaded.migrated) showToast('Your earlier subscription entries were migrated to FeeVeto.');
if (loaded.recovered) showToast('Saved data could not be read, so FeeVeto opened an empty audit.');
if (!loaded.storageAvailable) showToast('Browser storage is unavailable. Changes may not remain after this tab closes.');

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
  render();
  announce(`Display currency changed to ${nextCurrency}. Existing billing currencies were not changed.`);
});
