import { annualCost, estimatedCostPerUse, formatMoney, monthlyCost } from './calculations.js';
import { CATEGORY_OPTIONS, CURRENCIES, IMPORTANCE_OPTIONS, optionLabel, USAGE_OPTIONS } from './config.js';
import { officialDestination, recommendationRequestFor } from './alternativeProvider.js';
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

export function alternativeCard(item, serviceId) {
  const card = element('article', 'alternative-card');
  const heading = element('div', 'alternative-heading');
  heading.append(element('h4', '', `${item.productName} — ${item.planName}`), element('span', 'alternative-type', item.pricingLabel));
  const statusClass = item.matchStatus === 'matched' ? 'matched' : item.matchStatus === 'general' ? 'general' : 'candidate';
  card.append(heading, element('p', `alternative-status ${statusClass}`, item.matchLabel), element('p', 'alternative-match', item.whyMatches || item.description));
  const details = element('details', 'result-disclosure');
  details.append(element('summary', '', 'Details & sources'));
  if (item.description && item.whyMatches && item.description !== item.whyMatches) details.append(element('p', '', item.description));
  const facts = element('dl', 'alternative-facts');
  const price = item.price || {};
  let priceText = 'Check current pricing';
  if (item.pricingModel === 'free' && price.amountMinor === 0) priceText = 'Free';
  else if (Number.isSafeInteger(price.amountMinor) && price.currency) {
    const interval = price.billingInterval === 'one_time' ? ' one-time' : price.billingInterval ? ` / ${price.billingInterval}` : '';
    priceText = `${formatMoney(price.amountMinor, price.currency)}${interval}`;
  }
  facts.append(
    line('Verified price', priceText),
    line('Switching effort', item.switchingDifficulty || 'Unknown'),
  );
  card.append(facts);
  if (item.supportedRequirements?.length) details.append(element('p', 'alternative-detail', `Supports: ${item.supportedRequirements.map((id) => requirementLabel(serviceId, id)).join(', ')}`));
  // Qualifications stay beside the price, not behind the optional details.
  if (item.limitations?.length) card.append(element('p', 'alternative-detail', `Trade-offs: ${item.limitations.join(' ')}`));
  if (item.usageLimits?.length) card.append(element('p', 'alternative-detail', `Plan limits: ${item.usageLimits.join(' ')}`));
  if (price.upfrontCommitmentMonths) card.append(element('p', 'alternative-detail', `Commitment: ${price.upfrontCommitmentMonths} months paid or committed up front.`));
  if (price.introductoryTerms) card.append(element('p', 'alternative-detail', `Introductory terms: ${price.introductoryTerms}`));
  if (price.renewalTerms) card.append(element('p', 'alternative-detail', `Renewal terms: ${price.renewalTerms}`));
  if (item.verificationNotes?.length) card.append(element('p', 'verification-note', item.verificationNotes.join(' ')));
  if (item.features?.length) details.append(element('p', 'alternative-detail', `Useful for: ${item.features.slice(0, 4).map(id => requirementLabel(serviceId, id)).join(', ')}.`));
  if (item.unsupportedFeatures?.length) card.append(element('p', 'alternative-detail', `Does not include: ${item.unsupportedFeatures.map(id => requirementLabel(serviceId, id)).join(', ')}.`));
  if (item.reviewRating) {
    const rating = element('p', 'alternative-detail', `Customer reviews: ${item.reviewRating.value}/${item.reviewRating.scale} from ${item.reviewRating.count} reviews on ${item.reviewRating.source}; checked ${item.reviewRating.checkedAt}. Separate from your suitability assessment. `);
    const sourceUrl = officialDestination({ officialUrl: item.reviewRating.sourceUrl });
    if (sourceUrl) { const source = element('a', '', 'Review source'); source.href = sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; rating.append(source); }
    details.append(rating);
  }
  const verification = element('dl', 'alternative-facts');
  verification.append(line('Claims verified', item.verifiedAt || 'Unknown'));
  if (price.verifiedAt) verification.append(line('Price checked', price.verifiedAt));
  details.append(verification);
  if (item.sourceUrls?.length) {
    const sources = element('div', 'alternative-sources');
    for (const [index, url] of item.sourceUrls.entries()) {
      const safe = officialDestination({officialUrl:url});
      if (!safe) continue;
      const source = element('a', '', `Source ${index + 1}`); source.href = safe; source.target = '_blank'; source.rel = 'noopener noreferrer'; sources.append(source);
    }
    details.append(sources);
  }
  card.append(details);
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
    line('Annual equivalent', formatMoney(annualCost(item.amountMinor, item.cycle), item.currency)),
  );
  if (item.renewalDate) metrics.append(line('Renewal date', new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${item.renewalDate}T12:00:00`))));
  card.append(metrics);

  const explanation = element('div', 'recommendation-copy');
  explanation.append(element('strong', '', result.summary), element('p', 'confidence', `Confidence: ${result.confidence}`));
  for (const warning of result.warnings || []) explanation.append(element('p', 'verification-note', warning));
  card.append(explanation);

  const details = element('details', 'result-disclosure');
  details.append(element('summary', '', 'Why this recommendation'));
  const breakdown = element('dl', 'card-metrics');
  if (item.cycle !== 'monthly') breakdown.append(line('Monthly equivalent', formatMoney(monthlyCost(item.amountMinor, item.cycle), item.currency)));
  breakdown.append(
    line('Usage', optionLabel(USAGE_OPTIONS, item.usage)),
    line('Importance', optionLabel(IMPORTANCE_OPTIONS, item.importance)),
  );
  const perUse = estimatedCostPerUse(item.amountMinor, item.cycle, item.usage);
  if (perUse !== null) breakdown.append(line('Estimated cost per use', `Approximately ${formatMoney(perUse, item.currency)}`));
  const reasons = element('ul');
  for (const reason of result.reasons) reasons.append(element('li', '', reason));
  details.append(breakdown, reasons);
  card.append(details);

  if (alternativesState) {
    const section = element('section', 'alternatives-section');
    section.append(element('h4', '', 'Curated alternatives'));
    if (alternativesState.status === 'loading') {
      section.append(element('p', 'empty-alternatives', 'Looking for relevant alternatives…'));
    } else if (alternatives.length) {
      if (alternativesState.state === 'general_suggestions') {
        section.append(element('p', 'general-suggestions-note', 'These are general suggestions based on the information provided. Add your must-have features, device, and other preferences to help us narrow them down.'));
        if (alternativesState.missingDetails?.length) {
          section.append(element('p', 'alternative-detail', `Most useful details to add: ${alternativesState.missingDetails.join(', ')}.`));
        }
        const improve = element('button', 'button button-secondary button-small', 'Improve my matches');
        improve.type = 'button'; improve.dataset.action = 'improve'; improve.dataset.id = item.id;
        improve.setAttribute('aria-label', `Improve alternative matches for ${item.name}`);
        section.append(improve);
      }
      for (const alternative of alternatives) section.append(alternativeCard(alternative, service?.id));
    } else {
      section.append(element('p', alternativesState.state === 'access_restricted' ? 'access-note' : 'empty-alternatives', alternativesState.message || 'No accessible verified alternative meets the selected requirements.'));
    }
    card.append(section);
  }

  const actions = element('div', 'card-actions');
  const edit = element('button', 'button button-secondary button-small', 'Edit');
  edit.type = 'button'; edit.dataset.action = 'edit'; edit.dataset.id = item.id; edit.setAttribute('aria-label', `Edit ${item.name}`);
  const remove = element('button', 'text-button danger-text', 'Delete');
  remove.type = 'button'; remove.dataset.action = 'delete'; remove.dataset.id = item.id; remove.setAttribute('aria-label', `Delete ${item.name}`);
  actions.append(edit);
  const personalize = element('button','button button-secondary button-small','Find my best fit');
  personalize.type='button'; personalize.dataset.action='personalize'; personalize.dataset.id=item.id;
  personalize.setAttribute('aria-label',`Find the best fit for ${item.name}`); actions.append(personalize);
  if (recommendationRequestFor(item)) {
    const retrying = alternativesState?.status === 'error';
    const alternativesButton = element('button', 'button button-secondary button-small', retrying ? 'Retry alternatives' : 'Refresh alternatives');
    alternativesButton.type = 'button'; alternativesButton.dataset.action = 'alternatives'; alternativesButton.dataset.id = item.id;
    alternativesButton.disabled = alternativesState?.status === 'loading';
    alternativesButton.setAttribute('aria-label', `${retrying ? 'Retry' : 'Refresh'} alternatives for ${item.name}`);
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
  if (!state.subscriptions.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('h3', '', 'Start with just one.'), element('p', '', 'Add something you pay for. We’ll help you see its yearly cost and whether it still fits.'));
    const add = element('a', 'button button-secondary', 'Add your first subscription');
    add.href = '#subscription-editor'; empty.append(add); elements.list.append(empty);
  }
  else if (!visible.length) elements.list.append(element('p', 'empty-state', 'No subscriptions match this view.'));
  else for (const entry of visible) elements.list.append(subscriptionCard(entry.item, entry.result, entry.alternativesState));
  elements.clearAll.disabled = state.subscriptions.length === 0;
}
