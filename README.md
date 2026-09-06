# FeeVeto

**Keep, switch, or cancel with confidence.**

FeeVeto is a private subscription audit. It helps people understand recurring costs, decide whether services are worth keeping, and review verified cheaper or free alternatives that fit their needs. It does not connect to banks, detect subscriptions automatically, or cancel services.

## Current features

- One adaptive form for cost, usage, requirements, and optional switching context
- One “Save and review” action that stores the entry, calculates the audit, and retrieves authorized alternatives
- Transparent recommendations with reasons, confidence, and cautious wording
- Weekly, monthly, quarterly, and yearly cost normalization
- Per-subscription currencies without fake exchange-rate conversion
- Monthly and annual totals for the selected audit currency
- Evidence-based potential savings totals
- Add, edit, delete, clear, filter, and search controls
- JSON backup export and import
- Optional Clerk sign-up, sign-in, profile management, and sign-out controls
- Curated alternatives for Canva, Netflix, ChatGPT, Adobe Photoshop, Claude, and Dropbox
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
js/config.js                  Brand, storage keys, options, and global configuration
js/storage.js                 Validation, persistence, recovery, import, and migration
js/calculations.js            Pure cost and date calculations
js/recommendationEngine.js    Pure deterministic decision logic
js/alternativeProvider.js    Provider interface, verification, filtering, and ranking
js/serviceCatalog.js         Supported-service aliases, product types, and structured requirements
js/render.js                  Safe DOM rendering for totals, results, and alternatives
js/validation.js              Quick-audit input validation
data/alternatives.js          Intentionally empty public catalogue placeholder
tests/                        Calculation, decision, alternatives, storage, and page-contract tests
vite.config.js                Multi-page production build configuration
functions/api/                Cloudflare Pages Functions for access and alternatives
functions/_shared/            Clerk verification, access policy, private catalogue matching, and HTTP helpers
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

FeeVeto stores its versioned state under `feeveto_state_v2`. The state contains the selected audit currency and subscriptions, including optional adaptive-form answers. Browser storage can be unavailable or corrupted, so reads and writes are guarded; the page remains usable and explains when changes may not persist.

No analytics are included. Subscription names, prices, free-text notes, calculated totals, and the full subscription list are not transmitted. When a supported service is saved or its alternatives are retried, the browser sends only a supported service ID, product type, structured requirements, country, platform, free/paid choices, advertisement/free-limit preferences, and required storage to FeeVeto's own Cloudflare Function.

## Authentication

Clerk provides optional account creation, sign-in, profile management, and sign-out. Authentication is deliberately separate from the subscription audit: signing in does not upload, attach, or synchronize audit entries. The browser loads ClerkJS and Clerk UI from the application’s Clerk Frontend API domain, following Clerk’s official script-tag integration. The build accepts `VITE_CLERK_PUBLISHABLE_KEY` or the Clerk CLI’s `CLERK_PUBLISHABLE_KEY` and injects only that public value; no Clerk secret is used in browser code.

The repository includes `.env.example` as a safe template. Local credentials belong in `.env.local`, which is ignored by Git. The project is linked to Clerk application `app_3IxBTR7IHayTnEm7oToPCrk8yNL` through the Clerk CLI.

### Server-controlled access

Cloudflare Pages Functions verify each Clerk session before reading access settings. After verification, the backend fetches the Clerk Backend User and reads only `privateMetadata`:

- `{ "role": "admin", "betaAccess": false }` grants admin privileges and complimentary premium access.
- `{ "role": "user", "betaAccess": true }` grants complimentary premium access without admin privileges.
- `{ "role": "user", "betaAccess": false }`, missing metadata, or invalid values grant ordinary unpaid access.

The browser receives a small access summary, not the raw private metadata. `/api/premium/status` checks premium permission before responding, and `/api/admin/status` checks admin permission. These endpoints are guard examples for future protected features; no admin dashboard is included. The free audit remains public and does not call either protected endpoint.

Paid access is deliberately isolated in `functions/_shared/billing-access.js` and currently returns `false`. A future Stripe integration can replace that server-side resolver without treating Clerk beta metadata as payment state.

Never use `publicMetadata`, `unsafeMetadata`, request bodies, or local storage as an authorization source.

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

The browser recognizes aliases for the six supported subscriptions inside the unified form, but unknown names still work in the basic audit. Users can correct the detected service and product type before saving. Service-specific requirements preserve four states: unanswered, must have, nice to have, and not needed. Optional free text remains a private note and is not interpreted by the matcher.

`BackendAlternativesProvider` sends only the minimum structured query to `POST /api/alternatives/recommendations`. The Cloudflare Function reads the catalogue from the private `FEEVETO_ALTERNATIVES` KV binding at key `catalogue:v1`, validates every record, applies deterministic matching, and returns at most three results.

Matching first requires the same product type. It then excludes missing must-have features, insufficient storage, known country or platform incompatibility, advertisements the user rejected, and free-plan limits the user would not accept. Unknown availability remains clearly marked for provider verification. Nice-to-have matches, limitations, and verification uncertainty affect ordering. Affiliate status is not accepted as a scoring input.

Signed-out and ordinary accounts can receive suitable paid or one-time-purchase records. Free-plan records are filtered on the backend before matching and are returned only when the server-verified Clerk entitlement has `premiumAccess: true`. Paid access remains a separate Stripe-ready resolver.

### Private catalogue schema

Production records must never be committed. Keep the reviewed JSON outside Git, upload it to Workers KV, and preserve a private backup. Each offer contains:

- A unique ID, product and exact plan name, relevant original services, product type, and downgrade/replacement relationship
- `pricingModel`: `free`, `subscription`, or `one_time`
- Plan-specific features, limitations, platforms, country availability, advertisement status, optional storage capacity, and free-plan-limit status
- HTTPS official and pricing destinations, official source URLs, and the actual verification date
- `affiliateUrl: null` and `affiliateStatus: "not_applied"`

Temporary trials must use `trialOnly: true`; the validator rejects a record that is simultaneously marked as a free plan and a temporary trial. The current response never calculates savings or exposes source and affiliate fields.

### Adding or updating an offer

1. Verify every claim against current official product, pricing, documentation, or support pages.
2. Update the private catalogue JSON; never add it to `data/`, `js/`, HTML, or another tracked path.
3. Record uncertain country, platform, or advertisement compatibility as `unknown` rather than guessing.
4. Keep different plans as different records and label same-provider lower plans as `downgrade`.
5. Upload the complete JSON value to KV key `catalogue:v1`.
6. Add only fictional records to tests and run `npm run check`.

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

The command checks the browser entry module and runs all Node tests.

## Manual testing

1. Enter a supported service, answer its visible requirements, choose switching preferences, and select “Save and review.” Confirm one result appears with its audit and alternatives state.
2. Add an unknown service and confirm the basic audit still works without catalogue claims.
3. Edit an entry and confirm every saved answer is populated and the entry is updated without duplication.
4. Change the service or product type and confirm irrelevant old requirements do not affect the new match.
5. Leave optional questions unanswered and confirm they remain unanswered after save and edit.
6. Simulate an unavailable alternatives endpoint and confirm the saved result remains with a Retry alternatives action.
7. Switch the new-entry currency, add another subscription, and confirm the first entry keeps its original currency.
8. Try the All, Keep, Review, Save money, and Alternatives filters.
9. Export a backup, add another test entry, and import the backup.
10. Test keyboard navigation, validation focus, result focus, and visible focus styles.
11. Check widths around 375, 768, 1024, and 1440 pixels for overflow.
12. Test signed-out, ordinary, beta, and admin accounts and confirm the catalogue access restrictions remain server-controlled.

Use fictional subscription information during testing.

## Deployment

### GitHub Pages

The repository workflow installs locked dependencies and runs the full test and production-build suite for pull requests and `main`. After checks pass on `main`, it builds the Vite application and publishes only `dist`, plus the robots and sitemap files.

Before deployment, create the repository Actions variable `VITE_CLERK_PUBLISHABLE_KEY` with FeeVeto’s Clerk publishable key. Publishable keys are intended for browser use; never configure `CLERK_SECRET_KEY` in the frontend or Pages build.

### Cloudflare Pages

FeeVeto is a static Vite site.

1. Create a Pages project from the GitHub repository.
2. Choose the Vite framework preset.
3. Use `npm run build` as the build command.
4. Set the output directory to `dist`.
5. Use Node.js 20 or newer if a build environment is requested.
6. Add `VITE_CLERK_PUBLISHABLE_KEY` as a build variable.
7. Add `CLERK_PUBLISHABLE_KEY` as a Pages Functions variable and `CLERK_SECRET_KEY` as an encrypted Pages Functions secret. The publishable values may be the same key; the secret key must never enter the Vite build.
8. Optionally add `CLERK_AUTHORIZED_PARTIES` as a comma-separated list of additional trusted frontend origins. The current request origin is always included automatically for same-origin Cloudflare deployments.
9. Create a Workers KV namespace for the private curated catalogue.
10. Under **Settings → Bindings**, add that namespace with the exact variable name `FEEVETO_ALTERNATIVES` for Production and Preview.
11. Add the private catalogue JSON as KV key `catalogue:v1`. The JSON root must contain `{"schemaVersion":1,"offers":[...]}`.
12. Deploy and test authentication, all four access states, catalogue filtering, storage, module paths, and privacy links on the final domain.

In Cloudflare, configure both Production and Preview under **Workers & Pages → FeeVeto project → Settings → Variables and Secrets**. Encrypt `CLERK_SECRET_KEY`. Configure the KV namespace under **Settings → Bindings** and redeploy after adding it. The `/functions` directory must remain at the repository root; Cloudflare builds it separately from `dist`.

For local Pages Functions testing, copy `.dev.vars.example` to the ignored `.dev.vars`, add development credentials, build with `npm run build`, then run `npx wrangler pages dev dist --kv=FEEVETO_ALTERNATIVES`. Put only fictional data in shared development fixtures.

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

- Data remains in one browser unless manually exported and imported.
- No bank connection, automatic detection, automatic cancellation, or cloud sync
- Accounts authenticate identity only; audits still remain in one browser
- No live currency conversion; mixed-currency entries are excluded from combined totals
- No notification delivery when the page is closed
- Curated matching is limited to the first six supported subscriptions
- Real catalogue records require the private Cloudflare KV binding and are intentionally absent from Git
- Cost-per-use is an estimate based on a frequency range
- Recommendations depend on the accuracy and completeness of user-entered answers

## Planned provider architecture

The catalogue is deliberately curated rather than API-driven. A later administration workflow can update the same private KV schema without changing matching or rendering. Stripe can implement `getPaidPremiumAccess` separately from complimentary Clerk metadata.

Payments, cloud sync, live pricing, external search, and AI-generated recommendations remain outside this release. Connecting the full audit to an account would require a separate privacy review and secure backend design.

## License

FeeVeto is available under the [MIT License](./LICENSE).
