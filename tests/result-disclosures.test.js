import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { alternativeCard, renderDashboard } from '../js/render.js';
import { formatMoney } from '../js/calculations.js';
import { evaluateSubscription } from '../js/recommendationEngine.js';

function setup() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://feeveto.example/' });
  const originalDocument = globalThis.document;
  globalThis.document = dom.window.document;
  return { dom, cleanup() { globalThis.document = originalDocument; dom.window.close(); } };
}

function subscription(overrides = {}) {
  return {
    id: 'saved-netflix', name: 'Netflix', amountMinor: 1800, currency: 'CHF', cycle: 'monthly',
    category: 'streaming', usage: 'weekly', importance: 'useful', status: 'active',
    renewalDate: '', cancellationUrl: '', detailedReview: null, ...overrides,
  };
}

function offer(overrides = {}) {
  return {
    id: 'fixture-alternative', productName: 'Fictional Studio', planName: 'Test plan',
    pricingLabel: 'Paid alternative', pricingModel: 'subscription',
    matchStatus: 'candidate', matchLabel: 'Candidate—needs verification',
    description: 'Test-only product description.', whyMatches: 'A provisional option for the selected product type.',
    switchingDifficulty: 'difficult', verifiedAt: '2026-09-08',
    price: { amountMinor: 999, currency: 'CHF', billingInterval: 'monthly', verifiedAt: '2026-09-07' },
    features: ['templates'], supportedRequirements: ['templates'], unsupportedFeatures: [],
    limitations: [], usageLimits: [], verificationNotes: ['Availability in your country is unconfirmed.'],
    officialUrl: 'https://fictional.example/product', sourceUrls: ['https://fictional.example/pricing'],
    ...overrides,
  };
}

function dashboard(item, alternativeState) {
  const names = ['totalMonthly', 'totalAnnual', 'potentialSavings', 'monthlyTotalLabel', 'annualTotalLabel',
    'savingsTotalLabel', 'summaryGrid', 'subscriptionCount', 'actionCount', 'currencySummary', 'list', 'listSummary', 'clearAll'];
  const elements = Object.fromEntries(names.map(name => [name, document.createElement(name === 'clearAll' ? 'button' : 'div')]));
  renderDashboard({ state: { subscriptions: [item], auditCurrency: 'EUR' }, elements, filter: 'all', query: '',
    alternativeResults: new Map(alternativeState ? [[item.id, alternativeState]] : []) });
  return { elements, card: elements.list.querySelector('.subscription-card') };
}

function outsideDetails(node) {
  const copy = node.cloneNode(true);
  for (const detail of copy.querySelectorAll('details')) detail.remove();
  return copy.textContent;
}

function assertClosedDisclosure(node, title) {
  const disclosure = node.querySelector('details.result-disclosure');
  assert.ok(disclosure);
  assert.equal(disclosure.open, false);
  assert.equal(disclosure.hasAttribute('open'), false);
  assert.equal(disclosure.firstElementChild.tagName, 'SUMMARY');
  assert.equal(disclosure.firstElementChild.textContent, title);
  return disclosure;
}

test('subscription cards show the decision and original-currency totals while secondary facts are optional', () => {
  const env = setup(); try {
    const item = subscription(), before = structuredClone(item), recommendation = evaluateSubscription(item);
    const { card, elements } = dashboard(item);
    const details = assertClosedDisclosure(card, 'Why this recommendation');
    const visible = outsideDetails(card);
    assert.ok(visible.includes(item.name));
    assert.ok(visible.includes(recommendation.label));
    assert.ok(visible.includes(recommendation.summary));
    assert.ok(visible.includes(`Confidence: ${recommendation.confidence}`));
    assert.ok(visible.includes(`${formatMoney(1800, 'CHF')} / monthly`));
    assert.ok(visible.includes(formatMoney(21600, 'CHF')));
    assert.equal(visible.includes('Usage'), false);
    assert.equal(visible.includes('Estimated cost per use'), false);
    assert.ok(details.textContent.includes('Usage'));
    assert.ok(details.textContent.includes('Estimated cost per use'));
    assert.ok(details.textContent.includes(recommendation.reasons[0]));
    assert.equal(card.textContent.includes('Monthly equivalent'), false, 'Do not repeat the original monthly price');
    assert.equal(elements.totalAnnual.textContent, '—', 'An empty EUR subtotal is not the CHF audit total');
    assert.ok(elements.currencySummary.textContent.includes('CHF'));
    for (const action of ['edit', 'delete', 'personalize', 'alternatives']) {
      const button = card.querySelector(`[data-action="${action}"]`);
      assert.equal(button.dataset.id, item.id);
      assert.equal(button.closest('details'), null);
    }
    assert.equal(card.dataset.id, item.id);
    assert.equal(card.tabIndex, -1);
    assert.deepEqual(item, before);
  } finally { env.cleanup(); }
});

test('annual contracts keep their decision and renewal date visible; monthly equivalents stay in the breakdown', () => {
  const env = setup(); try {
    const item = subscription({ cycle: 'yearly', renewalDate: '2027-02-12', detailedReview: { activeContract: true } });
    const { card } = dashboard(item), visible = outsideDetails(card);
    const details = assertClosedDisclosure(card, 'Why this recommendation');
    assert.ok(visible.includes('Review before renewal'));
    assert.ok(visible.includes('An active annual contract'));
    assert.ok(visible.includes('Renewal date'));
    assert.equal(visible.includes('Monthly equivalent'), false);
    assert.ok(details.textContent.includes('Monthly equivalent'));
    assert.ok(details.textContent.includes(formatMoney(150, 'CHF')));
  } finally { env.cleanup(); }
});

test('alternative cards keep source-currency prices, material trade-offs and candidate warnings outside disclosures', () => {
  const env = setup(); try {
    const item = offer({
      limitations: ['No offline use.'], usageLimits: ['Three projects only.'], unsupportedFeatures: ['offline_access', 'custom_requirement'],
      price: { amountMinor: 999, currency: 'CHF', billingInterval: 'monthly', upfrontCommitmentMonths: 12,
        introductoryTerms: 'Reduced price for the first year.', renewalTerms: 'Renews at the standard provider rate.', verifiedAt: '2026-09-07' },
      reviewRating: { value: 4, scale: 5, count: 10, source: 'Fictional Reviews', checkedAt: '2026-09-07', sourceUrl: 'https://reviews.example/test' },
    });
    const before = structuredClone(item), card = alternativeCard(item, 'canva');
    const details = assertClosedDisclosure(card, 'Details & sources'), visible = outsideDetails(card);
    for (const value of [item.productName, item.planName, item.matchLabel, item.whyMatches,
      formatMoney(999, 'CHF'), 'No offline use.', 'Three projects only.', 'Does not include:',
      'Commitment: 12 months', 'Reduced price for the first year.', 'Renews at the standard provider rate.',
      'Availability in your country is unconfirmed.', 'difficult']) assert.ok(visible.includes(value), value);
    assert.equal(visible.includes('$9.99'), false);
    assert.equal(visible.includes('Customer reviews:'), false);
    assert.equal(visible.includes('Useful for:'), false);
    assert.ok(details.textContent.includes('Supports:'));
    assert.ok(details.textContent.includes('Useful for:'));
    assert.ok(details.textContent.includes('Customer reviews:'));
    assert.ok(details.textContent.includes('Separate from your suitability assessment.'));
    assert.ok(details.textContent.includes('Price checked'));
    assert.equal(card.querySelector('.alternative-status').classList.contains('matched'), false);
    assert.deepEqual(item, before);
  } finally { env.cleanup(); }
});

test('historical results without a match calculation do not claim missing preferences or invent a score', () => {
  const env = setup(); try {
    const item = offer(), before = structuredClone(item), card = alternativeCard(item, 'canva');
    assert.equal(card.querySelector('.feeveto-match').textContent, 'FeeVeto Match: Not scored');
    assert.ok(card.querySelector('.match-explanation').textContent.includes('your existing answers'));
    assert.equal(card.textContent.includes('More preferences are needed'), false);
    assert.deepEqual(item, before);
    const current = alternativeCard(offer({ feeVetoMatch: {
      score: null, label: 'General match', meaning: 'More selected criteria are needed to calculate coverage.',
    } }), 'canva');
    assert.equal(current.querySelector('.feeveto-match').textContent, 'FeeVeto Match: General match');
    assert.ok(current.querySelector('.match-explanation').textContent.includes('More selected criteria'));
  } finally { env.cleanup(); }
});

test('unknown alternative prices stay unknown, while explicitly free plans remain distinguishable', () => {
  const env = setup(); try {
    for (const price of [{ amountMinor: null, currency: 'USD' }, {}, { amountMinor: null, currency: null }]) {
      const card = alternativeCard(offer({ price }), 'canva'), visible = outsideDetails(card);
      assert.ok(visible.includes('Check current pricing'));
      assert.equal(visible.includes('$0'), false);
      assert.equal(visible.includes('€0'), false);
      assert.equal(visible.includes('Free'), false);
    }
    const free = alternativeCard(offer({ pricingModel: 'free', pricingLabel: 'Free plan', price: { amountMinor: 0, currency: null } }));
    assert.ok(outsideDetails(free).includes('Free'));
    assert.equal(outsideDetails(free).includes('Check current pricing'), false);
  } finally { env.cleanup(); }
});

test('collapsed sources retain safe links and untrusted catalogue text is never parsed as HTML', () => {
  const env = setup(); try {
    const payload = '<img src=x onerror=alert(1)>', card = alternativeCard(offer({
      productName: payload, description: payload, verificationNotes: [payload],
      sourceUrls: ['javascript:alert(1)', 'http://insecure.example/', 'https://fictional.example/source'],
      reviewRating: { value: 4, scale: 5, count: 10, source: payload, checkedAt: '2026-09-07', sourceUrl: 'javascript:alert(1)' },
    }));
    const details = assertClosedDisclosure(card, 'Details & sources');
    assert.equal(card.querySelector('img'), null);
    assert.ok(card.textContent.includes(payload));
    assert.equal(details.querySelectorAll('a').length, 1);
    for (const link of card.querySelectorAll('a')) {
      assert.equal(new URL(link.href).protocol, 'https:');
      assert.equal(link.target, '_blank');
      assert.ok(link.rel.includes('noopener'));
      assert.ok(link.rel.includes('noreferrer'));
    }
    assert.equal(card.querySelector('.button').closest('details'), null);
    const unsafe = alternativeCard(offer({ officialUrl: 'javascript:alert(1)', sourceUrls: [] }));
    assert.equal(unsafe.querySelector('a'), null);
  } finally { env.cleanup(); }
});

test('rendering preserves server access decisions and keeps failure retry available without fetching or granting access', () => {
  const env = setup(), originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('Presentation must not fetch or authorize alternatives'); };
  try {
    env.dom.window.localStorage.setItem('premiumAccess', 'true');
    const item = subscription(), before = structuredClone(item);
    const restricted = dashboard(item, { status: 'ready', state: 'access_restricted', items: [], message: 'This comparison requires verified access.' });
    assert.equal(restricted.card.querySelectorAll('.alternative-card').length, 0);
    assert.ok(outsideDetails(restricted.card).includes('This comparison requires verified access.'));
    const failed = dashboard(item, { status: 'error', state: 'catalogue_unavailable', items: [], message: 'Catalogue unavailable. Retry.' });
    const retry = failed.card.querySelector('[data-action="alternatives"]');
    assert.equal(retry.textContent, 'Retry alternatives');
    assert.equal(retry.disabled, false);
    assert.equal(retry.dataset.id, item.id);
    assert.equal(retry.closest('details'), null);
    assert.ok(outsideDetails(failed.card).includes('Catalogue unavailable. Retry.'));
    assert.equal(calls, 0);
    assert.deepEqual(item, before);
  } finally { globalThis.fetch = originalFetch; env.cleanup(); }
});

test('general suggestions retain their qualification and improve action without becoming confirmed matches', () => {
  const env = setup(); try {
    const item = subscription();
    const result = offer({ matchStatus: 'general', matchLabel: 'General suggestion' });
    const { card } = dashboard(item, { status: 'ready', state: 'general_suggestions', items: [result], missingDetails: ['Country'] });
    const visible = outsideDetails(card), improve = card.querySelector('[data-action="improve"]');
    assert.ok(visible.includes('These are general suggestions'));
    assert.ok(visible.includes('Most useful details to add: Country'));
    assert.ok(visible.includes('General suggestion'));
    assert.equal(visible.includes('Matches your selected needs'), false);
    assert.equal(improve.dataset.id, item.id);
    assert.equal(improve.closest('details'), null);
    assert.equal(card.querySelectorAll('.alternative-card').length, 1);
  } finally { env.cleanup(); }
});
