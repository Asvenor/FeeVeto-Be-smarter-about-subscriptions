export const CYCLE_FACTORS = Object.freeze({
  weekly: { monthly: 52 / 12, yearly: 52 },
  monthly: { monthly: 1, yearly: 12 },
  quarterly: { monthly: 1 / 3, yearly: 4 },
  yearly: { monthly: 1 / 12, yearly: 1 },
});

export const USES_PER_YEAR = Object.freeze({
  daily: 365,
  several_per_week: 156,
  weekly: 52,
  several_per_month: 30,
  monthly: 12,
  less_than_monthly: 6,
  never: 0,
});

export function toMinorUnits(value) {
  if (String(value ?? '').trim() === '') return null;
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(minor) && minor <= 999_999_999 ? minor : null;
}

export function fromMinorUnits(value) {
  return Number(value) / 100;
}

export function monthlyCost(amountMinor, cycle) {
  const factor = CYCLE_FACTORS[cycle]?.monthly;
  return Number.isSafeInteger(amountMinor) && amountMinor >= 0 && factor ? Math.round(amountMinor * factor) : null;
}

export function annualCost(amountMinor, cycle) {
  const factor = CYCLE_FACTORS[cycle]?.yearly;
  return Number.isSafeInteger(amountMinor) && amountMinor >= 0 && factor ? Math.round(amountMinor * factor) : null;
}

export function estimatedCostPerUse(amountMinor, cycle, usage) {
  const annual = annualCost(amountMinor, cycle);
  const uses = USES_PER_YEAR[usage];
  if (annual === null || !uses) return null;
  return Math.round(annual / uses);
}

export function totalsForCurrency(subscriptions, currency, recommendationFor) {
  const included = subscriptions.filter((item) => item.currency === currency && item.status !== 'cancelled');
  const excludedCount = subscriptions.filter((item) => item.currency !== currency && item.status !== 'cancelled').length;
  return included.reduce((totals, item) => {
    totals.monthlyMinor += monthlyCost(item.amountMinor, item.cycle) || 0;
    totals.annualMinor += annualCost(item.amountMinor, item.cycle) || 0;
    totals.subscriptionCount += 1;
    const result = recommendationFor(item);
    if (result.recommendation === 'strong_cancellation_candidate') totals.potentialSavingsMinor += annualCost(item.amountMinor, item.cycle) || 0;
    if (!['keep', 'cancelled'].includes(result.recommendation)) totals.recommendedActions += 1;
    return totals;
  }, { monthlyMinor: 0, annualMinor: 0, potentialSavingsMinor: 0, subscriptionCount: 0, recommendedActions: 0, excludedCount });
}

export function formatMoney(minor, currency, locale) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(fromMinorUnits(minor || 0));
}

export function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function daysUntil(value, now = new Date()) {
  const target = parseLocalDate(value);
  if (!target) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
