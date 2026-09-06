import { annualCost, estimatedCostPerUse, formatMoney, monthlyCost } from './calculations.js';
import { CATEGORY_OPTIONS, CURRENCIES, IMPORTANCE_OPTIONS, optionLabel, USAGE_OPTIONS } from './config.js';
import { officialDestination } from './alternativeProvider.js';
import { evaluateSubscription } from './recommendationEngine.js';
import { requirementLabel, supportedServiceFor } from './serviceCatalog.js';

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function line(label, value) {
  const row = element('div', 'metric-line');
  row.append(element('dt', '', label), element('dd', '', value));
  return row;
}

function badgeClass(recommendation) {
  if (recommendation === 'keep') return 'badge-green';
  if (recommendation === 'strong_cancellation_candidate') return 'badge-red';
  if (['downgrade', 'pause_rotate'].includes(recommendation)) return 'badge-amber';
  return 'badge-neutral';
}

function matchesFilter(result, alternatives, filter) {
  if (filter === 'all') return true;
  if (filter === 'keep') return ['keep', 'keep_review_plan'].includes(result.recommendation);
  if (filter === 'review') return ['more_information_needed', 'review_before_renewal', 'keep_review_plan'].includes(result.recommendation);
  if (filter === 'save') return ['downgrade', 'pause_rotate', 'replace', 'strong_cancellation_candidate'].includes(result.recommendation);
  if (filter === 'alternatives') return alternatives.length > 0;
  return true;
}

function alternativeCard(item, serviceId) {
  const card = element('article', 'alternative-card');
  const heading = element('div', 'alternative-heading');
  heading.append(element('h4', '', `${item.productName} — ${item.planName}`), element('span', 'alternative-type', item.pricingLabel));
  card.append(heading, element('p', '', item.description), element('p', 'alternative-match', item.whyMatches));
  const facts = element('dl', 'alternative-facts');
  facts.append(line('Pricing model', item.pricingLabel), line('Verified', item.verifiedAt));
  card.append(facts);
  if (item.supportedRequirements?.length) card.append(element('p', 'alternative-detail', `Supports: ${item.supportedRequirements.map((id) => requirementLabel(serviceId, id)).join(', ')}`));
  if (item.limitations?.length) card.append(element('p', 'alternative-detail', `Trade-offs: ${item.limitations.join(' ')}`));
  if (item.verificationNotes?.length) card.append(element('p', 'verification-note', item.verificationNotes.join(' ')));
  const destination = officialDestination(item);
  const link = element('a', 'button button-secondary button-small', item.actionLabel || 'Visit official website');
  link.href = destination;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  if (destination) card.append(link);
  return card;
}

function subscriptionCard(item, result, alternativesState) {
  const service = supportedServiceFor(item);
  const alternatives = alternativesState?.items || [];
  const card = element('article', 'subscription-card');
  card.dataset.id = item.id;
  card.tabIndex = -1;
  const top = element('div', 'result-card-top');
  const title = element('div');
  title.append(element('span', 'category-label', optionLabel(CATEGORY_OPTIONS, item.category)), element('h3', '', item.name));
  top.append(title, element('span', `recommendation-badge ${badgeClass(result.recommendation)}`, result.label));
  card.append(top);

  const metrics = element('dl', 'card-metrics');
  metrics.append(
    line('Original cost', `${formatMoney(item.amountMinor, item.currency)} / ${item.cycle}`),
    line('Monthly equivalent', formatMoney(monthlyCost(item.amountMinor, item.cycle), item.currency)),
    line('Annual equivalent', formatMoney(annualCost(item.amountMinor, item.cycle), item.currency)),
    line('Usage', optionLabel(USAGE_OPTIONS, item.usage)),
    line('Importance', optionLabel(IMPORTANCE_OPTIONS, item.importance)),
  );
  const perUse = estimatedCostPerUse(item.amountMinor, item.cycle, item.usage);
  if (perUse !== null) metrics.append(line('Estimated cost per use', `Approximately ${formatMoney(perUse, item.currency)}`));
  if (item.renewalDate) metrics.append(line('Renewal date', new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${item.renewalDate}T12:00:00`))));
  card.append(metrics);

  const explanation = element('div', 'recommendation-copy');
  explanation.append(element('strong', '', result.summary));
  const reasons = element('ul');
  for (const reason of result.reasons) reasons.append(element('li', '', reason));
  explanation.append(reasons, element('p', 'confidence', `Confidence: ${result.confidence}`));
  card.append(explanation);

  if (alternativesState) {
    const section = element('section', 'alternatives-section');
    section.append(element('h4', '', 'Curated alternatives'));
    if (alternativesState.status === 'loading') section.append(element('p', 'empty-alternatives', 'Checking the private catalogue…'));
    else if (alternatives.length) for (const alternative of alternatives) section.append(alternativeCard(alternative, service?.id));
    else section.append(element('p', 'empty-alternatives', alternativesState.message || 'No verified alternative matches these requirements yet.'));
    if (!alternativesState.requirementsComplete && service) {
      section.append(element('p', 'verification-note', 'Some service requirements are unanswered. These are general candidates, not a confirmed match. Edit the subscription to complete the comparison.'));
    }
    if (service && alternativesState.status === 'ready' && alternativesState.accessScope === 'public') {
      section.append(element('p', 'access-note', 'This public view can include suitable paid alternatives. Eligible owner and beta accounts also receive verified free-plan matches.'));
    }
    card.append(section);
  }

  const actions = element('div', 'card-actions');
  const edit = element('button', 'button button-secondary button-small', 'Edit');
  edit.type = 'button'; edit.dataset.action = 'edit'; edit.dataset.id = item.id; edit.setAttribute('aria-label', `Edit ${item.name}`);
  const remove = element('button', 'text-button danger-text', 'Delete');
  remove.type = 'button'; remove.dataset.action = 'delete'; remove.dataset.id = item.id; remove.setAttribute('aria-label', `Delete ${item.name}`);
  actions.append(edit);
  if (service && item.detailedReview) {
    const retrying = alternativesState?.status === 'error';
    const alternativesButton = element('button', 'button button-secondary button-small', retrying ? 'Retry alternatives' : 'Refresh alternatives');
    alternativesButton.type = 'button'; alternativesButton.dataset.action = 'alternatives'; alternativesButton.dataset.id = item.id;
    alternativesButton.setAttribute('aria-label', `Find curated alternatives for ${item.name}`);
    actions.append(alternativesButton);
  }
  if (item.cancellationUrl) {
    const link = element('a', 'button button-secondary button-small', 'Provider page');
    link.href = item.cancellationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Open provider page for ${item.name}`);
    actions.append(link);
  }
  actions.append(remove);
  card.append(actions);
  return card;
}

export function renderDashboard({ state, elements, filter, query, alternativeResults = new Map() }) {
  const recommendations = state.subscriptions.map((item) => {
    const result = evaluateSubscription(item);
    const alternativesState = alternativeResults.get(item.id);
    return { item, result, alternatives: alternativesState?.items || [], alternativesState };
  });

  const active = recommendations.filter(({ item }) => item.status !== 'cancelled');
  const totalsByCurrency = new Map(CURRENCIES.map((currency) => [currency, { monthly: 0, annual: 0, savings: 0, count: 0 }]));
  for (const { item, result } of active) {
    const totals = totalsByCurrency.get(item.currency);
    totals.monthly += monthlyCost(item.amountMinor, item.cycle) || 0;
    totals.annual += annualCost(item.amountMinor, item.cycle) || 0;
    totals.count += 1;
    if (result.recommendation === 'strong_cancellation_candidate') totals.savings += annualCost(item.amountMinor, item.cycle) || 0;
  }
  const selectedTotals = totalsByCurrency.get(state.auditCurrency);
  const showSelectedTotals = active.length === 0 || selectedTotals.count > 0;
  elements.totalMonthly.textContent = showSelectedTotals ? formatMoney(selectedTotals.monthly, state.auditCurrency) : '—';
  elements.totalAnnual.textContent = showSelectedTotals ? formatMoney(selectedTotals.annual, state.auditCurrency) : '—';
  elements.potentialSavings.textContent = showSelectedTotals ? formatMoney(selectedTotals.savings, state.auditCurrency) : '—';
  elements.monthlyTotalLabel.textContent = `Monthly total (${state.auditCurrency})`;
  elements.annualTotalLabel.textContent = `Annual total (${state.auditCurrency})`;
  elements.savingsTotalLabel.textContent = `Potential annual savings (${state.auditCurrency})`;
  elements.summaryGrid.setAttribute('aria-label', `Audit totals for subscriptions billed in ${state.auditCurrency}. Different currencies are not combined.`);
  elements.subscriptionCount.textContent = String(state.subscriptions.length);
  elements.actionCount.textContent = String(active.filter(({ result }) => !['keep', 'cancelled'].includes(result.recommendation)).length);
  const otherTotals = CURRENCIES
    .filter((currency) => currency !== state.auditCurrency && totalsByCurrency.get(currency).count > 0)
    .map((currency) => {
      const totals = totalsByCurrency.get(currency);
      return `${currency}: ${formatMoney(totals.monthly, currency)} monthly and ${formatMoney(totals.annual, currency)} annually`;
    });
  if (!active.length) {
    elements.currencySummary.textContent = `No active subscriptions yet. New entries default to ${state.auditCurrency}.`;
  } else if (!selectedTotals.count) {
    const originalTotals = otherTotals.join('; ');
    elements.currencySummary.textContent = `No active subscriptions are billed in ${state.auditCurrency}, so ${state.auditCurrency} totals are not shown. Original-currency subtotals: ${originalTotals}. FeeVeto does not convert or combine currencies.`;
  } else if (otherTotals.length) {
    elements.currencySummary.textContent = `${state.auditCurrency} totals include ${selectedTotals.count} active ${selectedTotals.count === 1 ? 'subscription' : 'subscriptions'}. Other original-currency subtotals: ${otherTotals.join('; ')}. FeeVeto does not convert or combine currencies.`;
  } else {
    elements.currencySummary.textContent = `Totals include ${selectedTotals.count} active ${selectedTotals.count === 1 ? 'subscription' : 'subscriptions'} billed in ${state.auditCurrency}. No currency conversion is applied.`;
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = recommendations.filter(({ item, result, alternatives }) => (!normalizedQuery || item.name.toLocaleLowerCase().includes(normalizedQuery)) && matchesFilter(result, alternatives, filter));
  elements.list.replaceChildren();
  elements.listSummary.textContent = `${visible.length} of ${state.subscriptions.length} subscriptions shown`;
  if (!state.subscriptions.length) elements.list.append(element('p', 'empty-state', 'Add your first subscription above to begin the audit.'));
  else if (!visible.length) elements.list.append(element('p', 'empty-state', 'No subscriptions match this view.'));
  else for (const entry of visible) elements.list.append(subscriptionCard(entry.item, entry.result, entry.alternativesState));
  elements.clearAll.disabled = state.subscriptions.length === 0;
}
