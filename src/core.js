export const SCHEMA_VERSION = 1;
export const SUPPORTED_CURRENCIES = ['USD', 'CHF', 'EUR', 'GBP'];
export const BILLING_CYCLES = ['weekly', 'monthly', 'yearly'];
export const USAGE_LEVELS = ['often', 'sometimes', 'rarely', 'never'];
export const CATEGORIES = ['entertainment', 'software', 'fitness', 'gaming', 'cloud', 'other'];
export const IMPORTANCE_LEVELS = ['essential', 'useful', 'optional'];
export const STATUSES = ['active', 'trial', 'cancelled'];

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AMOUNT_MINOR = 999_999_999;

export function createSubscriptionId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function toMinorUnits(value) {
  if (String(value ?? '').trim() === '') return null;
  const amount = Number(value);
  const minorUnits = Math.round(amount * 100);
  return Number.isFinite(amount) && amount >= 0 && minorUnits <= MAX_AMOUNT_MINOR ? minorUnits : null;
}

export function fromMinorUnits(value) {
  return Number(value) / 100;
}

export function monthlyEquivalentMinor(amountMinor, cycle) {
  if (cycle === 'weekly') return Math.round((amountMinor * 52) / 12);
  if (cycle === 'yearly') return Math.round(amountMinor / 12);
  return amountMinor;
}

export function yearlyEquivalentMinor(amountMinor, cycle) {
  if (cycle === 'weekly') return amountMinor * 52;
  if (cycle === 'monthly') return amountMinor * 12;
  return amountMinor;
}

export function isValidDateString(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeSubscription(item, { legacy = false } = {}) {
  if (!item || typeof item !== 'object') return null;

  const name = String(item.name || '').trim().slice(0, 80);
  const legacyAmount = legacy || item.amountMinor === undefined ? toMinorUnits(item.price) : null;
  const amountMinor = legacyAmount ?? Number(item.amountMinor);
  const cycle = BILLING_CYCLES.includes(item.cycle) ? item.cycle : 'monthly';
  const usage = USAGE_LEVELS.includes(item.usage) ? item.usage : 'sometimes';
  const category = CATEGORIES.includes(item.category) ? item.category : 'other';
  const importance = IMPORTANCE_LEVELS.includes(item.importance) ? item.importance : 'useful';
  const status = STATUSES.includes(item.status) ? item.status : 'active';
  const renewalDate = isValidDateString(item.renewalDate) ? String(item.renewalDate || '') : '';

  if (!name || !Number.isSafeInteger(amountMinor) || amountMinor < 0) return null;

  return {
    id: String(item.id || createSubscriptionId()),
    name,
    amountMinor,
    cycle,
    usage,
    category,
    importance,
    status,
    renewalDate,
    cancellationUrl: normalizeUrl(item.cancellationUrl),
  };
}

export function normalizeState(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const currency = SUPPORTED_CURRENCIES.includes(candidate.currency) ? candidate.currency : 'USD';
  const normalized = Array.isArray(candidate.subscriptions)
    ? candidate.subscriptions.map((item) => normalizeSubscription(item)).filter(Boolean)
    : [];
  const seenIds = new Set();
  const subscriptions = normalized.map((item) => {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      return item;
    }

    const replacement = { ...item, id: createSubscriptionId() };
    seenIds.add(replacement.id);
    return replacement;
  });

  return { version: SCHEMA_VERSION, currency, subscriptions };
}

export function migrateLegacyState(subscriptions, currency = 'USD') {
  return {
    version: SCHEMA_VERSION,
    currency: SUPPORTED_CURRENCIES.includes(currency) ? currency : 'USD',
    subscriptions: Array.isArray(subscriptions)
      ? subscriptions.map((item) => normalizeSubscription(item, { legacy: true })).filter(Boolean)
      : [],
  };
}

export function recommendationFor(item) {
  if (item.status === 'cancelled') {
    return { label: 'Cancelled', tone: 'neutral', reason: 'This subscription is not included in active spending.' };
  }

  const monthlyMinor = monthlyEquivalentMinor(item.amountMinor, item.cycle);

  if (item.importance === 'essential') {
    if (item.usage === 'never') {
      return { label: 'Review', tone: 'warning', reason: 'You marked this essential but also never used. Check whether it can be replaced.' };
    }
    return { label: 'Keep', tone: 'positive', reason: 'You marked this as essential.' };
  }

  if (item.usage === 'never') {
    return { label: 'Cancel now', tone: 'danger', reason: 'You marked this as never used.' };
  }

  if (item.usage === 'rarely' && item.importance === 'optional') {
    return { label: 'Cancel soon', tone: 'danger', reason: 'It is optional and rarely used.' };
  }

  if (item.usage === 'rarely' || (item.usage === 'sometimes' && item.importance === 'optional' && monthlyMinor >= 2000)) {
    return {
      label: 'Review',
      tone: 'warning',
      reason: monthlyMinor >= 2000 ? 'Its cost is high compared with the usage you reported.' : 'You reported using it rarely.',
    };
  }

  return {
    label: 'Keep',
    tone: 'positive',
    reason: item.usage === 'often' ? 'You reported using it often.' : 'Its usage and importance currently support keeping it.',
  };
}

export function calculateTotals(subscriptions) {
  let totalMonthlyMinor = 0;
  let totalYearlyMinor = 0;
  let possibleYearlySavingsMinor = 0;
  let activeCount = 0;

  for (const item of subscriptions) {
    if (item.status === 'cancelled') continue;

    activeCount += 1;
    const monthlyMinor = monthlyEquivalentMinor(item.amountMinor, item.cycle);
    const yearlyMinor = yearlyEquivalentMinor(item.amountMinor, item.cycle);
    totalMonthlyMinor += monthlyMinor;
    totalYearlyMinor += yearlyMinor;

    const recommendation = recommendationFor(item);
    if (recommendation.label === 'Cancel soon' || recommendation.label === 'Cancel now') {
      possibleYearlySavingsMinor += yearlyMinor;
    }
  }

  return { totalMonthlyMinor, totalYearlyMinor, possibleYearlySavingsMinor, activeCount };
}

export function parseLocalDate(value) {
  if (!isValidDateString(value) || !value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function daysUntil(value, now = new Date()) {
  const date = parseLocalDate(value);
  if (!date) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((date.getTime() - today.getTime()) / DAY_MS);
}

export function upcomingRenewals(subscriptions, now = new Date(), windowDays = 90) {
  return subscriptions
    .filter((item) => item.status !== 'cancelled')
    .map((item) => ({ item, days: daysUntil(item.renewalDate, now) }))
    .filter(({ days }) => days !== null && days >= 0 && days <= windowDays)
    .sort((a, b) => a.days - b.days);
}

export function filterAndSortSubscriptions(subscriptions, { query = '', category = 'all', status = 'all', sort = 'yearly-desc' } = {}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = subscriptions.filter((item) => {
    const matchesQuery = !normalizedQuery || item.name.toLocaleLowerCase().includes(normalizedQuery);
    const matchesCategory = category === 'all' || item.category === category;
    const matchesStatus = status === 'all' || item.status === status;
    return matchesQuery && matchesCategory && matchesStatus;
  });

  return filtered.sort((left, right) => {
    if (sort === 'name-asc') return left.name.localeCompare(right.name);
    if (sort === 'renewal-asc') {
      if (!left.renewalDate) return 1;
      if (!right.renewalDate) return -1;
      return left.renewalDate.localeCompare(right.renewalDate);
    }
    return yearlyEquivalentMinor(right.amountMinor, right.cycle) - yearlyEquivalentMinor(left.amountMinor, left.cycle);
  });
}
