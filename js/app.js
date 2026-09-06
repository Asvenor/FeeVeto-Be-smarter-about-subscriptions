import { APP_CONFIG } from './config.js';
import { fromMinorUnits } from './calculations.js';
import { BackendAlternativesProvider } from './alternativeProvider.js';
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
  auditCurrency: byId('audit-currency'), priceCurrency: byId('price-currency'), list: byId('subscription-list'), listSummary: byId('list-summary'),
  totalMonthly: byId('total-monthly'), totalAnnual: byId('total-annual'), potentialSavings: byId('potential-savings'), subscriptionCount: byId('subscription-count'),
  actionCount: byId('action-count'), currencySummary: byId('currency-summary'), search: byId('result-search'), clearAll: byId('clear-all'), clearDialog: byId('clear-dialog'),
  confirmClear: byId('confirm-clear'), exportData: byId('export-data'), importData: byId('import-data'), importFile: byId('import-file'), detailDialog: byId('detail-dialog'),
  detailForm: byId('detail-form'), detailTitle: byId('detail-title'), toast: byId('toast'), toastMessage: byId('toast-message'), toastAction: byId('toast-action'), announcer: byId('announcer'),
  requirementQuestions: byId('requirement-questions'), serviceSupport: byId('service-support'),
};

const browserStorage = (() => {
  try { return window.localStorage; } catch { return { getItem() { return null; }, setItem() { throw new Error('Storage unavailable'); } }; }
})();
const loaded = loadState(browserStorage);
let state = loaded.state;
let activeFilter = 'all';
let toastTimer;
const alternativesProvider = new BackendAlternativesProvider();
const alternativeResults = new Map();

function persist() {
  if (!saveState(browserStorage, state)) showToast('Your changes work for now, but this browser could not save them.');
}

function render() {
  elements.auditCurrency.value = state.auditCurrency;
  elements.priceCurrency.textContent = state.auditCurrency;
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

function clearErrors() {
  for (const [field, node] of [['name', byId('name-error')], ['price', byId('price-error')], ['cancellationUrl', byId('url-error')]]) {
    node.textContent = '';
    elements.form.elements[field].removeAttribute('aria-invalid');
  }
}

function showErrors(errors) {
  clearErrors();
  const nodes = { name: byId('name-error'), price: byId('price-error'), cancellationUrl: byId('url-error') };
  let first;
  for (const [field, message] of Object.entries(errors)) {
    nodes[field].textContent = message;
    elements.form.elements[field].setAttribute('aria-invalid', 'true');
    first ||= elements.form.elements[field];
  }
  first?.focus();
}

function resetForm() {
  elements.form.reset();
  elements.form.elements.subscriptionId.value = '';
  elements.form.elements.cycle.value = 'monthly';
  elements.form.elements.usage.value = 'several_per_month';
  elements.form.elements.importance.value = 'useful';
  elements.form.elements.status.value = 'active';
  elements.formTitle.textContent = 'Add a subscription';
  elements.submitButton.textContent = 'Add to my audit';
  elements.cancelEdit.hidden = true;
  elements.editBadge.hidden = true;
  clearErrors();
}

function beginEdit(id) {
  const item = state.subscriptions.find((entry) => entry.id === id);
  if (!item) return;
  for (const [name, value] of Object.entries({ subscriptionId: item.id, name: item.name, price: fromMinorUnits(item.amountMinor).toFixed(2), cycle: item.cycle, category: item.category, usage: item.usage, importance: item.importance, renewalDate: item.renewalDate, status: item.status, cancellationUrl: item.cancellationUrl })) elements.form.elements[name].value = value;
  state.auditCurrency = item.currency;
  elements.formTitle.textContent = `Edit ${item.name}`;
  elements.submitButton.textContent = 'Save changes';
  elements.cancelEdit.hidden = false;
  elements.editBadge.hidden = false;
  render();
  byId('audit').scrollIntoView({ behavior: 'smooth', block: 'start' });
  elements.form.elements.name.focus({ preventScroll: true });
}

function booleanValue(formData, name) {
  const value = formData.get(name);
  return value === 'true' ? true : value === 'false' ? false : null;
}

function categoryAnswers(form) {
  const names = ['exclusiveContent', 'rotateServices', 'adSupportedPlan', 'basicFeaturesOnly', 'collaborationRequired', 'proprietaryFormat', 'openSourceAcceptable', 'criticalBackup', 'includedElsewhere', 'payPerVisitCheaper', 'multiplayerRequired', 'includedGamesUsed', 'pausePractical'];
  const answers = Object.fromEntries(names.map((name) => [name, Boolean(form.elements[name]?.checked)]));
  answers.storageUsed = String(form.elements.storageUsed?.value || '').trim().slice(0, 40);
  const rawTimes = String(form.elements.timesPerMonth?.value || '').trim();
  const times = Number(rawTimes);
  answers.timesPerMonth = rawTimes && Number.isFinite(times) && times >= 0 ? times : null;
  return answers;
}

function setRadio(form, name, value) {
  for (const input of form.querySelectorAll(`[name="${name}"]`)) input.checked = value !== null && input.value === String(value);
}

function fillAlternativeSelectors() {
  const serviceSelect = elements.detailForm.elements.serviceId;
  const productTypeSelect = elements.detailForm.elements.productType;
  serviceSelect.replaceChildren(new Option('Choose or confirm a service', ''));
  for (const service of SUPPORTED_SERVICES) serviceSelect.append(new Option(service.name, service.id));
  productTypeSelect.replaceChildren(new Option('Choose a product type', ''));
  for (const [id, label] of PRODUCT_TYPES) productTypeSelect.append(new Option(label, id));
}

function renderRequirementQuestions(serviceId, review = null) {
  const service = serviceById(serviceId);
  byId('storage-requirement').hidden = serviceId !== 'dropbox';
  elements.requirementQuestions.replaceChildren();
  if (!service) {
    elements.serviceSupport.textContent = 'This service is not supported yet. Choose one of the six supported services only if it is the subscription you actually use.';
    return;
  }
  elements.serviceSupport.textContent = `${service.name} is supported. Mark only requirements the catalogue can verify.`;
  const mustHave = new Set(review?.mustHaveRequirements || []);
  const niceToHave = new Set(review?.niceToHaveRequirements || []);
  const heading = document.createElement('h3');
  heading.textContent = `${service.name} requirements`;
  elements.requirementQuestions.append(heading);
  for (const [id, label] of service.requirements) {
    const row = document.createElement('label');
    row.className = 'requirement-row';
    const text = document.createElement('span');
    text.textContent = label;
    const select = document.createElement('select');
    select.name = `requirement_${id}`;
    select.setAttribute('aria-label', `${label} priority`);
    select.append(new Option('Not needed', ''), new Option('Must have', 'must'), new Option('Nice to have', 'nice'));
    select.value = mustHave.has(id) ? 'must' : niceToHave.has(id) ? 'nice' : '';
    row.append(text, select);
    elements.requirementQuestions.append(row);
  }
}

function requirementChoices(formData, serviceId) {
  const service = serviceById(serviceId);
  const mustHaveRequirements = [];
  const niceToHaveRequirements = [];
  for (const [id] of service?.requirements || []) {
    const choice = formData.get(`requirement_${id}`);
    if (choice === 'must') mustHaveRequirements.push(id);
    if (choice === 'nice') niceToHaveRequirements.push(id);
  }
  return { mustHaveRequirements, niceToHaveRequirements };
}

function openDetailedReview(id) {
  const item = state.subscriptions.find((entry) => entry.id === id);
  if (!item) return;
  elements.detailForm.reset();
  elements.detailForm.elements.subscriptionId.value = id;
  elements.detailTitle.textContent = `Review ${item.name}`;
  const review = item.detailedReview;
  const detectedService = serviceById(review?.serviceId) || detectSupportedService(item.name);
  elements.detailForm.elements.serviceId.value = detectedService?.id || '';
  elements.detailForm.elements.productType.value = review?.productType || detectedService?.productType || '';
  elements.detailForm.elements.country.value = review?.country || '';
  elements.detailForm.elements.platform.value = review?.platform || '';
  elements.detailForm.elements.storageRequiredGb.value = review?.storageRequiredGb ?? '';
  renderRequirementQuestions(detectedService?.id || '', review);
  if (review) {
    elements.detailForm.elements.satisfaction.value = review.satisfaction;
    elements.detailForm.elements.switchingDifficulty.value = review.switchingDifficulty;
    elements.detailForm.elements.neededFeatures.value = review.neededFeatures;
    for (const name of ['householdUse', 'overlap', 'considerCheaper', 'considerFree', 'acceptAds', 'acceptFreeLimits', 'seasonal', 'activeContract']) setRadio(elements.detailForm, name, review[name]);
    for (const [name, value] of Object.entries(review.categoryAnswers || {})) {
      const control = elements.detailForm.elements[name];
      if (!control) continue;
      if (control.type === 'checkbox') control.checked = Boolean(value); else control.value = value ?? '';
    }
  }
  for (const section of byId('category-questions').querySelectorAll('[data-category]')) section.hidden = section.dataset.category !== item.category;
  elements.detailDialog.showModal();
}

function deleteSubscription(id) {
  const index = state.subscriptions.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = state.subscriptions.splice(index, 1);
  alternativeResults.delete(id);
  persist(); render(); announce(`${removed.name} deleted.`);
  showToast(`${removed.name} deleted.`, 'Undo', () => { state.subscriptions.splice(index, 0, removed); persist(); render(); elements.toast.hidden = true; announce(`${removed.name} restored.`); });
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(elements.form);
  const validation = validateSubscriptionInput(formData);
  if (!validation.valid) return showErrors(validation.errors);
  const editingId = String(formData.get('subscriptionId') || '');
  const previous = state.subscriptions.find((item) => item.id === editingId);
  const now = new Date().toISOString();
  const item = normalizeSubscription({
    id: editingId || createId(), name: validation.values.name, amountMinor: validation.values.amountMinor, currency: previous?.currency || state.auditCurrency,
    cycle: formData.get('cycle'), category: formData.get('category'), usage: formData.get('usage'), importance: formData.get('importance'),
    renewalDate: formData.get('renewalDate'), status: formData.get('status'), cancellationUrl: validation.values.cancellationUrl,
    detailedReview: previous?.detailedReview || null, createdAt: previous?.createdAt || now, updatedAt: now,
  });
  if (!item) return showToast('Check the subscription details and try again.');
  if (editingId) state.subscriptions[state.subscriptions.findIndex((entry) => entry.id === editingId)] = item; else state.subscriptions.push(item);
  persist(); resetForm(); render();
  showToast(`${item.name} ${editingId ? 'updated' : 'added'}.`);
  announce(editingId ? `${item.name} updated in the audit.` : `${item.name} added to the audit.`);
});

elements.detailForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(elements.detailForm);
  const item = state.subscriptions.find((entry) => entry.id === formData.get('subscriptionId'));
  if (!item) return elements.detailDialog.close();
  const serviceId = String(formData.get('serviceId') || '');
  const requirementPriorities = requirementChoices(formData, serviceId);
  const rawStorageRequired = String(formData.get('storageRequiredGb') || '').trim();
  const storageRequired = rawStorageRequired ? Number(rawStorageRequired) : Number.NaN;
  item.detailedReview = {
    satisfaction: String(formData.get('satisfaction') || ''), householdUse: booleanValue(formData, 'householdUse'), overlap: booleanValue(formData, 'overlap'),
    switchingDifficulty: String(formData.get('switchingDifficulty') || ''), considerCheaper: booleanValue(formData, 'considerCheaper'), considerFree: booleanValue(formData, 'considerFree'),
    acceptAds: booleanValue(formData, 'acceptAds'), acceptFreeLimits: booleanValue(formData, 'acceptFreeLimits'), seasonal: booleanValue(formData, 'seasonal'), activeContract: booleanValue(formData, 'activeContract'),
    serviceId, productType: String(formData.get('productType') || ''), country: String(formData.get('country') || '').trim().toUpperCase().slice(0, 2),
    platform: String(formData.get('platform') || ''), storageRequiredGb: Number.isFinite(storageRequired) && storageRequired >= 0 ? storageRequired : null,
    ...requirementPriorities,
    neededFeatures: String(formData.get('neededFeatures') || '').trim().slice(0, 240), categoryAnswers: categoryAnswers(elements.detailForm), completedAt: new Date().toISOString(),
  };
  item.updatedAt = new Date().toISOString();
  persist(); alternativeResults.delete(item.id); render(); elements.detailDialog.close(); showToast(`Detailed review saved for ${item.name}.`); announce(`Recommendation updated for ${item.name}.`);
  void refreshAlternatives(item);
});

elements.detailForm.elements.serviceId.addEventListener('change', () => {
  const service = serviceById(elements.detailForm.elements.serviceId.value);
  if (service) elements.detailForm.elements.productType.value = service.productType;
  renderRequirementQuestions(service?.id || '');
});

async function refreshAlternatives(item) {
  alternativeResults.set(item.id, { status: 'loading', accessScope: 'public', items: [], message: '' });
  render();
  try {
    const clerk = await clerkPromise;
    const token = await clerk?.session?.getToken?.() || '';
    const result = await alternativesProvider.getAlternatives(item, token);
    if (!state.subscriptions.some((entry) => entry.id === item.id)) return;
    alternativeResults.set(item.id, { status: 'ready', ...result });
  } catch (error) {
    alternativeResults.set(item.id, { status: 'error', accessScope: 'public', items: [], message: error instanceof Error ? error.message : 'Alternatives could not be loaded.' });
  }
  render();
}

elements.list.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'edit') beginEdit(target.dataset.id);
  if (target.dataset.action === 'detail') openDetailedReview(target.dataset.id);
  if (target.dataset.action === 'alternatives') {
    const item = state.subscriptions.find((entry) => entry.id === target.dataset.id);
    if (item) void refreshAlternatives(item);
  }
  if (target.dataset.action === 'delete') deleteSubscription(target.dataset.id);
});

for (const tab of document.querySelectorAll('.filter-tab')) tab.addEventListener('click', () => {
  activeFilter = tab.dataset.filter;
  for (const item of document.querySelectorAll('.filter-tab')) item.classList.toggle('active', item === tab);
  render();
});

elements.search.addEventListener('input', render);
for (const button of document.querySelectorAll('[data-close-detail]')) button.addEventListener('click', () => elements.detailDialog.close());
elements.auditCurrency.addEventListener('change', () => { state.auditCurrency = elements.auditCurrency.value; persist(); render(); showToast(`New entries will use ${state.auditCurrency}. Existing prices were not converted.`); });
elements.cancelEdit.addEventListener('click', resetForm);
elements.clearAll.addEventListener('click', () => elements.clearDialog.showModal());
elements.confirmClear.addEventListener('click', () => {
  const previous = [...state.subscriptions]; state.subscriptions = []; persist(); resetForm(); render();
  showToast('Audit cleared.', 'Undo', () => { state.subscriptions = previous; persist(); render(); elements.toast.hidden = true; });
});

elements.exportData.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `feeveto-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); showToast('Backup exported.');
});
elements.importData.addEventListener('click', () => elements.importFile.click());
elements.importFile.addEventListener('change', async () => {
  const [file] = elements.importFile.files; elements.importFile.value = '';
  if (!file) return;
  try {
    const imported = parseImportedState(await file.text());
    if (!window.confirm(`Replace this audit with ${imported.subscriptions.length} subscriptions from the selected backup?`)) return;
    state = imported; persist(); resetForm(); render(); showToast('Backup imported.'); announce('Backup imported successfully.');
  } catch (error) { showToast(error instanceof Error ? error.message : 'The backup could not be imported.'); }
});

fillAlternativeSelectors();
render();
const clerkPromise = initializeAuth();
if (loaded.migrated) showToast('Your earlier subscription entries were migrated to FeeVeto.');
if (loaded.recovered) showToast('Saved data could not be read, so FeeVeto opened an empty audit.');
if (!loaded.storageAvailable) showToast('Browser storage is unavailable. Changes may not remain after this tab closes.');
