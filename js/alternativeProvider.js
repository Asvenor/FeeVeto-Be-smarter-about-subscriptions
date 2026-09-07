import { CURRENCIES } from './config.js';
import { PRODUCT_TYPE_IDS, supportedServiceFor } from './serviceCatalog.js';

const RESULT_STATES = new Set([
  'general_suggestions',
  'matched_suggestions',
  'unsupported',
  'no_matches',
  'catalogue_unavailable',
  'request_failed',
  'authentication_failed',
  'access_restricted',
]);

export class AlternativeRequestError extends Error {
  constructor(message, resultState = 'request_failed') {
    super(message);
    this.name = 'AlternativeRequestError';
    this.resultState = RESULT_STATES.has(resultState) ? resultState : 'request_failed';
  }
}

export class AlternativeRequestTracker {
  constructor() {
    this.epoch = 0;
    this.versions = new Map();
  }

  begin(id) {
    const version = (this.versions.get(id) || 0) + 1;
    this.versions.set(id, version);
    return { epoch: this.epoch, version };
  }

  isCurrent(id, request) {
    return request?.epoch === this.epoch && request.version === this.versions.get(id);
  }

  invalidate(id) {
    this.versions.set(id, (this.versions.get(id) || 0) + 1);
  }

  invalidateAll() {
    this.epoch += 1;
    this.versions.clear();
  }
}

export class AlternativesProvider {
  async getAlternatives() {
    throw new Error('AlternativesProvider.getAlternatives must be implemented.');
  }
}

export function recommendationRequestFor(subscription, marketCurrency = '') {
  const review = subscription?.detailedReview || {};
  const service = supportedServiceFor(subscription);
  const productType = PRODUCT_TYPE_IDS.includes(review.productType) ? review.productType : service?.productType;
  if (!service && !productType) return null;
  const applicableService = service?.productType === productType ? service : null;
  return {
    serviceId: applicableService?.id || '',
    productType,
    marketCurrency: CURRENCIES.includes(marketCurrency) ? marketCurrency : '',
    mustHave: Array.isArray(review.mustHaveRequirements) ? review.mustHaveRequirements : [],
    niceToHave: Array.isArray(review.niceToHaveRequirements) ? review.niceToHaveRequirements : [],
    notNeeded: Array.isArray(review.notNeededRequirements) ? review.notNeededRequirements : [],
    country: review.country || '',
    platform: review.platform || '',
    acceptAds: review.acceptAds,
    acceptFreeLimits: review.acceptFreeLimits,
    includePaid: review.considerCheaper,
    includeFree: review.considerFree,
    storageRequiredGb: Number.isFinite(review.storageRequiredGb) ? review.storageRequiredGb : null,
    requiredTitle: review.requiredTitle || '',
    requiredGame: review.requiredGame || '',
    requiredServerCountry: review.requiredServerCountry || '',
    targetLanguage: review.targetLanguage || '',
    learnerLevel: review.learnerLevel || '',
    specificSubject: review.specificSubject || '',
  };
}

export function officialDestination(offer) {
  try {
    const url = new URL(offer?.officialUrl);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeAlternativesResponse(value, maxItems = 3) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) throw new Error('The alternatives response was invalid.');
  return {
    accessScope: value.accessScope === 'complete' ? 'complete' : 'public',
    state: RESULT_STATES.has(value.state) ? value.state : (value.items.length ? 'general_suggestions' : 'no_matches'),
    message: String(value.message || ''),
    missingDetails: Array.isArray(value.missingDetails)
      ? value.missingDetails.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : [],
    items: value.items.filter((item) => officialDestination(item)).slice(0, Math.min(12, maxItems)),
    hasMore: value.hasMore === true, total: Number.isInteger(value.total) ? value.total : value.items.length,
    market: value.market || null, provider: 'curated', rankingVersion: value.rankingVersion || 'curated-v3',
  };
}

export class BackendAlternativesProvider extends AlternativesProvider {
  constructor(fetchImplementation = window.fetch.bind(window)) {
    super();
    this.fetchImplementation = fetchImplementation;
  }

  async getAlternatives(subscription, token = '', marketCurrency = '') {
    const query = recommendationRequestFor(subscription, marketCurrency);
    if (!query) return {
      accessScope: 'public', state: 'unsupported', items: [], missingDetails: [],
      message: 'This service or use case is not supported for curated alternatives yet. The basic audit is still available.',
    };
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.fetchImplementation('./api/alternatives/recommendations', {
      method: 'POST', headers, body: JSON.stringify(query), cache: 'no-store', credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
    });
    let body = null;
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      const fallback = response.status === 503 ? 'The alternatives catalogue is unavailable right now.' : 'Alternatives could not be loaded.';
      throw new AlternativeRequestError(String(body?.error || fallback), body?.state);
    }
    return normalizeAlternativesResponse(body);
  }
}
