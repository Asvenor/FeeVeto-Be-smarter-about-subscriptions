import {
  calculateTotals,
  createSubscriptionId,
  daysUntil,
  filterAndSortSubscriptions,
  fromMinorUnits,
  monthlyEquivalentMinor,
  normalizeSubscription,
  normalizeUrl,
  recommendationFor,
  toMinorUnits,
  upcomingRenewals,
  yearlyEquivalentMinor,
} from './src/core.js';
import { loadState, parseImportedState, saveState } from './src/storage.js';

const elements = {
  form: document.getElementById('subscription-form'),
  formTitle: document.getElementById('form-title'),
  editIndicator: document.getElementById('edit-indicator'),
  submitButton: document.getElementById('submit-button'),
  cancelEdit: document.getElementById('cancel-edit'),
  nameError: document.getElementById('name-error'),
  priceError: document.getElementById('price-error'),
  urlError: document.getElementById('url-error'),
  list: document.getElementById('subscription-list'),
  listSummary: document.getElementById('list-summary'),
  renewalList: document.getElementById('renewal-list'),
  totalMonthly: document.getElementById('total-monthly'),
  possibleSavings: document.getElementById('possible-savings'),
  activeCount: document.getElementById('active-count'),
  renewalCount: document.getElementById('renewal-count'),
  yearlyMessage: document.getElementById('main-yearly-message'),
  clearAll: document.getElementById('clear-all'),
  clearDialog: document.getElementById('clear-dialog'),
  confirmClear: document.getElementById('confirm-clear'),
  currency: document.getElementById('currency'),
  priceCurrency: document.getElementById('price-currency'),
  search: document.getElementById('search'),
  filterCategory: document.getElementById('filter-category'),
  filterStatus: document.getElementById('filter-status'),
  sort: document.getElementById('sort'),
  exportData: document.getElementById('export-data'),
  importData: document.getElementById('import-data'),
  importFile: document.getElementById('import-file'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),
  toastAction: document.getElementById('toast-action'),
  announcer: document.getElementById('announcer'),
};

const loaded = loadState(localStorage);
let appState = loaded.state;
let toastTimer;

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatMoney(minorUnits) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: appState.currency,
    maximumFractionDigits: 2,
  }).format(fromMinorUnits(minorUnits));
}

function formatDate(value) {
  if (!value) return 'No renewal date';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(year, month - 1, day),
  );
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function announce(message) {
  elements.announcer.textContent = '';
  window.setTimeout(() => {
    elements.announcer.textContent = message;
  }, 20);
}

function showToast(message, actionLabel = '', action = null) {
  window.clearTimeout(toastTimer);
  elements.toastMessage.textContent = message;
  elements.toastAction.hidden = !action;
  elements.toastAction.textContent = actionLabel;
  elements.toastAction.onclick = action;
  elements.toast.hidden = false;

  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, action ? 7000 : 4000);
}

function persist() {
  if (!saveState(localStorage, appState)) {
    showToast('Changes work for now, but this browser could not save them.');
  }
}

function resetForm() {
  elements.form.reset();
  elements.form.elements.subscriptionId.value = '';
  elements.form.elements.cycle.value = 'monthly';
  elements.form.elements.status.value = 'active';
  elements.form.elements.usage.value = 'sometimes';
  elements.form.elements.importance.value = 'useful';
  elements.form.elements.category.value = 'entertainment';
  elements.formTitle.textContent = 'Add a subscription';
  elements.submitButton.textContent = 'Add subscription';
  elements.cancelEdit.hidden = true;
  elements.editIndicator.hidden = true;
  clearErrors();
}

function clearErrors() {
  elements.nameError.textContent = '';
  elements.priceError.textContent = '';
  elements.urlError.textContent = '';
  elements.form.elements.name.removeAttribute('aria-invalid');
  elements.form.elements.price.removeAttribute('aria-invalid');
  elements.form.elements.cancellationUrl.removeAttribute('aria-invalid');
}

function validateForm(formData) {
  clearErrors();
  let firstInvalid = null;
  const name = String(formData.get('name') || '').trim();
  const amountMinor = toMinorUnits(formData.get('price'));
  const cancellationUrl = String(formData.get('cancellationUrl') || '').trim();

  if (!name) {
    elements.nameError.textContent = 'Enter a subscription name.';
    elements.form.elements.name.setAttribute('aria-invalid', 'true');
    firstInvalid = elements.form.elements.name;
  }

  if (amountMinor === null) {
    elements.priceError.textContent = 'Enter a valid price of zero or more.';
    elements.form.elements.price.setAttribute('aria-invalid', 'true');
    firstInvalid ||= elements.form.elements.price;
  }

  if (cancellationUrl && !normalizeUrl(cancellationUrl)) {
    elements.urlError.textContent = 'Use a complete http:// or https:// address.';
    elements.form.elements.cancellationUrl.setAttribute('aria-invalid', 'true');
    firstInvalid ||= elements.form.elements.cancellationUrl;
  }

  firstInvalid?.focus();
  return { valid: !firstInvalid, name, amountMinor, cancellationUrl };
}

function renderSummary() {
  const totals = calculateTotals(appState.subscriptions);
  const renewalsWithin30Days = upcomingRenewals(appState.subscriptions, new Date(), 30).length;
  elements.totalMonthly.textContent = formatMoney(totals.totalMonthlyMinor);
  elements.possibleSavings.textContent = formatMoney(totals.possibleYearlySavingsMinor);
  elements.yearlyMessage.replaceChildren(document.createTextNode(formatMoney(totals.totalYearlyMinor)));
  const suffix = createElement('span', '', 'per year');
  elements.yearlyMessage.append(suffix);
  elements.activeCount.textContent = `${totals.activeCount} active`;
  elements.renewalCount.textContent = String(renewalsWithin30Days);
  elements.clearAll.disabled = appState.subscriptions.length === 0;
}

function renderRenewals() {
  elements.renewalList.replaceChildren();
  const renewals = upcomingRenewals(appState.subscriptions);

  if (!renewals.length) {
    elements.renewalList.append(
      createElement('p', 'empty-state compact-empty', 'No renewals are scheduled in the next 90 days.'),
    );
    return;
  }

  for (const { item, days } of renewals) {
    const row = createElement('article', 'renewal-row');
    const details = createElement('div');
    details.append(createElement('h3', '', item.name), createElement('p', '', `${formatDate(item.renewalDate)} · ${formatMoney(item.amountMinor)} ${item.cycle}`));
    const timing = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
    row.append(details, createElement('span', days <= 7 ? 'renewal-timing urgent' : 'renewal-timing', timing));
    elements.renewalList.append(row);
  }
}

function addLabelValue(container, label, value) {
  const row = createElement('p', 'card-line');
  row.append(createElement('span', '', label), createElement('strong', '', value));
  container.append(row);
}

function createSubscriptionCard(item) {
  const recommendation = recommendationFor(item);
  const card = createElement('article', 'subscription-card');
  const top = createElement('div', 'card-top');
  const titleGroup = createElement('div');
  titleGroup.append(createElement('h3', '', item.name));

  const tags = createElement('div', 'tag-row');
  tags.append(
    createElement('span', 'tag', capitalize(item.category)),
    createElement('span', `tag status-${item.status}`, item.status === 'trial' ? 'Free trial' : capitalize(item.status)),
  );
  titleGroup.append(tags);
  top.append(titleGroup, createElement('span', `verdict ${recommendation.tone}`, recommendation.label));
  card.append(top);

  const amounts = createElement('div', 'card-amounts');
  addLabelValue(amounts, 'Original', `${formatMoney(item.amountMinor)} / ${item.cycle}`);
  addLabelValue(amounts, 'Monthly', formatMoney(monthlyEquivalentMinor(item.amountMinor, item.cycle)));
  addLabelValue(amounts, 'Yearly', formatMoney(yearlyEquivalentMinor(item.amountMinor, item.cycle)));
  if (item.renewalDate) addLabelValue(amounts, 'Next renewal', formatDate(item.renewalDate));
  card.append(amounts);

  card.append(createElement('p', 'recommendation-reason', recommendation.reason));

  const actions = createElement('div', 'card-actions');
  const edit = createElement('button', 'btn secondary small', 'Edit');
  edit.type = 'button';
  edit.dataset.action = 'edit';
  edit.dataset.id = item.id;
  edit.setAttribute('aria-label', `Edit ${item.name}`);
  actions.append(edit);

  if (item.cancellationUrl) {
    const cancelLink = createElement('a', 'btn secondary small', 'Account page');
    cancelLink.href = item.cancellationUrl;
    cancelLink.target = '_blank';
    cancelLink.rel = 'noopener noreferrer';
    cancelLink.setAttribute('aria-label', `Open account page for ${item.name}`);
    actions.append(cancelLink);
  }

  const remove = createElement('button', 'btn danger small', 'Delete');
  remove.type = 'button';
  remove.dataset.action = 'delete';
  remove.dataset.id = item.id;
  remove.setAttribute('aria-label', `Delete ${item.name}`);
  actions.append(remove);
  card.append(actions);
  return card;
}

function renderSubscriptions() {
  const filtered = filterAndSortSubscriptions(appState.subscriptions, {
    query: elements.search.value,
    category: elements.filterCategory.value,
    status: elements.filterStatus.value,
    sort: elements.sort.value,
  });

  elements.list.replaceChildren();
  elements.listSummary.textContent = `${filtered.length} of ${appState.subscriptions.length} subscriptions shown`;

  if (!appState.subscriptions.length) {
    elements.list.append(createElement('p', 'empty-state', 'Add your first subscription above. It will be saved privately in this browser.'));
    return;
  }

  if (!filtered.length) {
    elements.list.append(createElement('p', 'empty-state', 'No subscriptions match these filters.'));
    return;
  }

  for (const item of filtered) elements.list.append(createSubscriptionCard(item));
}

function render() {
  elements.currency.value = appState.currency;
  elements.priceCurrency.textContent = appState.currency;
  renderSummary();
  renderRenewals();
  renderSubscriptions();
}

function beginEdit(id) {
  const item = appState.subscriptions.find((subscription) => subscription.id === id);
  if (!item) return;

  elements.form.elements.subscriptionId.value = item.id;
  elements.form.elements.name.value = item.name;
  elements.form.elements.price.value = fromMinorUnits(item.amountMinor).toFixed(2);
  elements.form.elements.cycle.value = item.cycle;
  elements.form.elements.renewalDate.value = item.renewalDate;
  elements.form.elements.status.value = item.status;
  elements.form.elements.usage.value = item.usage;
  elements.form.elements.importance.value = item.importance;
  elements.form.elements.category.value = item.category;
  elements.form.elements.cancellationUrl.value = item.cancellationUrl;
  elements.formTitle.textContent = `Edit ${item.name}`;
  elements.submitButton.textContent = 'Save changes';
  elements.cancelEdit.hidden = false;
  elements.editIndicator.hidden = false;
  document.getElementById('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  elements.form.elements.name.focus({ preventScroll: true });
}

function deleteSubscription(id) {
  const index = appState.subscriptions.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = appState.subscriptions.splice(index, 1);
  if (elements.form.elements.subscriptionId.value === id) resetForm();
  persist();
  render();
  announce(`${removed.name} deleted.`);
  showToast(`${removed.name} deleted.`, 'Undo', () => {
    appState.subscriptions.splice(index, 0, removed);
    persist();
    render();
    elements.toast.hidden = true;
    announce(`${removed.name} restored.`);
  });
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `subkiller-backup-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Backup exported.');
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(elements.form);
  const validation = validateForm(formData);
  if (!validation.valid) return;

  const editingId = String(formData.get('subscriptionId') || '');
  const item = normalizeSubscription({
    id: editingId || createSubscriptionId(),
    name: validation.name,
    amountMinor: validation.amountMinor,
    cycle: formData.get('cycle'),
    renewalDate: formData.get('renewalDate'),
    status: formData.get('status'),
    usage: formData.get('usage'),
    importance: formData.get('importance'),
    category: formData.get('category'),
    cancellationUrl: validation.cancellationUrl,
  });

  if (!item) {
    showToast('Check the subscription details and try again.');
    return;
  }

  if (editingId) {
    const index = appState.subscriptions.findIndex((subscription) => subscription.id === editingId);
    if (index >= 0) appState.subscriptions[index] = item;
    showToast(`${item.name} updated.`);
    announce(`${item.name} updated.`);
  } else {
    appState.subscriptions.push(item);
    showToast(`${item.name} added.`);
    announce(`${item.name} added.`);
  }

  persist();
  resetForm();
  render();
});

elements.cancelEdit.addEventListener('click', resetForm);

elements.list.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'edit') beginEdit(button.dataset.id);
  if (button.dataset.action === 'delete') deleteSubscription(button.dataset.id);
});

elements.currency.addEventListener('change', () => {
  appState.currency = elements.currency.value;
  persist();
  render();
  showToast(`Amounts are now labelled ${appState.currency}; their values were not converted.`);
  announce(`List currency changed to ${appState.currency}. Values were not converted.`);
});

for (const control of [elements.search, elements.filterCategory, elements.filterStatus, elements.sort]) {
  control.addEventListener(control === elements.search ? 'input' : 'change', renderSubscriptions);
}

elements.clearAll.addEventListener('click', () => elements.clearDialog.showModal());
elements.confirmClear.addEventListener('click', () => {
  const previous = [...appState.subscriptions];
  appState.subscriptions = [];
  persist();
  resetForm();
  render();
  announce('All subscriptions cleared.');
  showToast('All subscriptions cleared.', 'Undo', () => {
    appState.subscriptions = previous;
    persist();
    render();
    elements.toast.hidden = true;
    announce('Subscription list restored.');
  });
});

elements.exportData.addEventListener('click', exportBackup);
elements.importData.addEventListener('click', () => elements.importFile.click());
elements.importFile.addEventListener('change', async () => {
  const [file] = elements.importFile.files;
  elements.importFile.value = '';
  if (!file) return;

  try {
    const imported = parseImportedState(await file.text());
    const confirmed = window.confirm(`Replace your current list with ${imported.subscriptions.length} subscriptions from this backup?`);
    if (!confirmed) return;
    appState = imported;
    persist();
    resetForm();
    render();
    showToast('Backup imported successfully.');
    announce('Backup imported successfully.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'This backup could not be imported.');
  }
});

render();
if (loaded.migrated) showToast('Your existing subscriptions were upgraded to the new format.');
if (loaded.recovered) showToast('Saved data could not be read, so SubKiller started with an empty list.');
