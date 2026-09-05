import { annualCost, estimatedCostPerUse, formatMoney, monthlyCost } from './calculations.js';
import { CATEGORY_OPTIONS, IMPORTANCE_OPTIONS, optionLabel, USAGE_OPTIONS } from './config.js';
import { evaluateSubscription } from './recommendationEngine.js';

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

function alternativeCard(item, currency) {
  const card = element('article', 'alternative-card');
  const heading = element('div', 'alternative-heading');
  heading.append(element('h4', '', item.serviceName), element('span', 'alternative-type', item.alternativeType.replace('-', ' ')));
  card.append(heading, element('p', '', item.description));
  const facts = element('dl', 'alternative-facts');
  const price = Number.isSafeInteger(item.monthlyPriceMinor)
    ? `${formatMoney(item.monthlyPriceMinor, item.currency)} / month`
    : Number.isSafeInteger(item.yearlyPriceMinor) ? `${formatMoney(item.yearlyPriceMinor, item.currency)} / year` : 'Price not verified';
  facts.append(line('Estimated price', price));
  if (item.estimatedAnnualSavingsMinor !== null) facts.append(line('Estimated annual savings', formatMoney(item.estimatedAnnualSavingsMinor, currency)));
  facts.append(line('Last verified', item.lastVerified));
  card.append(facts);
  if (item.featureTags?.length) card.append(element('p', 'alternative-detail', `Supports: ${item.featureTags.join(', ')}`));
  if (item.limitations?.length) card.append(element('p', 'alternative-detail', `Trade-offs: ${item.limitations.join(', ')}`));
  const link = element('a', 'button button-secondary button-small', 'Visit alternative');
  link.href = item.url;
  link.target = '_blank';
  link.rel = item.isAffiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer';
  card.append(link);
  if (item.isAffiliate) {
    card.append(
      element('span', 'paid-link', 'Paid link'),
      element('p', 'affiliate-disclosure', 'We may earn a commission if you purchase through this link, at no additional cost to you. Affiliate relationships do not affect how alternatives are ranked.'),
    );
  }
  return card;
}

function subscriptionCard(item, result, alternatives) {
  const card = element('article', 'subscription-card');
  card.dataset.id = item.id;
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

  if (result.shouldShowAlternatives) {
    const section = element('section', 'alternatives-section');
    section.append(element('h4', '', 'Verified alternatives'));
    if (alternatives.length) for (const alternative of alternatives) section.append(alternativeCard(alternative, item.currency));
    else section.append(element('p', 'empty-alternatives', 'No verified alternatives are available for this service yet.'));
    card.append(section);
  }

  const actions = element('div', 'card-actions');
  const detail = element('button', 'button button-primary button-small', item.detailedReview ? 'Update detailed review' : 'Review in more detail');
  detail.type = 'button'; detail.dataset.action = 'detail'; detail.dataset.id = item.id;
  detail.setAttribute('aria-label', `Review ${item.name} in more detail`);
  const edit = element('button', 'button button-secondary button-small', 'Edit');
  edit.type = 'button'; edit.dataset.action = 'edit'; edit.dataset.id = item.id; edit.setAttribute('aria-label', `Edit ${item.name}`);
  const remove = element('button', 'text-button danger-text', 'Delete');
  remove.type = 'button'; remove.dataset.action = 'delete'; remove.dataset.id = item.id; remove.setAttribute('aria-label', `Delete ${item.name}`);
  actions.append(detail, edit);
  if (item.cancellationUrl) {
    const link = element('a', 'button button-secondary button-small', 'Provider page');
    link.href = item.cancellationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Open provider page for ${item.name}`);
    actions.append(link);
  }
  actions.append(remove);
  card.append(actions);
  return card;
}

export function renderDashboard({ state, elements, filter, query, alternativesProvider }) {
  const recommendations = state.subscriptions.map((item) => {
    const result = evaluateSubscription(item);
    const review = item.detailedReview;
    const requiredFeatures = String(review?.neededFeatures || '').split(',').map((value) => value.trim()).filter(Boolean);
    const alternatives = result.shouldShowAlternatives
      ? alternativesProvider.getAlternatives(item, { requiredFeatures, considerFree: review?.considerFree, considerCheaper: review?.considerCheaper, acceptAds: review?.acceptAds })
      : [];
    return { item, result, alternatives };
  });

  const included = recommendations.filter(({ item }) => item.currency === state.auditCurrency && item.status !== 'cancelled');
  const totals = included.reduce((value, { item, result }) => {
    value.monthly += monthlyCost(item.amountMinor, item.cycle) || 0;
    value.annual += annualCost(item.amountMinor, item.cycle) || 0;
    if (result.recommendation === 'strong_cancellation_candidate') value.savings += annualCost(item.amountMinor, item.cycle) || 0;
    if (!['keep', 'cancelled'].includes(result.recommendation)) value.actions += 1;
    return value;
  }, { monthly: 0, annual: 0, savings: 0, actions: 0 });

  elements.totalMonthly.textContent = formatMoney(totals.monthly, state.auditCurrency);
  elements.totalAnnual.textContent = formatMoney(totals.annual, state.auditCurrency);
  elements.potentialSavings.textContent = formatMoney(totals.savings, state.auditCurrency);
  elements.subscriptionCount.textContent = String(state.subscriptions.length);
  elements.actionCount.textContent = String(totals.actions);
  const excluded = state.subscriptions.filter((item) => item.currency !== state.auditCurrency && item.status !== 'cancelled').length;
  elements.currencySummary.textContent = excluded ? `${excluded} active ${excluded === 1 ? 'subscription is' : 'subscriptions are'} excluded from ${state.auditCurrency} totals because FeeVeto does not convert currencies.` : `Totals include active subscriptions entered in ${state.auditCurrency}.`;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = recommendations.filter(({ item, result, alternatives }) => (!normalizedQuery || item.name.toLocaleLowerCase().includes(normalizedQuery)) && matchesFilter(result, alternatives, filter));
  elements.list.replaceChildren();
  elements.listSummary.textContent = `${visible.length} of ${state.subscriptions.length} subscriptions shown`;
  if (!state.subscriptions.length) elements.list.append(element('p', 'empty-state', 'Add your first subscription above to begin the audit.'));
  else if (!visible.length) elements.list.append(element('p', 'empty-state', 'No subscriptions match this view.'));
  else for (const entry of visible) elements.list.append(subscriptionCard(entry.item, entry.result, entry.alternatives));
  elements.clearAll.disabled = state.subscriptions.length === 0;
}
