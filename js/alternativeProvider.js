import { supportedServiceFor } from './serviceCatalog.js';

export class AlternativesProvider {
  async getAlternatives() {
    throw new Error('AlternativesProvider.getAlternatives must be implemented.');
  }
}

export function recommendationRequestFor(subscription) {
  const review = subscription?.detailedReview;
  const service = supportedServiceFor(subscription);
  if (!review || !service) return null;
  return {
    serviceId: service.id,
    productType: review.productType || service.productType,
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

function normalizeResponse(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) throw new Error('The alternatives response was invalid.');
  return {
    accessScope: value.accessScope === 'complete' ? 'complete' : 'public',
    message: String(value.message || ''),
    items: value.items.filter((item) => officialDestination(item)).slice(0, 3),
  };
}

export class BackendAlternativesProvider extends AlternativesProvider {
  constructor(fetchImplementation = window.fetch.bind(window)) {
    super();
    this.fetchImplementation = fetchImplementation;
  }

  async getAlternatives(subscription, token = '') {
    const query = recommendationRequestFor(subscription);
    if (!query) return { accessScope: 'public', items: [], message: 'This service is not supported for curated alternatives yet. The basic audit is still available.' };
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.fetchImplementation('./api/alternatives/recommendations', {
      method: 'POST', headers, body: JSON.stringify(query), cache: 'no-store', credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(response.status === 503 ? 'The private alternatives catalogue is not configured yet.' : 'Alternatives could not be loaded.');
    return normalizeResponse(await response.json());
  }
}
