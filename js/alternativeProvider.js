import { annualCost } from './calculations.js';
import { VERIFIED_ALTERNATIVES } from '../data/alternatives.js';

export class AlternativesProvider {
  getAlternatives() {
    throw new Error('AlternativesProvider.getAlternatives must be implemented.');
  }
}

function normalizedTags(values = []) {
  return new Set(values.map((value) => String(value).trim().toLocaleLowerCase()).filter(Boolean));
}

function verified(item) {
  if (!item || !item.id || !item.serviceName || !item.description || !item.url || !item.lastVerified) return false;
  if (!['free', 'cheaper', 'one-time', 'downgrade'].includes(item.alternativeType)) return false;
  try {
    const url = new URL(item.url);
    return ['http:', 'https:'].includes(url.protocol) && /^\d{4}-\d{2}-\d{2}$/.test(item.lastVerified);
  } catch {
    return false;
  }
}

function annualAlternativeCost(item) {
  if (Number.isSafeInteger(item.yearlyPriceMinor) && item.yearlyPriceMinor >= 0) return item.yearlyPriceMinor;
  if (Number.isSafeInteger(item.monthlyPriceMinor) && item.monthlyPriceMinor >= 0) return item.monthlyPriceMinor * 12;
  return null;
}

function matchScore(item, subscription, preferences) {
  const tags = normalizedTags(item.featureTags);
  const required = normalizedTags(preferences.requiredFeatures);
  const featureMatches = [...required].filter((tag) => tags.has(tag)).length;
  const preferenceFit = (preferences.considerFree && item.alternativeType === 'free' ? 14 : 0)
    + (preferences.considerCheaper && ['free', 'cheaper', 'downgrade'].includes(item.alternativeType) ? 10 : 0)
    + (preferences.acceptAds === false && item.limitations?.some((value) => /\bads?\b/i.test(value)) ? -12 : 0);
  const categoryFit = item.categories?.includes(subscription.category) ? 18 : 0;
  const switchingFit = item.platforms?.length ? 3 : 0;
  return featureMatches * 25 + preferenceFit + categoryFit + switchingFit;
}

export class LocalAlternativesProvider extends AlternativesProvider {
  constructor(items = VERIFIED_ALTERNATIVES) {
    super();
    this.items = items;
  }

  getAlternatives(subscription, preferences = {}) {
    const required = normalizedTags(preferences.requiredFeatures);
    const currentAnnual = annualCost(subscription.amountMinor, subscription.cycle);
    return this.items
      .filter(verified)
      .filter((item) => item.categories?.includes(subscription.category))
      .filter((item) => !preferences.country || !item.supportedCountries?.length || item.supportedCountries.includes(preferences.country))
      .filter((item) => {
        const tags = normalizedTags(item.featureTags);
        return [...required].every((tag) => tags.has(tag));
      })
      .map((item) => {
        const alternativeAnnual = annualAlternativeCost(item);
        const comparable = alternativeAnnual !== null && currentAnnual !== null && item.currency === subscription.currency;
        return {
          ...item,
          estimatedAnnualSavingsMinor: comparable && alternativeAnnual < currentAnnual ? currentAnnual - alternativeAnnual : null,
          rankScore: matchScore(item, subscription, preferences),
        };
      })
      .sort((left, right) => right.rankScore - left.rankScore || left.serviceName.localeCompare(right.serviceName));
  }
}
