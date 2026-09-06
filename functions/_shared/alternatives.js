import { PRODUCT_TYPE_IDS, SERVICE_IDS, serviceById } from '../../js/serviceCatalog.js';

const PRICING_MODELS = new Set(['free', 'subscription', 'one_time']);
const RELATIONSHIPS = new Set(['replacement', 'downgrade']);
const AFFILIATE_STATUSES = new Set(['not_applied']);
const AVAILABILITY = new Set(['worldwide', 'limited', 'unknown']);
const PLATFORMS = new Set(['web', 'windows', 'macos', 'linux', 'ios', 'android', 'smart_tv', 'game_console']);

function text(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function stringList(value, maxItems = 20, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeRecommendationQuery(value) {
  if (!value || typeof value !== 'object' || !SERVICE_IDS.includes(value.serviceId)) return null;
  const service = serviceById(value.serviceId);
  const requirementIds = new Set(service.requirements.map(([id]) => id));
  const mustHave = stringList(value.mustHave).filter((id) => requirementIds.has(id));
  const niceToHave = stringList(value.niceToHave).filter((id) => requirementIds.has(id) && !mustHave.includes(id));
  const country = /^[A-Za-z]{2}$/.test(text(value.country, 2)) ? text(value.country, 2).toUpperCase() : '';
  const platform = PLATFORMS.has(value.platform) ? value.platform : '';
  const rawStorage = value.storageRequiredGb;
  const storage = rawStorage === null || rawStorage === undefined || rawStorage === '' ? Number.NaN : Number(rawStorage);
  return {
    serviceId: service.id,
    productType: PRODUCT_TYPE_IDS.includes(value.productType) ? value.productType : service.productType,
    mustHave,
    niceToHave,
    country,
    platform,
    acceptAds: value.acceptAds === true,
    acceptFreeLimits: value.acceptFreeLimits === true,
    storageRequiredGb: Number.isFinite(storage) && storage >= 0 && storage <= 100_000 ? storage : null,
  };
}

export function validateOffer(value) {
  if (!value || typeof value !== 'object') return null;
  const officialUrl = httpsUrl(value.officialUrl);
  const pricingUrl = value.pricingUrl ? httpsUrl(value.pricingUrl) : '';
  const sourceUrls = stringList(value.sourceUrls, 8, 500).map(httpsUrl).filter(Boolean);
  const relevantServices = stringList(value.relevantServices).filter((id) => SERVICE_IDS.includes(id));
  const productType = PRODUCT_TYPE_IDS.includes(value.productType) ? value.productType : '';
  const pricingModel = PRICING_MODELS.has(value.pricingModel) ? value.pricingModel : '';
  const relationship = RELATIONSHIPS.has(value.relationship) ? value.relationship : '';
  const availabilityStatus = AVAILABILITY.has(value.countryAvailability?.status) ? value.countryAvailability.status : '';
  const countries = stringList(value.countryAvailability?.countries).filter((country) => /^[A-Z]{2}$/.test(country));
  const platforms = stringList(value.platforms).filter((platform) => PLATFORMS.has(platform));
  if (!text(value.id, 80) || !text(value.productName, 80) || !text(value.planName, 80) || !text(value.description)
    || !officialUrl || !sourceUrls.length || !relevantServices.length || !productType || !pricingModel || !relationship
    || !availabilityStatus || !/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedAt) || !AFFILIATE_STATUSES.has(value.affiliateStatus)
    || value.affiliateUrl !== null || (pricingModel === 'free' && value.trialOnly === true)) return null;
  if (availabilityStatus === 'limited' && !countries.length) return null;
  return {
    id: text(value.id, 80), productName: text(value.productName, 80), planName: text(value.planName, 80),
    providerServiceId: SERVICE_IDS.includes(value.providerServiceId) ? value.providerServiceId : '',
    relevantServices, productType, description: text(value.description), pricingModel, relationship,
    features: stringList(value.features), limitations: stringList(value.limitations, 8, 160), platforms,
    countryAvailability: { status: availabilityStatus, countries },
    advertisements: value.advertisements === true ? true : value.advertisements === false ? false : null,
    storageGb: Number.isFinite(Number(value.storageGb)) && Number(value.storageGb) >= 0 ? Number(value.storageGb) : null,
    freePlanLimits: value.freePlanLimits === true, officialUrl, pricingUrl: pricingUrl || null,
    sourceUrls, verifiedAt: value.verifiedAt, affiliateUrl: null, affiliateStatus: 'not_applied', trialOnly: false,
  };
}

function compatibility(offer, query) {
  if (!offer.relevantServices.includes(query.serviceId) || offer.productType !== query.productType) return null;
  if (offer.providerServiceId === query.serviceId && offer.relationship !== 'downgrade') return null;
  if (!query.mustHave.every((feature) => offer.features.includes(feature))) return null;
  if (query.storageRequiredGb !== null && (offer.storageGb === null || offer.storageGb < query.storageRequiredGb)) return null;
  if (offer.advertisements === true && !query.acceptAds) return null;
  if (offer.pricingModel === 'free' && offer.freePlanLimits && !query.acceptFreeLimits) return null;
  if (query.country && offer.countryAvailability.status === 'limited' && !offer.countryAvailability.countries.includes(query.country)) return null;
  if (query.platform && offer.platforms.length && !offer.platforms.includes(query.platform)) return null;

  const verification = [];
  if (query.country && offer.countryAvailability.status === 'unknown') verification.push('Confirm availability in your country with the provider.');
  if (query.platform && !offer.platforms.length) verification.push('Confirm support for your required platform with the provider.');
  if (offer.advertisements === null && !query.acceptAds) verification.push('Confirm whether advertisements are present.');
  const preferredMatches = query.niceToHave.filter((feature) => offer.features.includes(feature));
  let rankScore = query.mustHave.length * 40 + preferredMatches.length * 12 - offer.limitations.length * 2 - verification.length * 8;
  if (offer.providerServiceId === query.serviceId) rankScore += 4;
  return { verification, preferredMatches, rankScore };
}

function relationshipFor(offer, query) {
  return offer.providerServiceId === query.serviceId ? 'downgrade' : 'replacement';
}

function pricingLabel(offer, query) {
  if (relationshipFor(offer, query) === 'downgrade') return 'Downgrade option';
  if (offer.pricingModel === 'free') return 'Free plan';
  if (offer.pricingModel === 'one_time') return 'One-time purchase';
  return 'Paid alternative';
}

function resultFor(offer, query, match) {
  const supported = [...new Set([...query.mustHave, ...match.preferredMatches])];
  const relationship = relationshipFor(offer, query);
  const why = supported.length
    ? `Matches ${supported.length} of the requirements you selected without claiming unverified savings.`
    : relationship === 'downgrade' ? 'Keeps you with the same provider on a lower or free plan.' : 'Solves the same core product need.';
  return {
    id: offer.id,
    productName: offer.productName,
    planName: offer.planName,
    pricingLabel: pricingLabel(offer, query),
    pricingModel: offer.pricingModel,
    relationship,
    description: offer.description,
    whyMatches: why,
    supportedRequirements: supported,
    limitations: offer.limitations.slice(0, 2),
    verificationNotes: match.verification,
    verifiedAt: offer.verifiedAt,
    officialUrl: offer.officialUrl,
    actionLabel: offer.pricingModel === 'free' ? 'View free plan' : offer.pricingUrl ? 'Check current pricing' : 'Visit official website',
  };
}

export function selectRecommendations(catalogue, rawQuery, { premiumAccess = false } = {}) {
  const query = normalizeRecommendationQuery(rawQuery);
  if (!query) return { accessScope: premiumAccess ? 'complete' : 'public', items: [], message: 'Choose one of the six supported services.' };
  const seen = new Set();
  const matches = [];
  for (const rawOffer of Array.isArray(catalogue) ? catalogue : []) {
    const offer = validateOffer(rawOffer);
    if (!offer || seen.has(offer.id)) continue;
    seen.add(offer.id);
    if (!premiumAccess && offer.pricingModel === 'free') continue;
    const match = compatibility(offer, query);
    if (match) matches.push({ offer, match });
  }
  const items = matches
    .sort((left, right) => right.match.rankScore - left.match.rankScore || left.offer.productName.localeCompare(right.offer.productName))
    .slice(0, 3)
    .map(({ offer, match }) => resultFor(offer, query, match));
  let message = items.length ? '' : 'No verified alternative matches these requirements yet.';
  if (!premiumAccess && !items.length) message += ' Sign in with eligible access to include free plans in the complete comparison.';
  return { accessScope: premiumAccess ? 'complete' : 'public', items, message };
}
