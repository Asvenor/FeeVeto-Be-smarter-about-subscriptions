import { requirementLabel } from '../../js/serviceCatalog.js';

// Percentage = weighted share of explicitly selected priorities with verified
// support. Unknown facts earn no credit, not a guessed halfway score. Dimensions
// omitted by the user are absent from the denominator. Eligibility runs first.
export const MATCH_MODEL = 'verified-priority-coverage-v1';
export function feeVetoMatch(offer, query, { stale = false } = {}) {
  const factors = [];
  const add = (group, weight, status, reason) => factors.push({ group, weight, status, reason });
  const feature = id => offer.features.includes(id) ? 'supported' : offer.unsupportedFeatures.includes(id) ? 'unsupported' : 'unknown';
  for (const [ids, group, weight] of [[query.mustHave, 'essentials', 40], [query.niceToHave, 'preferences', 20]]) {
    for (const id of ids) {
      const status = feature(id), label = requirementLabel(query.serviceId, id);
      add(group, weight / ids.length, status, status === 'supported' ? `Supports ${label}.` : status === 'unsupported' ? `Does not include ${label}.` : `Still needs confirmation: ${label}.`);
    }
  }
  if (query.platform) add('platform', 10, offer.platforms.length ? 'supported' : 'unknown', offer.platforms.length ? `Works on your selected platform (${query.platform.replaceAll('_', ' ')}).` : 'Your selected platform is not verified.');
  // An inferred currency market is not an answer about where the person lives.
  if (query.country) add('country', 10, offer.countryAvailability.status === 'unknown' ? 'unknown' : 'supported', offer.countryAvailability.status === 'unknown' ? 'Availability in your country is not verified.' : `Available in your selected country (${query.country}).`);
  const budgetConfirmed = offer.pricingModel === 'free' || (offer.priceMinor !== null && offer.priceCurrency === query.budgetCurrency && ['monthly', 'yearly'].includes(offer.billingInterval) && !offer.introductoryTerms && !stale);
  if ((query.includeFree === true && query.includePaid === false) || (query.includeFree === false && query.includePaid === true)) {
    add('price_preference', 10, 'supported', offer.pricingModel === 'free' ? 'Fits your preference for a free plan.' : 'Fits your preference for a paid option.');
  }
  if (query.budgetMinor !== null) {
    add('budget', 10, budgetConfirmed ? 'supported' : 'unknown', budgetConfirmed ? 'Fits the monthly budget you selected.' : 'Price, currency or billing terms prevent confirming your budget.');
  }
  if (query.storageRequiredGb !== null) add('capacity', 20, offer.storageGb === null ? 'unknown' : 'supported', offer.storageGb === null ? 'Required storage capacity is not verified.' : 'Includes at least the storage capacity you require.');
  if (query.acceptAds !== null) add('limits', 5, offer.advertisements === null ? 'unknown' : 'supported', offer.advertisements === null ? 'Advertising policy is not verified.' : offer.advertisements ? 'Advertising is within the limits you accepted.' : 'No advertising is recorded for this plan.');
  if (query.acceptFreeLimits !== null && offer.pricingModel === 'free') add('limits', 5, offer.freePlanLimits ? 'supported' : 'unknown', offer.freePlanLimits ? 'Free-plan limits are within your stated preference; read the specific limits.' : 'No free-plan limits are recorded; confirm current terms.');
  if (query.switchingTolerance && query.switchingTolerance !== 'any') add('switching', 5, offer.switchingDifficulty === 'unknown' ? 'unknown' : 'supported', offer.switchingDifficulty === 'unknown' ? 'Switching effort is not verified.' : 'Recorded switching effort fits your tolerance.');
  const criticalUnknown = query.mustHave.some(id => feature(id) !== 'supported')
    || (query.platform && !offer.platforms.length) || (query.country && offer.countryAvailability.status === 'unknown')
    || (query.storageRequiredGb !== null && offer.storageGb === null)
    || (query.budgetMinor !== null && !budgetConfirmed)
    || (query.acceptAds === false && offer.advertisements === null)
    || (query.acceptFreeLimits === false && offer.pricingModel === 'free' && !offer.freePlanLimits)
    || Boolean(query.requiredTitle || query.requiredGame || query.specificSubject)
    || (query.requiredServerCountry && !offer.serverCountries.length)
    || (query.targetLanguage && !offer.languages.length) || (query.learnerLevel && !offer.levels.length);
  const groups = new Set(factors.map(f => ['essentials', 'preferences'].includes(f.group) ? 'features' : ['budget', 'price_preference'].includes(f.group) ? 'price' : f.group));
  const meaningful = query.mustHave.length + query.niceToHave.length > 0 && groups.size >= 3;
  const total = factors.reduce((sum, f) => sum + f.weight, 0);
  const credit = factors.filter(f => f.status === 'supported').reduce((sum, f) => sum + f.weight, 0);
  const score = meaningful && !criticalUnknown && !stale ? Math.round(100 * credit / total) : null;
  return {
    model: MATCH_MODEL, score,
    label: score === null ? (factors.length ? 'Potential match' : 'General match') : 'FeeVeto Match',
    meaning: 'The share of your selected priorities supported by checked facts. Unconfirmed priorities receive no credit. Not a customer rating or a guarantee.',
    reason: stale ? 'The catalogue record needs rechecking before scoring.' : criticalUnknown ? 'An important requirement still needs verification.' : !meaningful ? 'Add feature priorities and at least two other relevant preferences for a meaningful personal score.' : '',
    factors: factors.map(({ status, reason }) => ({ status, reason })),
  };
}
