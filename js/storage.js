import {
  APP_CONFIG,
  BILLING_CYCLES,
  CATEGORY_OPTIONS,
  CURRENCIES,
  IMPORTANCE_OPTIONS,
  STATUS_OPTIONS,
  USAGE_OPTIONS,
} from './config.js';
import { PRODUCT_TYPE_IDS, SERVICE_IDS, serviceById, requirementsForProductType } from './serviceCatalog.js';

const validValues = (options) => new Set(options.map(([value]) => value));
const CYCLES = validValues(BILLING_CYCLES);
const USAGE = validValues(USAGE_OPTIONS);
const IMPORTANCE = validValues(IMPORTANCE_OPTIONS);
const CATEGORIES = validValues(CATEGORY_OPTIONS);
const STATUSES = validValues(STATUS_OPTIONS);
const MAX_AMOUNT_MINOR = 999_999_999;
// Import-only safeguards: do not truncate or reject records already saved on the
// device. A backup is validated completely before the caller replaces its audit.
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_SUBSCRIPTIONS = 1000;
const BACKUP_SIZE_ERROR = 'That backup is larger than the 5 MiB import limit. Choose a smaller backup. Your current audit has not been replaced.';

function safeRead(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function safeWrite(storage, key, value) {
  try { storage.setItem(key, value); return true; } catch { return false; }
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function validDate(value) {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : '';
}

function validUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function idFor(item) {
  return String(item.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export function normalizeDetailedReview(value) {
  if (!value || typeof value !== 'object') return null;
  const text = (input, max = 240) => String(input || '').trim().slice(0, max);
  const booleanOrNull = (input) => (typeof input === 'boolean' ? input : null);
  const rawCategory = value.categoryAnswers && typeof value.categoryAnswers === 'object' ? value.categoryAnswers : {};
  const booleanCategoryKeys = ['exclusiveContent', 'rotateServices', 'adSupportedPlan', 'basicFeaturesOnly', 'collaborationRequired', 'proprietaryFormat', 'openSourceAcceptable', 'criticalBackup', 'includedElsewhere', 'payPerVisitCheaper', 'multiplayerRequired', 'includedGamesUsed', 'pausePractical'];
  const categoryAnswers = Object.fromEntries(booleanCategoryKeys.map((key) => [key, booleanOrNull(rawCategory[key])]));
  categoryAnswers.storageUsed = text(rawCategory.storageUsed, 40);
  categoryAnswers.timesPerMonth = rawCategory.timesPerMonth !== null && rawCategory.timesPerMonth !== '' && Number.isFinite(Number(rawCategory.timesPerMonth))
    ? Math.max(0, Math.min(100, Number(rawCategory.timesPerMonth)))
    : null;
  const serviceId = SERVICE_IDS.includes(value.serviceId) ? value.serviceId : '';
  const allowedRequirements = new Set(requirementsForProductType(value.productType || serviceById(serviceId)?.productType).map(([id]) => id));
  const requirementList = (input) => Array.isArray(input)
    ? [...new Set(input.map((item) => text(item, 80)).filter((item) => allowedRequirements.has(item)))].slice(0, 12)
    : [];
  const mustHaveRequirements = requirementList(value.mustHaveRequirements);
  const niceToHaveRequirements = requirementList(value.niceToHaveRequirements).filter((item) => !mustHaveRequirements.includes(item));
  const notNeededRequirements = requirementList(value.notNeededRequirements)
    .filter((item) => !mustHaveRequirements.includes(item) && !niceToHaveRequirements.includes(item));
  const rawStorageRequired = value.storageRequiredGb;
  const storageRequired = rawStorageRequired === null || rawStorageRequired === undefined || rawStorageRequired === '' ? Number.NaN : Number(rawStorageRequired);
  return {
    satisfaction: ['very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied'].includes(value.satisfaction) ? value.satisfaction : '',
    householdUse: booleanOrNull(value.householdUse),
    overlap: booleanOrNull(value.overlap),
    switchingDifficulty: ['easy', 'manageable', 'difficult'].includes(value.switchingDifficulty) ? value.switchingDifficulty : '',
    considerCheaper: booleanOrNull(value.considerCheaper),
    considerFree: booleanOrNull(value.considerFree),
    acceptAds: booleanOrNull(value.acceptAds),
    acceptFreeLimits: booleanOrNull(value.acceptFreeLimits),
    seasonal: booleanOrNull(value.seasonal),
    activeContract: booleanOrNull(value.activeContract),
    serviceId,
    serviceSelectionConfirmed: value.serviceSelectionConfirmed === true,
    productType: PRODUCT_TYPE_IDS.includes(value.productType) ? value.productType : '',
    country: /^[A-Za-z]{2}$/.test(text(value.country, 2)) ? text(value.country, 2).toUpperCase() : '',
    platform: ['web', 'windows', 'macos', 'linux', 'ios', 'android', 'smart_tv', 'game_console'].includes(value.platform) ? value.platform : '',
    storageRequiredGb: Number.isFinite(storageRequired) && storageRequired >= 0 && storageRequired <= 100_000 ? storageRequired : null,
    requiredTitle: text(value.requiredTitle, 80),
    requiredGame: text(value.requiredGame, 80),
    requiredServerCountry: /^[A-Za-z]{2}$/.test(text(value.requiredServerCountry, 2)) ? text(value.requiredServerCountry, 2).toUpperCase() : '',
    targetLanguage: text(value.targetLanguage, 40),
    learnerLevel: ['beginner', 'intermediate', 'advanced'].includes(value.learnerLevel) ? value.learnerLevel : '',
    specificSubject: text(value.specificSubject, 80),
    mustHaveRequirements,
    niceToHaveRequirements,
    notNeededRequirements,
    neededFeatures: text(value.neededFeatures),
    categoryAnswers,
    completedAt: text(value.completedAt, 40),
  };
}

export function normalizeSubscription(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.amountMinor === null || item.amountMinor === undefined || item.amountMinor === '' || typeof item.amountMinor === 'boolean') return null;
  const name = String(item.name || '').trim().slice(0, 80);
  const amountMinor = Number(item.amountMinor);
  if (!name || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > MAX_AMOUNT_MINOR) return null;
  const now = new Date().toISOString();
  return {
    id: idFor(item), name, amountMinor,
    currency: CURRENCIES.includes(item.currency) ? item.currency : APP_CONFIG.defaultCurrency,
    cycle: CYCLES.has(item.cycle) ? item.cycle : 'monthly',
    category: CATEGORIES.has(item.category) ? item.category : 'other',
    usage: USAGE.has(item.usage) ? item.usage : 'several_per_month',
    importance: IMPORTANCE.has(item.importance) ? item.importance : 'useful',
    status: STATUSES.has(item.status) ? item.status : 'active',
    renewalDate: validDate(String(item.renewalDate || '')),
    cancellationUrl: validUrl(item.cancellationUrl),
    detailedReview: normalizeDetailedReview(item.detailedReview),
    createdAt: String(item.createdAt || now).slice(0, 40),
    updatedAt: String(item.updatedAt || now).slice(0, 40),
  };
}

export function emptyState(currency = APP_CONFIG.defaultCurrency) {
  return { version: APP_CONFIG.schemaVersion, auditCurrency: CURRENCIES.includes(currency) ? currency : APP_CONFIG.defaultCurrency, subscriptions: [], migration: { legacyCompleted: true } };
}

export function normalizeState(candidate) {
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.subscriptions)) return null;
  const seen = new Set();
  const subscriptions = candidate.subscriptions.map(normalizeSubscription).filter(Boolean).map((item) => {
    if (!seen.has(item.id)) { seen.add(item.id); return item; }
    const replacement = { ...item, id: idFor({}) };
    seen.add(replacement.id);
    return replacement;
  });
  return {
    version: APP_CONFIG.schemaVersion,
    auditCurrency: CURRENCIES.includes(candidate.auditCurrency) ? candidate.auditCurrency : APP_CONFIG.defaultCurrency,
    subscriptions,
    migration: { legacyCompleted: true },
  };
}

const usageMap = { often: 'several_per_week', sometimes: 'several_per_month', rarely: 'less_than_monthly', never: 'never' };
const importanceMap = { essential: 'essential', useful: 'useful', optional: 'nice_to_have' };
const categoryMap = { entertainment: 'streaming', software: 'software', cloud: 'cloud', fitness: 'fitness', gaming: 'gaming', other: 'other' };

function migrateItem(item, currency, oldest = false) {
  const amountMinor = oldest || item.amountMinor === undefined ? Math.round(Number(item.price) * 100) : Number(item.amountMinor);
  return normalizeSubscription({
    ...item, amountMinor, currency,
    cycle: item.cycle === 'annual' ? 'yearly' : item.cycle,
    usage: usageMap[item.usage] || item.usage,
    importance: importanceMap[item.importance] || item.importance,
    category: categoryMap[item.category] || item.category,
    detailedReview: null,
  });
}

export function migrateLegacyData(storage) {
  const currentLegacy = safeParse(safeRead(storage, APP_CONFIG.legacyStateKey));
  const oldestLegacy = safeParse(safeRead(storage, APP_CONFIG.legacySubscriptionsKey));
  const storedLegacyCurrency = safeRead(storage, APP_CONFIG.legacyCurrencyKey);
  const currency = CURRENCIES.includes(currentLegacy?.currency) ? currentLegacy.currency : CURRENCIES.includes(storedLegacyCurrency) ? storedLegacyCurrency : APP_CONFIG.defaultCurrency;
  const source = Array.isArray(currentLegacy?.subscriptions)
    ? currentLegacy.subscriptions.map((item) => migrateItem(item, currency))
    : Array.isArray(oldestLegacy) ? oldestLegacy.map((item) => migrateItem(item, currency, true)) : [];
  const state = emptyState(currency);
  state.subscriptions = source.filter(Boolean);
  return state;
}

export function loadState(storage) {
  const raw = safeRead(storage, APP_CONFIG.storageKey);
  if (raw) {
    const normalized = normalizeState(safeParse(raw));
    return normalized ? { state: normalized, migrated: false, recovered: false, storageAvailable: true } : { state: emptyState(), migrated: false, recovered: true, storageAvailable: true };
  }
  if (safeRead(storage, APP_CONFIG.migrationMarkerKey) === 'complete') return { state: emptyState(), migrated: false, recovered: false, storageAvailable: true };
  const state = migrateLegacyData(storage);
  const migrated = state.subscriptions.length > 0;
  const saved = safeWrite(storage, APP_CONFIG.storageKey, JSON.stringify(state));
  if (saved) safeWrite(storage, APP_CONFIG.migrationMarkerKey, 'complete');
  return { state, migrated, recovered: false, storageAvailable: saved };
}

export function saveState(storage, state) {
  return safeWrite(storage, APP_CONFIG.storageKey, JSON.stringify(normalizeState(state) || emptyState()));
}

export function parseImportedState(text) {
  if (typeof text !== 'string') throw new Error('That file is not valid JSON.');
  // Check characters first so an unexpectedly large string is not copied just
  // to measure it. The byte check also covers non-ASCII names and notes.
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error(BACKUP_SIZE_ERROR);
  const parsed = safeParse(text);
  if (!parsed) throw new Error('That file is not valid JSON.');
  if (Array.isArray(parsed.subscriptions) && parsed.subscriptions.length > MAX_BACKUP_SUBSCRIPTIONS) {
    throw new Error('That backup contains more than 1,000 subscriptions. Choose a smaller backup. Your current audit has not been replaced.');
  }
  const state = normalizeState(parsed);
  if (!state) throw new Error('That file is not a valid FeeVeto backup.');
  if (parsed.subscriptions.some((item) => !CURRENCIES.includes(item?.currency) || !CYCLES.has(item?.cycle))) {
    throw new Error('The backup contains an unknown billing currency or cycle. Your current audit has not been replaced.');
  }
  if (state.subscriptions.length !== parsed.subscriptions.length) throw new Error('Some entries in this backup are invalid. Your current audit has not been replaced.');
  return state;
}

export async function readImportedFile(file) {
  if (!file || typeof file.text !== 'function' || !Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error('That backup could not be read. Your current audit has not been replaced.');
  }
  // File.size is available without loading the contents into browser memory.
  if (file.size > MAX_BACKUP_BYTES) throw new Error(BACKUP_SIZE_ERROR);
  let text;
  try { text = await file.text(); }
  catch { throw new Error('That backup could not be read. Try selecting it again. Your current audit has not been replaced.'); }
  return parseImportedState(text);
}
