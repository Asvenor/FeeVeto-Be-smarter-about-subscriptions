import { PRODUCT_TYPE_IDS, SERVICE_IDS, serviceById } from '../../js/serviceCatalog.js';

const PRICING_MODELS = new Set(['free', 'subscription', 'one_time']);
const BILLING_INTERVALS = new Set(['monthly', 'yearly', 'varies', 'one_time']);
const RELATIONSHIPS = new Set(['replacement', 'downgrade']);
const AFFILIATE_STATUSES = new Set(['not_applied']);
const AVAILABILITY = new Set(['worldwide', 'limited', 'unknown']);
const SWITCHING_DIFFICULTIES = new Set(['easy', 'moderate', 'complex', 'unknown']);
const LEARNER_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const PLATFORMS = new Set(['web', 'windows', 'macos', 'linux', 'ios', 'android', 'smart_tv', 'game_console']);

export const MATCH_WEIGHTS = Object.freeze({
  MUST_HAVE: 40,
  NICE_TO_HAVE: 12,
  SAME_SERVICE_DOWNGRADE: 4,
  LIMITATION: -2,
  VERIFICATION_NEEDED: -8,
  SWITCHING_MODERATE: -3,
  SWITCHING_COMPLEX: -7,
});

function text(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function nullableText(value, max = 240) {
  const normalized = text(value, max);
  return normalized || null;
}

function stringList(value, maxItems = 24, maxLength = 80) {
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

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function nullableMinorUnits(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 999_999_999 ? number : Number.NaN;
}

function nonOverlappingLists(features, unsupportedFeatures, unknownFeatures) {
  const supported = new Set(features);
  const unsupported = new Set(unsupportedFeatures);
  return !unsupportedFeatures.some((item) => supported.has(item))
    && !unknownFeatures.some((item) => supported.has(item) || unsupported.has(item));
}

export function normalizeRecommendationQuery(value) {
  if (!value || typeof value !== 'object') return null;
  const service = SERVICE_IDS.includes(value.serviceId) ? serviceById(value.serviceId) : null;
  const requestedProductType = PRODUCT_TYPE_IDS.includes(value.productType) ? value.productType : '';
  const productType = service?.productType || requestedProductType;
  if (!productType) return null;
  const requirementIds = new Set(
    SERVICE_IDS
      .map(serviceById)
      .filter((item) => item.productType === productType)
      .flatMap((item) => item.requirements.map(([id]) => id)),
  );
  const mustHave = stringList(value.mustHave).filter((id) => requirementIds.has(id));
  const niceToHave = stringList(value.niceToHave).filter((id) => requirementIds.has(id) && !mustHave.includes(id));
  const notNeeded = stringList(value.notNeeded).filter((id) => requirementIds.has(id) && !mustHave.includes(id) && !niceToHave.includes(id));
  const country = /^[A-Za-z]{2}$/.test(text(value.country, 2)) ? text(value.country, 2).toUpperCase() : '';
  const requiredServerCountry = /^[A-Za-z]{2}$/.test(text(value.requiredServerCountry, 2))
    ? text(value.requiredServerCountry, 2).toUpperCase() : '';
  const platform = PLATFORMS.has(value.platform) ? value.platform : '';
  const rawStorage = value.storageRequiredGb;
  const storage = rawStorage === null || rawStorage === undefined || rawStorage === '' ? Number.NaN : Number(rawStorage);
  return {
    serviceId: service?.id || '',
    productType,
    mustHave,
    niceToHave,
    notNeeded,
    answeredRequirementCount: new Set([...mustHave, ...niceToHave, ...notNeeded]).size,
    requirementCount: requirementIds.size,
    country,
    platform,
    acceptAds: typeof value.acceptAds === 'boolean' ? value.acceptAds : null,
    acceptFreeLimits: typeof value.acceptFreeLimits === 'boolean' ? value.acceptFreeLimits : null,
    includePaid: typeof value.includePaid === 'boolean' ? value.includePaid : null,
    includeFree: typeof value.includeFree === 'boolean' ? value.includeFree : null,
    storageRequiredGb: Number.isFinite(storage) && storage >= 0 && storage <= 100_000 ? storage : null,
    requiredTitle: text(value.requiredTitle, 80),
    requiredGame: text(value.requiredGame, 80),
    requiredServerCountry,
    targetLanguage: text(value.targetLanguage, 40),
    learnerLevel: LEARNER_LEVELS.has(value.learnerLevel) ? value.learnerLevel : '',
    specificSubject: text(value.specificSubject, 80),
  };
}

export function validateOffer(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id, 80);
  const productId = text(value.productId, 80);
  const offerId = text(value.offerId, 80);
  const officialUrl = httpsUrl(value.officialUrl);
  const pricingUrl = value.pricingUrl ? httpsUrl(value.pricingUrl) : '';
  const sourceUrls = stringList(value.sourceUrls, 10, 500).map(httpsUrl).filter(Boolean);
  const relevantServices = stringList(value.relevantServices).filter((serviceId) => SERVICE_IDS.includes(serviceId));
  const productType = PRODUCT_TYPE_IDS.includes(value.productType) ? value.productType : '';
  const allowedFeatureIds = new Set(
    relevantServices.flatMap((serviceId) => serviceById(serviceId)?.requirements.map(([featureId]) => featureId) || []),
  );
  const pricingModel = PRICING_MODELS.has(value.pricingModel) ? value.pricingModel : '';
  const relationship = RELATIONSHIPS.has(value.relationship) ? value.relationship : '';
  const availabilityStatus = AVAILABILITY.has(value.countryAvailability?.status) ? value.countryAvailability.status : '';
  const countries = stringList(value.countryAvailability?.countries).filter((country) => /^[A-Z]{2}$/.test(country));
  const platforms = stringList(value.platforms).filter((platform) => PLATFORMS.has(platform));
  const features = stringList(value.features);
  const unsupportedFeatures = stringList(value.unsupportedFeatures);
  const unknownFeatures = stringList(value.unknownFeatures);
  const priceMinor = nullableMinorUnits(value.priceMinor);
  const priceCurrency = /^[A-Z]{3}$/.test(text(value.priceCurrency, 3)) ? text(value.priceCurrency, 3) : null;
  const billingInterval = BILLING_INTERVALS.has(value.billingInterval) ? value.billingInterval : null;
  const upfrontCommitmentMonths = value.upfrontCommitmentMonths === null || value.upfrontCommitmentMonths === undefined
    ? null : Number(value.upfrontCommitmentMonths);
  const switchingDifficulty = SWITCHING_DIFFICULTIES.has(value.switchingDifficulty) ? value.switchingDifficulty : '';
  const languages = stringList(value.languages, 40, 40);
  const levels = stringList(value.levels).filter((level) => LEARNER_LEVELS.has(level));
  const serverCountries = stringList(value.serverCountries).filter((country) => /^[A-Z]{2}$/.test(country));

  const requiredText = id && productId && offerId && text(value.productName, 80) && text(value.planName, 80) && text(value.description);
  const requiredEnums = productType && pricingModel && relationship && availabilityStatus && switchingDifficulty;
  const validCommitment = upfrontCommitmentMonths === null
    || (Number.isInteger(upfrontCommitmentMonths) && upfrontCommitmentMonths >= 0 && upfrontCommitmentMonths <= 120);
  const validPrice = !Number.isNaN(priceMinor)
    && (priceMinor === null
      ? priceCurrency === null && (value.priceVerifiedAt === null || value.priceVerifiedAt === undefined || value.priceVerifiedAt === '')
      : pricingModel === 'free' || Boolean(priceCurrency))
    && (pricingModel === 'free' ? priceMinor === 0 && billingInterval === null : true)
    && (pricingModel === 'subscription' ? ['monthly', 'yearly', 'varies'].includes(billingInterval) : true)
    && (pricingModel === 'one_time' ? billingInterval === 'one_time' : true)
    && (priceMinor === null || validDate(value.priceVerifiedAt));
  const sameProductType = relevantServices.every((serviceId) => serviceById(serviceId)?.productType === productType);
  const validFeatures = [...features, ...unsupportedFeatures, ...unknownFeatures]
    .every((featureId) => allowedFeatureIds.has(featureId));

  if (!requiredText || !officialUrl || (value.pricingUrl && !pricingUrl) || !sourceUrls.length || !relevantServices.length || !requiredEnums
    || !validDate(value.verifiedAt) || !AFFILIATE_STATUSES.has(value.affiliateStatus) || value.affiliateUrl !== null
    || value.trialOnly === true || (availabilityStatus === 'limited' && !countries.length) || !validCommitment
    || !validPrice || !sameProductType || !validFeatures
    || !nonOverlappingLists(features, unsupportedFeatures, unknownFeatures)) return null;

  return {
    id, productId, offerId,
    productName: text(value.productName, 80), planName: text(value.planName, 80),
    providerServiceId: SERVICE_IDS.includes(value.providerServiceId) ? value.providerServiceId : '',
    relevantServices, productType, description: text(value.description), pricingModel, relationship,
    features, unsupportedFeatures, unknownFeatures,
    limitations: stringList(value.limitations, 10, 180), usageLimits: stringList(value.usageLimits, 10, 180),
    platforms, countryAvailability: { status: availabilityStatus, countries },
    advertisements: value.advertisements === true ? true : value.advertisements === false ? false : null,
    storageGb: Number.isFinite(Number(value.storageGb)) && Number(value.storageGb) >= 0 ? Number(value.storageGb) : null,
    freePlanLimits: value.freePlanLimits === true,
    languages, levels, serverCountries, switchingDifficulty,
    priceMinor, priceCurrency, billingInterval, upfrontCommitmentMonths,
    introductoryTerms: nullableText(value.introductoryTerms, 180),
    renewalTerms: nullableText(value.renewalTerms, 180),
    priceVerifiedAt: priceMinor === null ? null : value.priceVerifiedAt,
    officialUrl, pricingUrl: pricingUrl || null, sourceUrls,
    verifiedAt: value.verifiedAt, affiliateUrl: null, affiliateStatus: 'not_applied', trialOnly: false,
  };
}

function compatibility(offer, query) {
  if (offer.productType !== query.productType) return null;
  if (query.serviceId && !offer.relevantServices.includes(query.serviceId)) return null;
  if (query.serviceId && offer.providerServiceId === query.serviceId && offer.relationship !== 'downgrade') return null;

  const verification = [];
  const supportedMustHave = [];
  for (const feature of query.mustHave) {
    if (offer.unsupportedFeatures.includes(feature)) return null;
    if (offer.features.includes(feature)) supportedMustHave.push(feature);
    else verification.push(`Confirm the must-have requirement “${feature}” with the provider.`);
  }

  if (query.storageRequiredGb !== null) {
    if (offer.storageGb !== null && offer.storageGb < query.storageRequiredGb) return null;
    if (offer.storageGb === null) verification.push('Confirm that the plan has enough storage.');
  }
  if (offer.advertisements === true && query.acceptAds === false) return null;
  if (offer.advertisements === true && query.acceptAds === null) verification.push('This plan includes advertising; confirm that is acceptable.');
  if (offer.advertisements === null && query.acceptAds === false) verification.push('Confirm whether advertisements are present.');
  if (offer.pricingModel === 'free' && offer.freePlanLimits && query.acceptFreeLimits === false) return null;
  if (offer.pricingModel === 'free' && offer.freePlanLimits && query.acceptFreeLimits === null) verification.push('Confirm that the free-plan limits are acceptable.');

  if (query.country) {
    if (offer.countryAvailability.status === 'limited' && !offer.countryAvailability.countries.includes(query.country)) return null;
    if (offer.countryAvailability.status === 'unknown') verification.push('Confirm availability in your country with the provider.');
  }

  if (query.platform) {
    if (offer.platforms.length && !offer.platforms.includes(query.platform)) return null;
    if (!offer.platforms.length) verification.push('Confirm support for your required platform with the provider.');
  }

  if (query.requiredServerCountry) {
    if (offer.serverCountries.length && !offer.serverCountries.includes(query.requiredServerCountry)) return null;
    if (!offer.serverCountries.length) verification.push(`Confirm a server is available in ${query.requiredServerCountry}.`);
  }

  if (query.targetLanguage) {
    const target = query.targetLanguage.toLocaleLowerCase();
    if (offer.languages.length && !offer.languages.some((language) => language.toLocaleLowerCase() === target)) return null;
    if (!offer.languages.length) verification.push(`Confirm support for ${query.targetLanguage}.`);
  }
  if (query.learnerLevel) {
    if (offer.levels.length && !offer.levels.includes(query.learnerLevel)) return null;
    if (!offer.levels.length) verification.push(`Confirm content for the ${query.learnerLevel} level.`);
  }
  if (query.requiredTitle) verification.push(`Confirm that “${query.requiredTitle}” is currently available.`);
  if (query.requiredGame) verification.push(`Confirm that “${query.requiredGame}” is currently included on the required platform.`);
  if (query.specificSubject) verification.push(`Confirm a suitable ${query.specificSubject} course, level, outcomes, and assessment before switching.`);
  const preferredMatches = query.niceToHave.filter((feature) => offer.features.includes(feature));
  for (const feature of query.niceToHave) {
    if (offer.unsupportedFeatures.includes(feature)) verification.push(`This option does not include the preference “${feature}”.`);
    else if (!offer.features.includes(feature)) verification.push(`Confirm the preference “${feature}” with the provider.`);
  }
  if (!query.country) verification.push('Check availability in your country.');
  if (!query.platform) verification.push('Confirm support for your device.');
  if (query.productType === 'cloud_storage' && query.storageRequiredGb === null) {
    verification.push('Check that this plan includes enough storage.');
  }
  const switchingPenalty = offer.switchingDifficulty === 'complex'
    ? MATCH_WEIGHTS.SWITCHING_COMPLEX
    : offer.switchingDifficulty === 'moderate' ? MATCH_WEIGHTS.SWITCHING_MODERATE : 0;
  const rankScore = supportedMustHave.length * MATCH_WEIGHTS.MUST_HAVE
    + preferredMatches.length * MATCH_WEIGHTS.NICE_TO_HAVE
    + (query.serviceId && offer.providerServiceId === query.serviceId ? MATCH_WEIGHTS.SAME_SERVICE_DOWNGRADE : 0)
    + offer.limitations.length * MATCH_WEIGHTS.LIMITATION
    + verification.length * MATCH_WEIGHTS.VERIFICATION_NEEDED
    + switchingPenalty;
  return { verification: [...new Set(verification)], preferredMatches, supportedMustHave, rankScore };
}

function relationshipFor(offer, query) {
  return query.serviceId && offer.providerServiceId === query.serviceId ? 'downgrade' : 'replacement';
}

function pricingLabel(offer, query) {
  if (relationshipFor(offer, query) === 'downgrade') return 'Downgrade option';
  if (offer.pricingModel === 'free') return 'Free plan';
  if (offer.pricingModel === 'one_time') return 'One-time purchase';
  return 'Paid alternative';
}

function resultFor(offer, query, match, tailored) {
  const supported = [...new Set([...match.supportedMustHave, ...match.preferredMatches])];
  const relationship = relationshipFor(offer, query);
  const why = supported.length
    ? `Supports ${supported.length} selected ${supported.length === 1 ? 'requirement' : 'requirements'} based on the verified plan record.`
    : relationship === 'downgrade'
      ? 'Keeps the same provider on a lower or free plan, subject to the limitations shown.'
      : tailored
        ? 'Addresses the same product type and respects the explicit requirements provided so far.'
        : 'Addresses the same product type as your current subscription; confirm the qualifications shown before switching.';
  const confirmed = tailored && match.verification.length === 0;
  return {
    id: offer.id,
    productName: offer.productName,
    planName: offer.planName,
    pricingLabel: pricingLabel(offer, query),
    pricingModel: offer.pricingModel,
    relationship,
    matchStatus: tailored ? (confirmed ? 'matched' : 'candidate') : 'general',
    matchLabel: tailored ? (confirmed ? 'Matches your selected needs' : 'Candidate—needs verification') : 'General suggestion',
    description: offer.description,
    whyMatches: why,
    supportedRequirements: supported,
    limitations: offer.limitations.slice(0, 3),
    usageLimits: offer.usageLimits.slice(0, 3),
    verificationNotes: match.verification,
    switchingDifficulty: offer.switchingDifficulty,
    price: {
      amountMinor: offer.priceMinor,
      currency: offer.priceCurrency,
      billingInterval: offer.billingInterval,
      upfrontCommitmentMonths: offer.upfrontCommitmentMonths,
      introductoryTerms: offer.introductoryTerms,
      renewalTerms: offer.renewalTerms,
      verifiedAt: offer.priceVerifiedAt,
    },
    verifiedAt: offer.verifiedAt,
    officialUrl: offer.officialUrl,
    actionLabel: offer.pricingModel === 'free' ? 'View free plan' : offer.priceMinor === null || offer.pricingUrl ? 'Check current pricing' : 'Visit official website',
  };
}

function hasSelectedNeeds(query) {
  return query.mustHave.length > 0
    || query.niceToHave.length > 0
    || Boolean(query.country || query.platform || query.requiredTitle || query.requiredGame || query.requiredServerCountry
      || query.targetLanguage || query.learnerLevel || query.specificSubject)
    || query.storageRequiredGb !== null
    || [query.acceptAds, query.acceptFreeLimits, query.includePaid, query.includeFree].some((value) => typeof value === 'boolean');
}

function requirementAnswered(query, ids) {
  const answered = new Set([...query.mustHave, ...query.niceToHave, ...query.notNeeded]);
  return ids.some((id) => answered.has(id));
}

function missingDetailsFor(query) {
  const details = [];
  if (query.productType === 'cloud_storage') {
    if (query.storageRequiredGb === null) details.push('Storage capacity');
    if (!query.platform) details.push('Required device or platform');
  } else if (query.productType === 'graphic_design') {
    if (!requirementAnswered(query, ['social_graphics', 'presentations', 'templates', 'background_removal', 'one_click_resize', 'brand_assets'])) details.push('Main design tasks');
    if (!requirementAnswered(query, ['team_collaboration'])) details.push('Collaboration needs');
  } else if (query.productType === 'photo_editor') {
    if (!requirementAnswered(query, ['psd_import_export'])) details.push('PSD or other file-format requirements');
    if (!requirementAnswered(query, ['basic_adjustments', 'layers_masks', 'retouching', 'offline_desktop', 'batch_processing', 'professional_workflow'])) details.push('Editing and offline requirements');
  } else if (query.productType === 'ai_assistant') {
    if (!requirementAnswered(query, ['general_writing', 'coding_chat', 'document_analysis'])) details.push('Main assistant tasks');
    if (!requirementAnswered(query, ['web_research', 'image_generation', 'ide_terminal_agent', 'high_usage_capacity'])) details.push('Required tools such as research, documents, or coding');
  } else if (query.productType === 'streaming_video') {
    if (!query.country) details.push('Country');
    if (!query.requiredTitle && !requirementAnswered(query, ['films', 'series', 'specific_exclusives'])) details.push('Required shows or films');
  } else {
    if (!query.country) details.push('Country');
    if (!query.platform) details.push('Required device or platform');
    if (query.answeredRequirementCount === 0) details.push('Must-have features');
  }
  return details.slice(0, 3);
}

export function selectRecommendations(catalogue, rawQuery, { premiumAccess = false } = {}) {
  const query = normalizeRecommendationQuery(rawQuery);
  const accessScope = premiumAccess ? 'complete' : 'public';
  if (!query) return {
    accessScope, state: 'unsupported', items: [], missingDetails: [],
    message: 'Choose a supported service or a specific supported product type for curated alternatives.',
  };
  const seen = new Set();
  const eligible = [];
  for (const rawOffer of Array.isArray(catalogue) ? catalogue : []) {
    const offer = validateOffer(rawOffer);
    if (!offer || seen.has(offer.id)) continue;
    seen.add(offer.id);
    if (offer.pricingModel === 'free' && query.includeFree === false) continue;
    if (offer.pricingModel !== 'free' && query.includePaid === false) continue;
    const match = compatibility(offer, query);
    if (match) eligible.push({ offer, match });
  }
  const restrictedMatchExists = !premiumAccess && eligible.some(({ offer }) => offer.pricingModel === 'free');
  const matches = premiumAccess ? eligible : eligible.filter(({ offer }) => offer.pricingModel !== 'free');
  const tailored = hasSelectedNeeds(query);
  const items = matches
    .sort((left, right) => right.match.rankScore - left.match.rankScore || left.offer.productName.localeCompare(right.offer.productName))
    .slice(0, 3)
    .map(({ offer, match }) => resultFor(offer, query, match, tailored));
  let state = tailored ? 'matched_suggestions' : 'general_suggestions';
  let message = '';
  if (!items.length && restrictedMatchExists) {
    state = 'access_restricted';
    message = 'No alternatives are available in your current access level for these requirements.';
  } else if (!items.length) {
    state = 'no_matches';
    message = 'No accessible verified alternative meets the requirements you selected. Review them to broaden the comparison if appropriate.';
  }
  return { accessScope, state, items, message, missingDetails: missingDetailsFor(query) };
}
