import { PRODUCT_TYPE_IDS, SERVICE_IDS, serviceById } from './serviceCatalog.js';

const BOOLEAN_CATEGORY_FIELDS = Object.freeze({
  streaming: ['exclusiveContent', 'rotateServices'],
  software: ['basicFeaturesOnly', 'collaborationRequired', 'proprietaryFormat', 'openSourceAcceptable'],
  cloud: ['criticalBackup', 'includedElsewhere'],
  fitness: ['payPerVisitCheaper'],
  gaming: ['multiplayerRequired', 'includedGamesUsed', 'pausePractical'],
});

export function booleanChoice(formData, name) {
  const value = formData.get(name);
  return value === 'true' ? true : value === 'false' ? false : null;
}

export function requirementChoices(formData, serviceId) {
  const mustHaveRequirements = [];
  const niceToHaveRequirements = [];
  const notNeededRequirements = [];
  for (const [id] of serviceById(serviceId)?.requirements || []) {
    const choice = formData.get(`requirement_${id}`);
    if (choice === 'must') mustHaveRequirements.push(id);
    if (choice === 'nice') niceToHaveRequirements.push(id);
    if (choice === 'not_needed') notNeededRequirements.push(id);
  }
  return { mustHaveRequirements, niceToHaveRequirements, notNeededRequirements };
}

export function categoryAnswersFrom(formData, category) {
  const answers = {};
  for (const name of BOOLEAN_CATEGORY_FIELDS[category] || []) answers[name] = booleanChoice(formData, name);
  if (category === 'cloud') answers.storageUsed = String(formData.get('storageUsed') || '').trim().slice(0, 40);
  if (category === 'fitness') {
    const raw = String(formData.get('timesPerMonth') || '').trim();
    const value = Number(raw);
    answers.timesPerMonth = raw && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }
  return answers;
}

export function buildDetailedReview(formData, completedAt = new Date().toISOString()) {
  const serviceId = SERVICE_IDS.includes(formData.get('serviceId')) ? formData.get('serviceId') : '';
  const productType = PRODUCT_TYPE_IDS.includes(formData.get('productType')) ? formData.get('productType') : '';
  const category = String(formData.get('category') || 'other');
  const rawStorage = String(formData.get('storageRequiredGb') || '').trim();
  const storage = Number(rawStorage);
  const country = String(formData.get('country') || '').trim().toUpperCase();
  const adsApply = ['streaming_video', 'ai_assistant'].includes(productType);
  return {
    satisfaction: String(formData.get('satisfaction') || ''),
    householdUse: booleanChoice(formData, 'householdUse'),
    overlap: booleanChoice(formData, 'overlap'),
    switchingDifficulty: String(formData.get('switchingDifficulty') || ''),
    considerCheaper: booleanChoice(formData, 'considerCheaper'),
    considerFree: booleanChoice(formData, 'considerFree'),
    acceptAds: adsApply ? booleanChoice(formData, 'acceptAds') : null,
    acceptFreeLimits: serviceId ? booleanChoice(formData, 'acceptFreeLimits') : null,
    seasonal: booleanChoice(formData, 'seasonal'),
    activeContract: booleanChoice(formData, 'activeContract'),
    serviceId,
    productType,
    country: serviceId && /^[A-Z]{2}$/.test(country) ? country : '',
    platform: serviceId ? String(formData.get('platform') || '') : '',
    storageRequiredGb: productType === 'cloud_storage' && rawStorage && Number.isFinite(storage) && storage >= 0 && storage <= 100_000 ? storage : null,
    ...requirementChoices(formData, serviceId),
    neededFeatures: String(formData.get('neededFeatures') || '').trim().slice(0, 240),
    categoryAnswers: categoryAnswersFrom(formData, category),
    completedAt,
  };
}

export function requirementsComplete(review) {
  const service = serviceById(review?.serviceId);
  if (!service || service.productType !== review?.productType) return false;
  const requirements = service.requirements;
  if (!requirements.length) return false;
  const answered = new Set([
    ...(review.mustHaveRequirements || []),
    ...(review.niceToHaveRequirements || []),
    ...(review.notNeededRequirements || []),
  ]);
  return requirements.every(([id]) => answered.has(id));
}

export function upsertSubscription(subscriptions, item) {
  const index = subscriptions.findIndex((entry) => entry.id === item.id);
  if (index < 0) return [...subscriptions, item];
  return subscriptions.map((entry, itemIndex) => itemIndex === index ? item : entry);
}

export function categoryForProductType(productType) {
  if (productType === 'streaming_video') return 'streaming';
  if (productType === 'cloud_storage') return 'cloud';
  if (['graphic_design', 'photo_editor', 'ai_assistant'].includes(productType)) return 'software';
  return '';
}
