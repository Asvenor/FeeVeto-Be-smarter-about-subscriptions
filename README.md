# FeeVeto

Production domain: [feeveto.com](https://feeveto.com/). Start with [the current production-domain release evidence](docs/PRODUCTION-DOMAIN.md) for the deployed version, email-only Production authentication, verified account save/reopen/sign-out flow, remaining access-role checks and rollback boundaries. Google and Apple remain disabled, as do purchases. The canonical URLs, crawler metadata and social previews use this domain.

The earlier [launch-readiness report](docs/LAUNCH-READINESS.md) preserves the pre-domain readiness baseline and remaining broader review requirements; it is not the current deployment status. Domain routing alone does not verify production authentication or all launch gates. See [the experience redesign](docs/experience-redesign.md) for the workspace layout and [owner controls](docs/OWNER-CONTROLS.md) for purchase switches and discount controls. Dated journey, polish and hardening reports preserve historical evidence; they are not statements of today's deployment status.

**Keep, switch, or cancel with confidence.**

FeeVeto is a private subscription audit. It helps people understand recurring costs, decide whether services are worth keeping, and review verified cheaper or free alternatives that fit their needs. It does not connect to banks, detect subscriptions automatically, or cancel services.

## Current features

- Discover, My subscriptions and Saved audits workspace views, with retained form state and optional detail disclosures
- Instant natural-language supported-service discovery with correctable interpretation, guest results, filters, and retry
- Optional two-stage personalised audit with explicit unknowns, feature requirements, spending, and switching preferences
- Explainable keep/downgrade/switch/cancel assessments with same-currency estimates and dated source evidence
- Opt-in account saves, retry-safe sign-in continuity, reopening, and append-only reevaluation history
- One adaptive form for cost, usage, requirements, and optional switching context
- One “Save and review” action that keeps the browser entry, calculates the audit, retrieves authorized alternatives, and (when signed in) saves its account assessment with retry recovery
- Transparent recommendations with reasons, confidence, and cautious wording
- Weekly, monthly, quarterly, and yearly cost normalization
- One persisted global display-currency preference, defaulting to USD, for examples, dashboard subtotals, new-entry defaults, and the default alternatives market
- Per-subscription original currencies without fake exchange-rate conversion
- Separate monthly and annual subtotals for mixed-currency audits
- Evidence-based potential savings totals
- Add, edit, delete, clear, filter, and search controls
- JSON backup export and import
- Optional Clerk sign-up, sign-in, profile management, and sign-out controls
- Implemented but launch-disabled Stripe Checkout for $2.99 USD/month or $49.99 USD lifetime Premium, with server-verified access and self-service billing
- Signed Stripe webhook fulfillment backed by a Cloudflare D1 entitlement record
- Curated matching for six launch subscriptions plus verified additional product types
- Server-side product-type and requirement matching with protected free-plan records
- Device-local storage with one-time migration from the former app formats
- Responsive, keyboard-friendly, reduced-motion interface

## File structure

```text
index.html                    Discover, subscriptions, saved audits, and supporting workspace views
privacy.html                  Plain-language privacy overview
style.css                     Base responsive visual system
experience.css                Green workspace layout and progressive-disclosure presentation
js/experience.js              Hash navigation, view visibility, and disclosure/focus behavior
js/app.js                     Browser events and application state coordination
js/auth.js                    Clerk initialization and signed-in/signed-out navigation controls
js/access.js                  Browser client for the server-verified access summary
js/billing.js                 Checkout client, fixed plan display, and Stripe URL validation
js/admin.js                   Server-authorized owner settings and discount draft workspace
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
migrations/                   Cloudflare D1 billing, saved assessments and owner controls
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

Product measurement is optional and off by default. First-party events use a strict non-sensitive allowlist; inline feedback sends only an explicit choice, fixed reason and known service/context. Browser privacy signals disable both. See [Public Beta hardening](docs/PUBLIC-BETA-HARDENING.md) for the event schema and scoring model, and [launch readiness](docs/LAUNCH-READINESS.md) for current verification and remaining gaps. Analytics and feedback are implemented; sign-up button clicks are measured, not completed registrations or unique-user conversion.

Alternative-matching requests send structured requirements, not the local name, bill amount, notes, totals, or full list. Instant discovery also sends optional budget, switching tolerance, and market context. Personal assessment additionally sends the original request, current spending, and guided answers for server calculation. Save this audit, or Save and review while signed in, explicitly stores the selected entry's assessment in D1. Private notes stay local. Guest saves remain browser-only; sign-in alone never uploads earlier entries. See [journey release notes](docs/JOURNEY-RELEASE.md) for privacy, storage, and verification boundaries.

## Authentication

Clerk provides optional account creation, sign-in, profile management, and sign-out. Signing in alone does not upload or synchronize the local subscription list. An explicit pending Save this audit resumes after sign-in; account endpoints verify Clerk ownership before reading or writing any assessment. The browser loads ClerkJS and Clerk UI from the application’s Clerk Frontend API domain. The build accepts `VITE_CLERK_PUBLISHABLE_KEY` or `CLERK_PUBLISHABLE_KEY` and injects only that public value; no Clerk secret is used in browser code.

The repository includes `.env.example` as a safe template. Local credentials belong in `.env.local`, which is ignored by Git. The project is linked to Clerk application `app_3IxBTR7IHayTnEm7oToPCrk8yNL` through the Clerk CLI.

### Server-controlled access

The Cloudflare Worker verifies each Clerk session before reading access settings. After verification, the backend fetches the Clerk Backend User and reads only `privateMetadata`:

- `{ "role": "admin", "betaAccess": false }` grants admin privileges and complimentary premium access.
- `{ "role": "user", "betaAccess": true }` grants complimentary premium access without admin privileges.
- `{ "role": "user", "betaAccess": false }`, missing metadata, or invalid values grant ordinary unpaid access.

The browser receives a small access summary, not the raw private metadata. `/api/premium/status` checks premium permission before responding, and `/api/admin/status` checks admin permission. The existing Owner panel uses separately protected settings and discount endpoints; only a server-verified admin may use them. The free audit remains public and does not call either protected status endpoint.

Paid access remains deliberately separate from Clerk beta/admin metadata. The Worker looks up an active Stripe-backed entitlement in the `FEEVETO_BILLING` D1 database. A browser flag, request body, public Clerk metadata, or an unverified redirect can never grant premium access.

Never use `publicMetadata`, `unsafeMetadata`, request bodies, or local storage as an authorization source.

## Payments

New purchases are disabled for this Public Beta. The implemented future plans are $2.99 USD/month or $49.99 USD once for lifetime access, with the same features for one signed-in Clerk account. The site's display currency still controls examples, new audit entries, and market hints; it does not convert these purchase prices. Keep the server launch gate `BILLING_ENABLED=false`. A configured billing mode or owner purchase switch cannot override that gate. Local and sandbox checkout use test credentials and a visible test-mode notice; live payment activation requires separate approval.

The Worker verifies Clerk identity, selects an approved Stripe price, and reserves one checkout per account. A redirect never grants access: signed Stripe webhooks and server reconciliation verify the payment, product, mode and account ownership. Monthly access requires a verified paid invoice and expires at its paid-through date. Lifetime purchases are separate grants. Full refunds revoke only the matching purchase or invoice grant, including when refund notifications arrive first. Card data stays at Stripe.

Owner and beta access continues to come from Clerk private metadata and never requires payment. Monthly buyers can manage billing or buy lifetime access; a successful lifetime upgrade stops monthly renewals without automatic proration, credit or refund. Previously paid periods are not overwritten. See [billing setup, migration, operational recovery and verification](docs/BILLING.md) before enabling any environment. Production activation is a separate approval, not part of the sandbox implementation.

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

For larger additions, use the [private catalogue expansion and maintenance workflow](docs/CATALOGUE-MAINTENANCE.md). It preserves the baseline, counts distinct services instead of pricing tiers, validates category coverage, and creates a new private review bundle without uploading it.

1. Verify every claim against current official product, pricing, documentation, or support pages.
2. Preserve a private baseline backup and edit a new review copy under `.private/`; the entire directory is ignored and must never be added to Git, `data/`, `js/`, HTML, or another tracked path.
3. Record uncertain country, platform, or advertisement compatibility as `unknown` rather than guessing.
4. Keep different plans as different records and label same-provider lower plans as `downgrade`.
5. Run `node scripts/catalogue-validate.mjs .private/verified-alternatives.json`.
6. Test with development storage. After approval of the exact file and destination, back up the current live value and explicitly upload the reviewed JSON to KV key `catalogue:v2` using `npm run catalogue:publish -- --file <PRIVATE_REVIEWED_FILE> --namespace-id <KV_NAMESPACE_ID> --remote`. Stop if the live baseline changed during review.
7. Add only fictional records to tracked tests and fixtures, then run `npm run check`.

All current outbound actions use the verified `officialUrl` directly with `rel="noopener noreferrer"`. No tracking redirects, affiliate parameters, external alternatives API, pricing API, search API, or AI recommendation model are used.

## Run locally

Use a Node.js version supported by `package.json` (22.22.2+, 24.15.0+, or 26+) and install the locked dependencies. Vite alone previews the interface, not the account or alternatives APIs:

```sh
npm ci
npm run dev
```

Open the local address Vite prints, normally `http://127.0.0.1:5173`. Clerk authentication requires `VITE_CLERK_PUBLISHABLE_KEY` in an ignored `.env.local` file. For a working full-stack preview, follow the [local Worker instructions](docs/JOURNEY-RELEASE.md#local-preview) using development credentials and isolated local storage, never production D1 for test payments.

## Run tests

Use the Node.js versions specified in `package.json`; Node.js 20 is not supported by the current dependencies.

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
15. Payment verification is separate from free-beta launch: in an isolated Stripe sandbox, sign in as an ordinary account and test the fixed USD monthly and lifetime prices. Display-currency changes must not relabel them. Confirm premium activates only after verified server fulfillment; replay a delivered event and confirm no duplicate entitlement appears.
16. Confirm owner/beta accounts cannot buy, lifetime buyers cannot buy again, and monthly buyers may intentionally upgrade to lifetime without creating duplicate monthly subscriptions. Test a full sandbox refund and confirm only its matching paid entitlement is revoked. See the complete [billing lifecycle matrix](docs/BILLING.md) before any commercial release.

Use fictional subscription information during testing.

## Deployment

### One production host: Cloudflare Workers

The public production origin is `https://feeveto.com`. Connect this custom domain to the existing `feeveto` Worker so the frontend and protected `/api/*` endpoints share that origin. Keep public links, canonical metadata, social previews, `robots.txt` and `sitemap.xml` on this domain, not the former `workers.dev` address.

The repository workflow installs locked dependencies and runs `npm run check` (tests and the production build) on pull requests and `main`. Its required job remains **Quality checks**. GitHub Actions does not publish a second static site. Cloudflare's Git integration is the production deployment path and must track `main` only.

The old GitHub Pages publishing job has been removed because a static copy cannot serve FeeVeto's same-origin backend. If a prior Pages site is still published, the owner should unpublish it in repository **Settings → Pages** after confirming the Cloudflare URL. Removing the workflow does not itself remove a past deployment. No repository history needs deletion. [GitHub's unpublishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site)

### Cloudflare Workers

FeeVeto uses a module Worker so the protected Clerk/KV endpoints and static Vite assets run on the same origin. The previously used assets-only deploy command is insufficient because assets-only Workers cannot receive runtime secrets or bindings.

1. Keep the existing Git-connected Worker named `feeveto`, with production branch `main`. Do not enable feature-branch deployments against production storage.
2. Install from the lockfile with `npm ci`; use `npm run build` as the build command and `npx wrangler deploy` as the deploy command. Cloudflare deploys only the reviewed commit after it reaches `main`; this document does not authorize a merge or deployment.
3. Use a Node.js version supported by `package.json` (22.22.2+, 24.15.0+, or 26+) and add `VITE_CLERK_PUBLISHABLE_KEY` as a build variable.
4. Keep `worker.js` and `wrangler.jsonc` at the repository root. The Worker routes `/api/*` through the existing protected handlers and delegates all other requests to the `ASSETS` binding.
5. The versioned `wrangler.jsonc` connects `FEEVETO_ALTERNATIVES` to the dedicated `feeveto-alternatives` KV namespace. If a separate Preview Worker is added later, give it a separate namespace instead of sharing production catalogue state.
6. The same file binds `FEEVETO_BILLING` to the dedicated `feeveto-billing` D1 database. Back up, review and apply pending migrations (including `0004_monthly_lifetime_billing.sql` and `0005_owner_controls.sql`) to the intended environment before deploying dependent code. Use separate local/test storage; never use the production D1 binding for sandbox payments.
7. Add `CLERK_PUBLISHABLE_KEY` as a runtime variable and `CLERK_SECRET_KEY` as an encrypted runtime secret. The publishable values may be the same key; the secret key must never enter Vite or a tracked file.
8. For this free beta, preserve `BILLING_ENABLED=false`; no new Stripe products, secrets or payment configuration are needed. Before a separately approved commercial release, configure same-mode prices, portal, encrypted Stripe secrets and signed webhook delivery using [billing setup](docs/BILLING.md). Never copy sandbox credentials or data into production.
9. Keep `PRODUCT_ANALYTICS_ENABLED=true`, the `FEEVETO_EVENTS` Analytics Engine binding and `FEEVETO_EVENT_LIMIT` rate-limiter binding as documented in `wrangler.jsonc`. Analytics Engine must be enabled on the account before deploying this binding. This enables the endpoint, not visitor consent. Preserve dashboard-managed variables with `keep_vars=true` and retain existing runtime secrets.
10. Optionally add `CLERK_AUTHORIZED_PARTIES` as a comma-separated runtime variable for additional trusted frontend origins. The current request origin is always included automatically.
11. Validate the ignored private file, test it against development storage, then explicitly import it to KV with the documented `catalogue:publish` command. The JSON root must contain `{"schemaVersion":2,"offers":[...]}` and the stored key is `catalogue:v2`.
12. After review and explicit release approval, deploy and test authentication, all four access states, catalogue filtering, account saving, module paths, privacy links, feedback and consent-based analytics on the approved custom domain. Confirm purchases remain disabled. Do not replace healthy catalogue data or reapply migrations just to launch.

The owner selected `feeveto.com`; its Cloudflare custom-domain routing, HTTPS and matching Clerk Production keys are now configured. A real Production account session, account save/reopen after refresh, and sign-out were verified; the Production owner/beta/cross-account matrix and further retry/re-login checks remain outstanding. See the [current release report](docs/PRODUCTION-DOMAIN.md) for the exact evidence and limits. The confirmed operator is Edward Nyarko, with public support/privacy contact [inbox_business@outlook.com](mailto:inbox_business@outlook.com). Account-data requests are handled through this contact and require verified account ownership; there is no self-service account-history export/deletion interface. Publishing these details does not by itself establish legal compliance. Production accounts are separate from Development accounts: no identities, roles or saved-account history have been reassigned. Any later migration needs an explicit ownership-verified plan. The [launch report](docs/LAUNCH-READINESS.md) preserves the pre-domain readiness baseline, setup steps and stable rollback point; verify any remaining gates against the current deployment. A Worker rollback does not undo KV/D1 changes: retain additive tables and new user data, and never restore an old database merely to roll back code.

Browser-local subscriptions, currency preferences and unfinished drafts belong to their original origin and do not automatically transfer to `feeveto.com`. Keep the former Worker origin reachable until existing users can export their local subscriptions there and import that backup on the new domain. Do not automatically redirect away from their only accessible copy. This local export does not migrate Clerk identities or account-saved assessments; those need a separate verified ownership plan.

For local Worker testing, copy `.dev.vars.example` to the ignored `.dev.vars`, add development credentials, run `npm run build`, then run `npx wrangler dev`. Put only fictional data in shared development fixtures.

### Assigning owner and beta access in Clerk

1. Open the Clerk Dashboard, select the FeeVeto application, and select **Production** for accounts registered on `feeveto.com`.
2. Have the person register and verify their email on `feeveto.com`, then open **Users** and verify the intended account's email and user ID. Development accounts and their roles do not transfer automatically.
3. Open the user’s **Metadata** section and locate **Private metadata**. Do not use Public metadata or Unsafe metadata.
4. For the owner account, save `{ "role": "admin", "betaAccess": false }`.
5. For a friend who is a beta tester, save `{ "role": "user", "betaAccess": true }`.
6. For an ordinary user, save `{ "role": "user", "betaAccess": false }`, or leave the private metadata empty.
7. Ask the user to reload FeeVeto after the change. Every protected request fetches current private metadata from Clerk, so it does not trust a browser-stored role.

Use lowercase `admin` or `user` and a JSON boolean `true` or `false`, not quoted strings. An admin does not need `betaAccess: true`; the admin role already includes complimentary premium access.

After signing in, an admin sees **Owner** beside their account menu. Open it to save purchase settings and discount drafts. Beta and paid access do not authorize this panel. See [owner controls and payment safeguards](docs/OWNER-CONTROLS.md). Keep existing unrelated private metadata when editing the role.

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
- New purchases remain disabled; Stripe sandbox verification is separate from production activation, regardless of the configured runtime mode. Required seller/purchase information and lifecycle verification must be complete before a later payment launch.

## Planned provider architecture

The catalogue is deliberately curated rather than API-driven. A later administration workflow can update the same private KV schema without changing matching or rendering. Paid Stripe entitlements remain separate from complimentary Clerk metadata.

The provider boundary is `functions/_shared/catalogue-provider.js`. A future optional provider can supply the same checked schema to the existing authorization and ranking pipeline. Live provider pricing, external search, AI-generated recommendations, and automatic full-list cloud sync remain outside this release.

## License

FeeVeto is available under the [MIT License](./LICENSE).
