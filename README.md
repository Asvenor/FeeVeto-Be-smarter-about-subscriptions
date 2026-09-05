# FeeVeto

**Keep, switch, or cancel with confidence.**

FeeVeto is a private subscription audit. It helps people understand recurring costs, decide whether services are worth keeping, and review verified cheaper or free alternatives that fit their needs. It does not connect to banks, detect subscriptions automatically, or cancel services.

## Current features

- Quick audit using price, billing cycle, category, usage, and importance
- Optional detailed review for satisfaction, household use, overlap, contracts, seasonality, switching difficulty, and needed features
- Transparent recommendations with reasons, confidence, and cautious wording
- Weekly, monthly, quarterly, and yearly cost normalization
- Per-subscription currencies without fake exchange-rate conversion
- Monthly and annual totals for the selected audit currency
- Evidence-based potential savings totals
- Add, edit, delete, clear, filter, and search controls
- JSON backup export and import
- Local alternatives provider that displays only sufficiently verified entries
- Device-local storage with one-time migration from the former app formats
- Responsive, keyboard-friendly, reduced-motion interface

## File structure

```text
index.html                    One-page marketing, audit, results, and detailed-review structure
privacy.html                  Plain-language privacy overview
style.css                     Light responsive visual system
js/app.js                     Browser events and application state coordination
js/config.js                  Brand, storage keys, options, and global configuration
js/storage.js                 Validation, persistence, recovery, import, and migration
js/calculations.js            Pure cost and date calculations
js/recommendationEngine.js    Pure deterministic decision logic
js/alternativeProvider.js    Provider interface, verification, filtering, and ranking
js/render.js                  Safe DOM rendering for totals, results, and alternatives
js/validation.js              Quick-audit input validation
data/alternatives.js          Locally maintained verified alternative records
tests/                        Calculation, decision, alternatives, storage, and page-contract tests
```

## How recommendations work

The engine uses normal JavaScript rules rather than an AI service. It starts with named weights for usage and importance. A completed detailed review adds context such as satisfaction, household use, overlapping services, switching difficulty, seasonality, and contract status.

Several safety rules run before the general score:

- Essential cloud backup is not treated as disposable because it is rarely opened.
- Household use prevents personal usage from being the only deciding factor.
- Active annual contracts lead to “Review before renewal.”
- Seasonal streaming can lead to “Pause or rotate.”
- Frequent use plus basic feature needs can lead to “Downgrade.”
- Unused, unimportant, unshared, out-of-contract services can become strong cancellation candidates.

Each result contains a recommendation key, human label, summary, reasons, warnings, a bounded score, confidence, and whether alternatives should be considered. The result is advice based on user-entered information—not an instruction or guarantee.

Potential savings totals include only strong cancellation candidates. They do not treat every rarely used service as money that will definitely be saved.

## Local storage and privacy

FeeVeto stores its versioned state under `feeveto_state_v2`. The state contains the selected audit currency and subscriptions, including optional detailed-review answers. Browser storage can be unavailable or corrupted, so reads and writes are guarded; the page remains usable and explains when changes may not persist.

No analytics are included. Subscription names, prices, questionnaire answers, and totals are not transmitted by the application.

## Migration from the former app

On first load, FeeVeto checks its own v2 key. If that key does not exist and migration has not been marked complete, it reads the former `subkiller_state` format or the earlier `subkiller_subscriptions` and `subkiller_currency` keys.

Migration:

1. Validates each legacy entry.
2. Preserves its name and integer price value.
3. Attaches the former list currency to each subscription.
4. Maps old billing, usage, importance, and category values to the new model.
5. Adds safe defaults for status, timestamps, and detailed review.
6. Writes the FeeVeto v2 state and a completion marker.

The old keys are not deleted. The completion marker and new-state precedence prevent repeated duplication.

## Alternatives provider

`AlternativesProvider` defines the future provider contract. `LocalAlternativesProvider` is the production default and reads `data/alternatives.js`. The production dataset intentionally starts empty rather than presenting invented prices, URLs, or claims.

An alternative must include enough verified data to be displayed:

```js
{
  id: 'unique-id',
  serviceName: 'Verified product name',
  aliases: [],
  categories: ['software'],
  alternativeType: 'free', // free | cheaper | one-time | downgrade
  description: 'A verified, neutral description.',
  monthlyPriceMinor: 0,    // integer minor units, or null
  yearlyPriceMinor: null,  // integer minor units, or null
  currency: 'CHF',
  pricingNote: '',
  supportedCountries: ['CH'],
  platforms: ['web'],
  featureTags: ['documents'],
  limitations: ['Verified limitation'],
  url: 'https://provider.example/product',
  isAffiliate: false,
  lastVerified: '2026-09-05'
}
```

### Adding a verified alternative

1. Confirm the product URL, feature claims, limitations, country availability, and price with the provider.
2. Express prices as integer minor units: CHF 9.99 becomes `999`.
3. Use `null` when a price is not verified. Never estimate it.
4. Record the actual verification date as `YYYY-MM-DD`.
5. Add the object to `VERIFIED_ALTERNATIVES` in `data/alternatives.js`.
6. Add or update tests, then run `npm run check`.

Ranking prioritizes required-feature compatibility, preferences, country eligibility, useful savings, switching fit, and limitations. Affiliate status is never part of the rank score. Free and non-affiliate options can rank first.

Affiliate URLs must not be added until approved. Set `isAffiliate: true` only for a real approved relationship. The interface then places “Paid link” beside the action and uses `rel="sponsored noopener noreferrer"`. The disclosure must remain visible near the alternative results:

> We may earn a commission if you purchase through this link, at no additional cost to you. Affiliate relationships do not affect how alternatives are ranked.

## Run locally

Serve the repository from its root. ES modules do not work reliably when the HTML file is opened directly.

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Run tests

Node.js 20 or newer is required. No packages need to be installed.

```sh
npm run check
```

The command checks the browser entry module and runs all Node tests.

## Manual testing

1. Add a monthly subscription and confirm monthly and annual equivalents.
2. Add a quarterly subscription and confirm its totals.
3. Edit an entry and confirm the saved card changes without duplication.
4. Open “Review in more detail,” answer the household/contract/seasonal questions, and confirm the recommendation and confidence change.
5. Switch the new-entry currency, add another subscription, and confirm the first entry keeps its original currency.
6. Try the All, Keep, Review, Save money, and Alternatives filters.
7. Export a backup, add another test entry, and import the backup.
8. Test keyboard navigation and visible focus.
9. Check widths around 375, 768, 1024, and 1440 pixels for overflow.
10. Open the browser console and confirm there are no errors.

Use fictional subscription information during testing.

## Deployment

### GitHub Pages

The repository workflow runs the full test suite for pull requests and `main`. After checks pass on `main`, it publishes only the public HTML, CSS, JavaScript, data, icon, robots, and sitemap files.

### Cloudflare Pages

FeeVeto is a static site and needs no build framework.

1. Create a Pages project from the GitHub repository.
2. Choose no framework preset.
3. Leave the build command empty, or use `npm run check` when Cloudflare supports a separate deploy step after checks.
4. Set the output directory to the repository root.
5. Use Node.js 20 or newer if a build environment is requested.
6. Deploy and test storage, module paths, and privacy links on the final domain.

Do not add payment, analytics, or API credentials to frontend files.

## Current limitations

- Data remains in one browser unless manually exported and imported.
- No bank connection, automatic detection, automatic cancellation, accounts, or cloud sync
- No live currency conversion; mixed-currency entries are excluded from combined totals
- No notification delivery when the page is closed
- No production alternatives are shown until verified records are added
- Cost-per-use is an estimate based on a frequency range
- Recommendations depend on the accuracy and completeness of user-entered answers

## Planned provider architecture

A future API-backed alternatives provider can implement the same `getAlternatives(subscription, userPreferences)` interface. It should keep API keys on a server, validate and cache provider data, include provenance and verification dates, and return the same normalized shape used by the local provider. The UI should continue to hide insufficiently verified records.

Accounts, payments, cloud sync, and live pricing are deliberately outside this release. They require a privacy review, secure backend design, recovery behavior, and updated documentation before implementation.

## License

FeeVeto is available under the [MIT License](./LICENSE).
