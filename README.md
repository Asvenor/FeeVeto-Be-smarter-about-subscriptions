# FeeVeto

See [the journey checkpoints](docs/JOURNEY-CHECKPOINTS.md) and [release instructions](docs/JOURNEY-RELEASE.md) for the latest implementation and validation. [The earlier polish report](docs/POLISH-QA.md) remains historical context.

**Keep, switch, or cancel with confidence.**

FeeVeto is a private subscription audit. It helps people understand recurring costs, decide whether services are worth keeping, and review verified cheaper or free alternatives that fit their needs. It does not connect to banks, detect subscriptions automatically, or cancel services.

## Current features

- Instant natural-language supported-service discovery with correctable interpretation, guest results, filters, and retry
- Optional two-stage personalised audit with explicit unknowns, feature requirements, spending, and switching preferences
- Explainable keep/downgrade/switch/cancel assessments with same-currency estimates and dated source evidence
- Opt-in account saves, retry-safe sign-in continuity, reopening, and append-only reevaluation history
- One adaptive form for cost, usage, requirements, and optional switching context
- One “Save and review” action that stores the entry, calculates the audit, and retrieves authorized alternatives
- Transparent recommendations with reasons, confidence, and cautious wording
- Weekly, monthly, quarterly, and yearly cost normalization
- One persisted global display-currency preference, defaulting to USD, for examples, dashboard subtotals, new-entry defaults, and the default alternatives market
- Per-subscription original currencies without fake exchange-rate conversion
- Separate monthly and annual subtotals for mixed-currency audits
- Evidence-based potential savings totals
- Add, edit, delete, clear, filter, and search controls
- JSON backup export and import
- Optional Clerk sign-up, sign-in, profile management, and sign-out controls
- Stripe Checkout for one-time lifetime premium access in USD, EUR, GBP, and CHF
- Signed Stripe webhook fulfillment backed by a Cloudflare D1 entitlement record
- Curated matching for six launch subscriptions plus verified additional product types
- Server-side product-type and requirement matching with protected free-plan records
- Device-local storage with one-time migration from the former app formats
- Responsive, keyboard-friendly, reduced-motion interface

## File structure

```text
index.html                    One-page marketing, unified adaptive audit form, and results
privacy.html                  Plain-language privacy overview
style.css                     Light responsive visual system
js/app.js                     Browser events and application state coordination
js/auth.js                    Clerk initialization and signed-in/signed-out navigation controls
js/access.js                  Browser client for the server-verified access summary
js/billing.js                 Checkout client, fixed plan display, and Stripe URL validation
js/config.js                  Brand, storage keys, options, and global configuration
js/currencyPreference.js      Shared currency options, safe form defaults, and illustrative amounts
js/currencyPage.js            Currency preference synchronization on the privacy page
js/storage.js                 Validation, persistence, recovery, import, and migration
js/calculations.js            Pure cost and date calculations
js/recommendationEngine.js    Pure deterministic decision logic
js/alternativeProvider.js    Provider interface, verification, filtering, and ranking
js/serviceCatalog.js         Supported-service aliases, product types, and structured requirements
js/render.js                  Safe DOM rendering for totals, results, and alternatives
js/validation.js              Quick-audit input validation
data/alternatives.js          Intentionally empty public catalogue placeholder
fixtures/                     Fictional public catalogue data for validation and tests
scripts/                      Private-catalogue validation and explicit KV import tools
tests/                        Calculation, decision, alternatives, storage, and page-contract tests
vite.config.js                Multi-page production build configuration
worker.js                     Cloudflare Worker router for protected APIs and static assets
wrangler.jsonc                Versioned Worker, asset, and private KV binding configuration
functions/api/                Reusable Cloudflare handlers for access and alternatives
functions/_shared/            Clerk verification, access policy, private catalogue matching, and HTTP helpers
migrations/                   Cloudflare D1 billing-entitlement schema
```

## How recommendations work

The engine uses normal JavaScript rules rather than an AI service. It starts with named weights for usage and importance. Optional answers in the same form add context such as satisfaction, household use, overlapping services, switching difficulty, seasonality, and contract status. Unanswered values remain distinct from “No,” so incomplete context does not produce high confidence.

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

FeeVeto stores its versioned state under `feeveto_state_v2`. The state contains one global display-currency preference and subscriptions, including each entry's original billing currency and optional adaptive-form answers. The existing `auditCurrency` field remains the persisted preference name for backup compatibility. New visitors default to USD. Existing valid preferences, imported backups, legacy preferences, saved amounts, and saved billing currencies are preserved. Browser storage can be unavailable or corrupted, so reads and writes are guarded; the page remains usable and explains when changes may not persist.

No analytics are included. The original local-list matching path sends only structured requirements, not the local name, price, notes, totals, or full list. Instant discovery also sends structured requirements, optional budget, switching tolerance, and market context. Personal assessment additionally sends the original request, current spending, and guided answers for server calculation. Only an explicit account save stores an assessment in D1. No full subscription list is uploaded automatically. See [journey release notes](docs/JOURNEY-RELEASE.md) for privacy, storage, and verification boundaries.

## Authentication

Clerk provides optional account creation, sign-in, profile management, and sign-out. Signing in alone does not upload or synchronize the local subscription list. An explicit pending Save this audit resumes after sign-in; account endpoints verify Clerk ownership before reading or writing any assessment. The browser loads ClerkJS and Clerk UI from the application’s Clerk Frontend API domain. The build accepts `VITE_CLERK_PUBLISHABLE_KEY` or `CLERK_PUBLISHABLE_KEY` and injects only that public value; no Clerk secret is used in browser code.

The repository includes `.env.example` as a safe template. Local credentials belong in `.env.local`, which is ignored by Git. The project is linked to Clerk application `app_3IxBTR7IHayTnEm7oToPCrk8yNL` through the Clerk CLI.

### Server-controlled access

The Cloudflare Worker verifies each Clerk session before reading access settings. After verification, the backend fetches the Clerk Backend User and reads only `privateMetadata`:

- `{ "role": "admin", "betaAccess": false }` grants admin privileges and complimentary premium access.
- `{ "role": "user", "betaAccess": true }` grants complimentary premium access without admin privileges.
- `{ "role": "user", "betaAccess": false }`, missing metadata, or invalid values grant ordinary unpaid access.

The browser receives a small access summary, not the raw private metadata. `/api/premium/status` checks premium permission before responding, and `/api/admin/status` checks admin permission. These endpoints are guard examples for future protected features; no admin dashboard is included. The free audit remains public and does not call either protected endpoint.

Paid access remains deliberately separate from Clerk beta/admin metadata. The Worker looks up an active Stripe-backed entitlement in the `FEEVETO_BILLING` D1 database. A browser flag, request body, public Clerk metadata, or an unverified redirect can never grant premium access.

Never use `publicMetadata`, `unsafeMetadata`, request bodies, or local storage as an authorization source.

## Payments

FeeVeto Premium is a one-time lifetime purchase for a signed-in Clerk account. The page displays 4.99 in the selected USD, EUR, GBP, or CHF currency, and the backend creates a Stripe Checkout Session from one configured multi-currency Price. The browser sends only the selected supported currency and its Clerk session token; the Worker supplies the verified user ID and fixed product metadata itself.

Premium activates only after `/api/billing/webhook` verifies Stripe's signature, confirms a paid Checkout Session, checks that the Clerk reference matches the server-created metadata, and verifies the exact configured Price. The D1 record stores access state and Stripe references, not card data or the local subscription audit. Duplicate webhook delivery is safe, and a full `charge.refunded` event marks the matching entitlement as refunded.

Owner and beta access continues to come from Clerk private metadata and never requires payment. The checkout endpoint returns `already_premium` for admin, beta, or previously paid accounts.

## Migration from the former app

On first load, FeeVeto checks its own v2 key. If that key does not exist and migration has not been marked complete, it reads the former `subkiller_state` format or the earlier `subkiller_subscriptions` and `subkiller_currency` keys.

Migration:

1. Validates each legacy entry.
2. Preserves its name and integer price value.
3. Attaches the former list currency to each subscription.
4. Maps old billing, usage, importance, and category values to the new model.
5. Adds safe defaults for status, timestamps, and optional review context.
6. Writes the FeeVeto v2 state and a completion marker.

The old keys are not deleted. The completion marker and new-state precedence prevent repeated duplication.

## Curated alternatives

The browser recognizes aliases for the six launch subscriptions and additional supported use cases inside the unified form, but unknown names still work in the basic audit. Users can correct the detected service and product type before saving. Service-specific requirements preserve four states: unanswered, must have, nice to have, and not needed. Product-specific structured questions appear in that same form. Optional free text remains a private note and is not interpreted by the matcher.

`BackendAlternativesProvider` sends only the minimum structured query to `POST /api/alternatives/recommendations`. A recognized service—including an older saved record without `detailedReview`—or a specific supported product type is enough to start discovery. Optional answers remain nullable and refine the comparison instead of blocking it. The request also carries the global display currency as a market hint. The Cloudflare Function reads schema-version 2 data from the private `FEEVETO_ALTERNATIVES` KV binding at key `catalogue:v2`, validates the complete catalogue, applies deterministic matching, and returns at most three results.

Matching first requires the same product type. It then excludes explicitly unsupported must-haves, insufficient storage, known country/platform/language/level incompatibility, advertisements the user rejected, and free-plan limits the user would not accept. When country is blank, the server maps USD to the US market, GBP to the UK, CHF to Switzerland/Liechtenstein, and EUR to the euro area; an explicit country always takes precedence. This mapping is server controlled, so callers cannot supply their own market country list. Worldwide records remain eligible, while unknown availability remains a candidate with a verification note. With only basic information, eligible records are labelled “General suggestion” and include useful product-specific details to add. When explicit selected needs are supported and no compatibility fact remains uncertain, the label becomes “Matches your selected needs.” Nice-to-have matches, limitations, switching effort, and verification uncertainty affect deterministic ordering. Affiliate status is not accepted as a scoring input.

The response preserves distinct states for general suggestions, tailored suggestions, unsupported use cases, no accessible match, access restrictions, unavailable catalogue configuration, and retryable request failures. Errors never discard the saved subscription or its form answers, and request sequencing prevents an older response from replacing newer results.

Signed-out and ordinary accounts can receive suitable paid or one-time-purchase records. Free-plan records are filtered on the backend before any response and are returned only when the server-verified Clerk entitlement has `premiumAccess: true`. Paid access remains a separate Stripe-ready resolver. A supplied session that cannot be verified produces a distinct authentication error rather than silently downgrading the request. Signed-out public discovery still needs no session.

The alternatives response identifies the pricing model and returns a verified numerical provider price only when the private record has reliable plan, region, currency, interval, and verification evidence. Missing prices remain unknown rather than appearing as zero. Source currencies are retained, annual commitments stay annual, introductory and renewal terms stay separate, and no cross-currency savings are calculated.

### Private catalogue schema

Production records must never be committed. Keep the reviewed JSON outside Git, upload it to Workers KV, and preserve a private backup. Each offer contains:

- Stable catalogue, product, and exact plan IDs; relevant original services; product type; and downgrade/replacement relationship
- `pricingModel`: `free`, `subscription`, or `one_time`
- Nullable price in minor units, source currency, interval, upfront commitment, and separate introductory and renewal terms
- Explicitly supported, unsupported, and unknown plan features; limitations; usage limits; platforms; country availability; advertisement status; optional capacity; and free-plan-limit status
- HTTPS official and pricing destinations, official source URLs, and the actual verification date
- `affiliateUrl: null` and `affiliateStatus: "not_applied"`

Temporary trials are not catalogue offers: the validator rejects `trialOnly: true`. Discovery does not calculate personal savings. The separate assessment endpoint calculates estimates only from a comparable verified price and the user's bill. Permitted source URLs and verification dates are returned with authorized offers; affiliate fields are never exposed.

### Adding or updating an offer

1. Verify every claim against current official product, pricing, documentation, or support pages.
2. Update `.private/verified-alternatives.json`; the entire directory is ignored and must never be added to Git, `data/`, `js/`, HTML, or another tracked path.
3. Record uncertain country, platform, or advertisement compatibility as `unknown` rather than guessing.
4. Keep different plans as different records and label same-provider lower plans as `downgrade`.
5. Run `node scripts/catalogue-validate.mjs .private/verified-alternatives.json`.
6. Test with development storage, then explicitly upload the complete JSON to KV key `catalogue:v2` using `npm run catalogue:publish -- --file .private/verified-alternatives.json --namespace-id <KV_NAMESPACE_ID> --remote`.
7. Add only fictional records to tracked tests and fixtures, then run `npm run check`.

All current outbound actions use the verified `officialUrl` directly with `rel="noopener noreferrer"`. No tracking redirects, affiliate parameters, external alternatives API, pricing API, search API, or AI recommendation model are used.

## Run locally

Install dependencies, then start the Vite development server:

```sh
npm install
npm run dev
```

Open the local address Vite prints, normally `http://127.0.0.1:5173`. Clerk authentication requires `VITE_CLERK_PUBLISHABLE_KEY` in an ignored `.env.local` file.

## Run tests

Node.js 20 or newer is required.

```sh
npm run check
```

The command checks browser and backend modules, validates the fictional public fixture, runs all Node tests, and builds the production bundle.

## Manual testing

1. Enter each launch service with only the essential audit fields and select “Save and review.” Confirm general alternatives appear without completing optional questions.
2. Add an unknown service and confirm the basic audit still works without catalogue claims.
3. Edit an entry and confirm every saved answer is populated and the entry is updated without duplication.
4. Change the service or product type and confirm irrelevant old requirements do not affect the new match.
5. Leave optional questions unanswered and confirm they remain unanswered after save and edit.
6. Simulate an unavailable catalogue and a separate request failure. Confirm each has accurate copy, the saved result remains, and Retry alternatives works.
7. In a clean browser, confirm USD appears in every example and empty dashboard amount. Switch the global preference through EUR, GBP, and CHF and confirm examples, selected-currency dashboard totals, and untouched new-entry defaults update without a reload.
8. Enter a partial price, switch the global preference, and confirm the unfinished entry keeps its current billing currency. Edit a saved CHF entry and confirm its amount and currency remain CHF unless explicitly changed.
9. Add entries in multiple currencies and confirm FeeVeto shows separate original-currency subtotals, never a combined total, and never presents a missing selected-currency subtotal as zero.
10. Try the All, Keep, Review, Save money, and Alternatives filters.
11. Export a backup, add another test entry, and import the backup.
12. Test keyboard navigation, validation focus, result focus, and visible focus styles.
13. Check widths around 375, 768, 1024, and 1440 pixels for overflow.
14. Test signed-out, ordinary, beta, and admin accounts and confirm the catalogue access restrictions remain server-controlled.
15. In Stripe test mode, sign in as an ordinary account and open checkout in each currency. Complete one test payment and confirm premium activates only after the signed webhook; repeat a delivered event and confirm no duplicate entitlement appears.
16. Confirm an owner, beta tester, and already-paid account cannot start another checkout. Test a full sandbox refund and confirm only its matching paid entitlement is revoked.

Use fictional subscription information during testing.

## Deployment

### GitHub Pages

The repository workflow installs locked dependencies and runs the full test and production-build suite for pull requests and `main`. After checks pass on `main`, it builds the Vite application and publishes only `dist`, plus the robots and sitemap files.

Before deployment, create the repository Actions variable `VITE_CLERK_PUBLISHABLE_KEY` with FeeVeto’s Clerk publishable key. Publishable keys are intended for browser use; never configure `CLERK_SECRET_KEY` in the frontend or Pages build.

### Cloudflare Workers

FeeVeto uses a module Worker so the protected Clerk/KV endpoints and static Vite assets run on the same origin. The previously used assets-only deploy command is insufficient because assets-only Workers cannot receive runtime secrets or bindings.

1. Keep the existing Git-connected Worker named `feeveto`.
2. Use `npm run build` as the build command and `npx wrangler deploy` as the deploy command.
3. Use Node.js 20 or newer and add `VITE_CLERK_PUBLISHABLE_KEY` as a build variable.
4. Keep `worker.js` and `wrangler.jsonc` at the repository root. The Worker routes `/api/*` through the existing protected handlers and delegates all other requests to the `ASSETS` binding.
5. The versioned `wrangler.jsonc` connects `FEEVETO_ALTERNATIVES` to the dedicated `feeveto-alternatives` KV namespace. If a separate Preview Worker is added later, give it a separate namespace instead of sharing production catalogue state.
6. The same file binds `FEEVETO_BILLING` to the dedicated `feeveto-billing` D1 database. Apply `migrations/0001_billing.sql` before enabling checkout in an environment.
7. Add `CLERK_PUBLISHABLE_KEY` as a runtime variable and `CLERK_SECRET_KEY` as an encrypted runtime secret. The publishable values may be the same key; the secret key must never enter Vite or a tracked file.
8. Add `STRIPE_PRICE_ID` as a runtime variable. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` only as encrypted Worker secrets. Use matching Stripe test values in a test Worker first, then matching live values for production; never mix modes.
9. In Stripe, register `https://<worker-host>/api/billing/webhook` and subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded`. Copy its signing secret directly into the Worker secret without putting it in a file or chat.
10. Optionally add `CLERK_AUTHORIZED_PARTIES` as a comma-separated runtime variable for additional trusted frontend origins. The current request origin is always included automatically.
11. Validate the ignored private file, test it against development storage, then explicitly import it to KV with the documented `catalogue:publish` command. The JSON root must contain `{"schemaVersion":2,"offers":[...]}` and the stored key is `catalogue:v2`.
12. Deploy and test authentication, all four access states, checkout, signed webhook fulfillment, refund handling, catalogue filtering, storage, module paths, and privacy links on the final domain.

For local Worker testing, copy `.dev.vars.example` to the ignored `.dev.vars`, add development credentials, run `npm run build`, then run `npx wrangler dev`. Put only fictional data in shared development fixtures.

### Assigning owner and beta access in Clerk

1. Open the Clerk Dashboard and select the FeeVeto application.
2. Open **Users**, then select the account by its email address.
3. Open the user’s **Metadata** section and locate **Private metadata**. Do not use Public metadata or Unsafe metadata.
4. For the owner account, save `{ "role": "admin", "betaAccess": false }`.
5. For a friend who is a beta tester, save `{ "role": "user", "betaAccess": true }`.
6. For an ordinary user, save `{ "role": "user", "betaAccess": false }`, or leave the private metadata empty.
7. Ask the user to reload FeeVeto after the change. Every protected request fetches current private metadata from Clerk, so it does not trust a browser-stored role.

Use lowercase `admin` or `user` and a JSON boolean `true` or `false`, not quoted strings. An admin does not need `betaAccess: true`; the admin role already includes complimentary premium access.

Do not add payment, analytics, or API credentials to frontend files.

## Current limitations

- The original subscription list remains browser-local unless manually exported/imported. Account assessments are opt-in and separate, not automatic list synchronization.
- No bank connection, automatic subscription detection, or automatic cancellation
- Natural-language recognition is a deterministic supported-service parser, not a general AI model. Correct the understood service, motivation, country, and device when necessary.
- Account history currently has no self-service deletion/export interface; local exports cover only the original subscription list.
- No live currency conversion; real amounts retain their original currencies and mixed-currency audits use separate subtotals
- No notification delivery when the page is closed
- Catalogue coverage is curated and intentionally incomplete; unsupported products and unverified use cases return an honest no-match state
- Real catalogue records require the private Cloudflare KV binding and are intentionally absent from Git
- Cost-per-use is an estimate based on a frequency range
- Recommendations depend on the accuracy and completeness of user-entered answers
- Stripe is configured only in sandbox until the live account name, business details, tax obligations, customer support details, legal terms, and refund policy are reviewed

## Planned provider architecture

The catalogue is deliberately curated rather than API-driven. A later administration workflow can update the same private KV schema without changing matching or rendering. Paid Stripe entitlements remain separate from complimentary Clerk metadata.

The provider boundary is `functions/_shared/catalogue-provider.js`. A future optional provider can supply the same checked schema to the existing authorization and ranking pipeline. Live provider pricing, external search, AI-generated recommendations, and automatic full-list cloud sync remain outside this release.

## License

FeeVeto is available under the [MIT License](./LICENSE).
