import { annualCost, estimatedCostPerUse } from './calculations.js';

export const RECOMMENDATION_LABELS = Object.freeze({
  keep: 'Keep',
  keep_review_plan: 'Keep, but review the plan',
  downgrade: 'Consider downgrading',
  pause_rotate: 'Consider pausing or rotating',
  replace: 'Consider replacing',
  review_before_renewal: 'Review before renewal',
  strong_cancellation_candidate: 'Strong cancellation candidate',
  more_information_needed: 'More information needed',
  cancelled: 'Cancelled',
});

export const DECISION_WEIGHTS = Object.freeze({
  usage: { daily: 32, several_per_week: 27, weekly: 21, several_per_month: 14, monthly: 8, less_than_monthly: 2, never: -22 },
  importance: { essential: 34, important: 24, useful: 12, nice_to_have: 0, not_important: -18 },
  satisfaction: { very_satisfied: 10, satisfied: 6, neutral: 0, dissatisfied: -9, very_dissatisfied: -15 },
  householdUse: 12,
  overlap: -16,
  difficultSwitch: 8,
  seasonal: -7,
});

export const DECISION_THRESHOLDS = Object.freeze({ keep: 46, review: 25, cancel: 5 });

function result(recommendation, summary, reasons, options = {}) {
  return {
    recommendation,
    label: RECOMMENDATION_LABELS[recommendation],
    summary,
    reasons,
    warnings: options.warnings || [],
    score: Math.max(0, Math.min(100, Math.round(options.score ?? 50))),
    confidence: options.confidence || 'medium',
    shouldShowAlternatives: options.shouldShowAlternatives ?? ['downgrade', 'replace', 'strong_cancellation_candidate'].includes(recommendation),
  };
}

function quickScore(item) {
  return 40 + (DECISION_WEIGHTS.usage[item.usage] || 0) + (DECISION_WEIGHTS.importance[item.importance] || 0);
}

function detailedScore(item) {
  const review = item.detailedReview;
  let score = quickScore(item);
  if (!review) return score;
  score += DECISION_WEIGHTS.satisfaction[review.satisfaction] || 0;
  if (review.householdUse) score += DECISION_WEIGHTS.householdUse;
  if (review.overlap) score += DECISION_WEIGHTS.overlap;
  if (review.switchingDifficulty === 'difficult') score += DECISION_WEIGHTS.difficultSwitch;
  if (review.seasonal) score += DECISION_WEIGHTS.seasonal;
  return score;
}

export function evaluateSubscription(item) {
  if (item.status === 'cancelled') {
    return result('cancelled', 'This entry is excluded from active totals.', ['You marked the subscription as cancelled.'], { score: 0, confidence: 'high', shouldShowAlternatives: false });
  }

  const review = item.detailedReview;
  const score = detailedScore(item);
  const confidence = review ? 'high' : 'low';
  const cost = annualCost(item.amountMinor, item.cycle) || 0;
  const costPerUse = estimatedCostPerUse(item.amountMinor, item.cycle, item.usage);
  const costReason = costPerUse === null ? '' : 'Its estimated cost per use can now be compared with its value to you.';

  if (review?.activeContract && item.cycle === 'yearly') {
    return result('review_before_renewal', 'An active annual contract makes the renewal date the safest decision point.', [
      'You reported that the subscription is currently under contract.',
      'Reviewing the terms before renewal avoids implying that it can be cancelled immediately.',
    ], { score, confidence, shouldShowAlternatives: Boolean(review.considerCheaper || review.considerFree) });
  }

  if (item.category === 'cloud' && item.importance === 'essential') {
    return result(item.usage === 'never' ? 'keep_review_plan' : 'keep', 'Essential backup value is not measured by how often you open the service.', [
      'You marked this cloud or backup service as essential.',
      item.usage === 'never' ? 'Low visible usage may be normal for an automatic backup, but the plan is still worth checking.' : 'Its importance supports keeping reliable coverage.',
    ], { score: Math.max(score, 58), confidence, shouldShowAlternatives: item.usage === 'never' });
  }

  if (review?.seasonal && item.category === 'streaming') {
    return result('pause_rotate', 'A seasonal service may deliver better value when used only during the months you need it.', [
      'You described this streaming subscription as seasonal.',
      'Pausing or rotating can preserve access without paying continuously.',
    ], { score, confidence, shouldShowAlternatives: false });
  }

  const basicOnly = /\bbasic\b/i.test(review?.neededFeatures || '') || review?.categoryAnswers?.basicFeaturesOnly === true;
  const frequent = ['daily', 'several_per_week', 'weekly'].includes(item.usage);
  if (review && frequent && basicOnly && (review.considerCheaper || review.considerFree)) {
    return result('downgrade', 'You use the service often, but the features you need may fit a simpler plan.', [
      'Frequent use supports keeping access.',
      'You said basic features are enough and that you would consider a lower-cost option.',
    ], { score, confidence, shouldShowAlternatives: true });
  }

  if (review?.overlap) {
    const canSwitch = review.switchingDifficulty !== 'difficult';
    return result(canSwitch ? 'replace' : 'keep_review_plan', canSwitch ? 'Another service may already cover the same need.' : 'The overlap matters, but switching may be difficult.', [
      'You reported paying for another service with similar capabilities.',
      canSwitch ? 'Your switching difficulty does not appear to be high.' : 'You reported that changing services would be difficult.',
    ], { score, confidence, shouldShowAlternatives: canSwitch || Boolean(review.considerCheaper || review.considerFree) });
  }

  if (item.usage === 'never' && item.importance === 'not_important' && review?.householdUse === false && !review.activeContract) {
    return result('strong_cancellation_candidate', 'The answers provide several consistent reasons to review cancellation.', [
      'You reported no use and marked the service as not important.',
      'No one else in the household uses it, and you reported no active contract.',
    ], { score: Math.min(score, DECISION_THRESHOLDS.cancel), confidence: 'high', shouldShowAlternatives: Boolean(review.considerCheaper || review.considerFree) });
  }

  if (review?.householdUse && ['never', 'less_than_monthly'].includes(item.usage)) {
    return result('keep_review_plan', 'Household use changes the value calculation beyond your personal usage.', [
      'You reported that someone else in your household uses the service.',
      'The plan may still be worth reviewing even though your own use is low.',
    ], { score: Math.max(score, 35), confidence, shouldShowAlternatives: Boolean(review.considerCheaper || review.considerFree) });
  }

  if (!review && ['never', 'less_than_monthly'].includes(item.usage) && !['essential', 'important'].includes(item.importance)) {
    return result('more_information_needed', 'Low usage suggests a review, but a few more answers would make the recommendation safer.', [
      'You reported limited personal usage.',
      'Household use, contracts, overlap, and switching difficulty are not known yet.',
    ], { score, confidence: 'low', shouldShowAlternatives: false });
  }

  if (score >= DECISION_THRESHOLDS.keep) {
    return result('keep', 'Your current answers support keeping this subscription.', [
      'Your usage and importance ratings indicate continuing value.',
      costReason || `The estimated annual cost is based on the ${item.cycle} price you entered.`,
    ], { score, confidence, shouldShowAlternatives: false });
  }

  if (score >= DECISION_THRESHOLDS.review) {
    return result('keep_review_plan', 'The service may still be useful, but the current plan deserves a closer look.', [
      'Your answers show a mixed balance between value and cost.',
      costReason || 'A detailed review can account for household use, overlap, and switching difficulty.',
    ], { score, confidence, shouldShowAlternatives: Boolean(review?.considerCheaper || review?.considerFree) });
  }

  return result('more_information_needed', 'The quick audit raises questions without enough evidence for a strong action.', [
    'Usage and importance are both relatively low.',
    'Complete the detailed review before deciding whether to switch or cancel.',
  ], { score, confidence: 'low', shouldShowAlternatives: false, warnings: cost > 0 ? [] : ['A zero price means there is no direct cost saving to calculate.'] });
}
