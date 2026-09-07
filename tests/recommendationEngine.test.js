import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSubscription } from '../js/recommendationEngine.js';

function subscription(overrides = {}) {
  return {
    id: 'test', name: 'Example', amountMinor: 1800, currency: 'CHF', cycle: 'monthly', category: 'software',
    usage: 'several_per_month', importance: 'useful', status: 'active', renewalDate: '', cancellationUrl: '', detailedReview: null,
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    satisfaction: 'satisfied', householdUse: false, overlap: false, switchingDifficulty: 'manageable', considerCheaper: false,
    considerFree: false, acceptAds: false, seasonal: false, activeContract: false, neededFeatures: '', categoryAnswers: {}, ...overrides,
  };
}

test('daily essential satisfied service is kept', () => {
  assert.equal(evaluateSubscription(subscription({ usage: 'daily', importance: 'essential', detailedReview: review() })).recommendation, 'keep');
});

test('never-used unimportant unshared service is a strong cancellation candidate', () => {
  assert.equal(evaluateSubscription(subscription({ usage: 'never', importance: 'not_important', detailedReview: review() })).recommendation, 'strong_cancellation_candidate');
});

test('rarely opened essential backup is not automatically cancelled', () => {
  assert.notEqual(evaluateSubscription(subscription({ category: 'cloud', usage: 'less_than_monthly', importance: 'essential' })).recommendation, 'strong_cancellation_candidate');
});

test('frequently used basic service can be a downgrade candidate', () => {
  assert.equal(evaluateSubscription(subscription({ usage: 'daily', detailedReview: review({ considerCheaper: true, categoryAnswers: { basicFeaturesOnly: true } }) })).recommendation, 'downgrade');
});

test('seasonal streaming service becomes a pause or rotate candidate', () => {
  assert.equal(evaluateSubscription(subscription({ category: 'streaming', detailedReview: review({ seasonal: true }) })).recommendation, 'pause_rotate');
});

test('household use protects a low-personal-use service from cancellation', () => {
  assert.equal(evaluateSubscription(subscription({ usage: 'never', importance: 'nice_to_have', detailedReview: review({ householdUse: true }) })).recommendation, 'keep_review_plan');
});

test('active annual contract is reviewed before renewal', () => {
  assert.equal(evaluateSubscription(subscription({ cycle: 'yearly', detailedReview: review({ activeContract: true }) })).recommendation, 'review_before_renewal');
});

test('overlapping service increases replacement likelihood', () => {
  assert.equal(evaluateSubscription(subscription({ detailedReview: review({ overlap: true, considerFree: true }) })).recommendation, 'replace');
});

test('critical backup detail protects low-visible-use cloud storage', () => {
  const result = evaluateSubscription(subscription({ category: 'cloud', usage: 'never', detailedReview: review({ categoryAnswers: { criticalBackup: true } }) }));
  assert.equal(result.recommendation, 'keep');
});

test('ad-supported streaming preference can support a downgrade', () => {
  const result = evaluateSubscription(subscription({ category: 'streaming', detailedReview: review({ considerCheaper: true, categoryAnswers: { adSupportedPlan: true } }) }));
  assert.equal(result.recommendation, 'downgrade');
});

test('low fitness usage and cheaper pay-per-visit option support downgrade', () => {
  const result = evaluateSubscription(subscription({ category: 'fitness', detailedReview: review({ categoryAnswers: { payPerVisitCheaper: true, timesPerMonth: 3 } }) }));
  assert.equal(result.recommendation, 'downgrade');
});

test('required multiplayer access protects an important gaming subscription', () => {
  const result = evaluateSubscription(subscription({ category: 'gaming', importance: 'important', detailedReview: review({ categoryAnswers: { multiplayerRequired: true } }) }));
  assert.equal(result.recommendation, 'keep');
});
