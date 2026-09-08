export const APP_CONFIG = Object.freeze({
  brandName: 'FeeVeto',
  slogan: 'Keep, switch, or cancel with confidence.',
  description:
    'A private subscription audit that helps you understand recurring costs, decide what is worth keeping, and discover verified alternatives.',
  schemaVersion: 2,
  storageKey: 'feeveto_state_v2',
  migrationMarkerKey: 'feeveto_subkiller_migration_v2',
  legacyStateKey: 'subkiller_state',
  legacySubscriptionsKey: 'subkiller_subscriptions',
  legacyCurrencyKey: 'subkiller_currency',
  defaultCurrency: 'USD',
  repositoryUrl: 'https://github.com/Asvenor/FeeVeto-Be-smarter-about-subscriptions',
});

export const CURRENCY_OPTIONS = Object.freeze([
  ['USD', 'USD ($)'],
  ['EUR', 'EUR (€)'],
  ['GBP', 'GBP (£)'],
  ['CHF', 'CHF'],
]);

export const CURRENCIES = Object.freeze(CURRENCY_OPTIONS.map(([currency]) => currency));

export const BILLING_CYCLES = Object.freeze([
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
  ['yearly', 'Yearly'],
]);

export const USAGE_OPTIONS = Object.freeze([
  ['daily', 'Daily'],
  ['several_per_week', 'Several times per week'],
  ['weekly', 'Weekly'],
  ['several_per_month', 'Several times per month'],
  ['monthly', 'Monthly'],
  ['less_than_monthly', 'Less than monthly'],
  ['never', 'Never'],
]);

export const IMPORTANCE_OPTIONS = Object.freeze([
  ['essential', 'Essential'],
  ['important', 'Important'],
  ['useful', 'Useful'],
  ['nice_to_have', 'Nice to have'],
  ['not_important', 'Not important'],
]);

export const CATEGORY_OPTIONS = Object.freeze([
  ['streaming', 'Streaming and entertainment'],
  ['software', 'Software and productivity'],
  ['cloud', 'Cloud storage and backup'],
  ['fitness', 'Fitness and health'],
  ['gaming', 'Gaming'],
  ['learning', 'News and learning'],
  ['shopping', 'Shopping and memberships'],
  ['other', 'Other'],
]);

export const STATUS_OPTIONS = Object.freeze([
  ['active', 'Active'],
  ['trial', 'Free trial'],
  ['cancelled', 'Cancelled'],
]);

export function optionLabel(options, value) {
  return options.find(([key]) => key === value)?.[1] || value;
}
