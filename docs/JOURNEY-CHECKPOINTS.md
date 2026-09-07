# FeeVeto intent-to-audit checkpoints

## Phase 0 — Baseline (passed, September 7, 2026)

- Base: `6b27309`, containing the local payment implementation and currency-market change; latest `origin/main` remains `411e151`. Working tree was clean. Work continues on `feature/intent-audit-experience` without rewriting either branch.
- `npm run check`: 145 tests passed and production build passed.
- Live `/api/access`: HTTP 200, ordinary guest access. Live basic Canva/Netflix/Dropbox recommendations: HTTP 200 with 1/2/3 public suggestions respectively.
- Private schema-v2 catalogue: 42 valid offers, 19 product types, 34 known prices, verification date September 6, 2026. No sourced customer ratings. Some categories have fewer than three eligible public records; do not fabricate extra records or ratings.
- Reuse: vanilla JS/Vite, existing matching/validation, local subscription storage and migration, deterministic audit, Clerk identity/private metadata, Cloudflare Worker/KV, separate Stripe/D1 entitlements.
- Known integration limits: no AI service configured (use transparent deterministic intent recognition); Stripe test secrets/webhook and live branding unfinished. Browser automation is blocked by an admin-policy verification error, including Stripe. No live payment or signed-in end-to-end claim is justified.
- Current local subscriptions must stay in `feeveto_state_v2`; account assessment storage will be additive. Never upload the legacy audit automatically.

## Incremental implementation and recovery

1. Extend catalogue responses with verified sources, freshness, task/feature context, and optional sourced ratings; retain original currencies, access filtering, and legacy queries.
2. Add instant intent discovery with correction, filters, request sequencing, and coverage-aware results.
3. Add an optional two-stage guided audit with at most six needs questions and persistent drafts.
4. Add a shared explainable assessment and same-currency cost comparisons, using the current recommendation and matching code.
5. Add Clerk-owned D1 saved assessments, idempotent saves, and append-only reevaluation history. Keep protected snapshots behind current server permission checks.
6. Exercise integrated flows and fault cases, validate Worker packaging, document release configuration and actual browser limitations.

Each phase is committed separately after its focused tests pass. Recovery is by returning to the preceding commit on a separate checkout; no destructive reset, rewriting main, or database deletion is required. Database changes are additive migrations. No automatic deployment or merge.

## Phase 1 — Data foundation (passed)

- Reused all 42 private records; no invented records, prices, or review scores. Public output now includes permitted source links, feature facts, regional scope, and optional evidence-backed customer ratings (unknown for the current catalogue).
- Added a 90-day review policy, stale-data warnings, budget checks that respect currencies/annual billing, switching filters, and bounded exploration up to 12 accessible results. Existing default remains three.
- A small server-side catalogue provider owns retrieval; authorization/ranking stays common. No external API is required or called.
- 49 focused matching/catalogue tests passed, including legacy input, unknown prices, ratings evidence, annual budgets, currency differences, stale records, unavailable storage, and access restrictions.

## Phase 2 — Instant discovery (code checkpoint passed; visual check pending)

- New primary intent input with Canva/Dropbox/Netflix examples, editable service/type/motivation/country/device interpretation, guest suggestions, Free and Easier filters, more-results action, and retry.
- Deterministic recognition supports known aliases and explicit facts. Multiple services request one clarification. Unrecognized text never fabricates a service. Original requests and draft answers use a new storage key; no protected result snapshots are saved in browser storage.
- Shared existing alternative cards now expose checked features, compromises, billing basis, and official sources. Small catalogue coverage is stated honestly.
- 54 focused tests and production build passed. Browser automation remains blocked by policy verification; no visual or live new-journey claim is made at this checkpoint.

## Phase 3 — Optional guided audit (code checkpoint passed; browser check pending)

- Added two stages: current spending (including Not sure), then six category-aware needs groups. Existing answers are prefilled and collapsed for optional correction. Back, close/reopen, unknown answers, and legacy detailed context are preserved.
- Existing subscription cards can enter the same guided flow without changing the original saved record. The original subscription form remains available.
- 18 focused model/form tests and production build passed. Desktop/mobile keyboard and dialog behavior still require browser verification; the policy error remains a release limitation.

## Phase 4 — Explainable assessment (code checkpoint passed)

- Added a guest-safe server assessment using existing catalogue eligibility and audit safeguards. Keep, downgrade, switch, cancel, and provisional-review outcomes are based on supplied answers, with backup/contract safeguards and no forced switch.
- Same-currency monthly/annual comparisons retain upfront commitment warnings. Unknown, introductory, variable, one-time, and cross-currency prices do not generate recurring savings claims. Feature evidence, missing answers, sources, versions, and assessment date are shown.
- Catalogue failure still returns the user's basic assessment with a distinct unavailable state and retry. Request bodies are bounded while streaming, not just by a declared size.
- 24 focused assessment/matching/legacy-engine tests and production build passed. A test-fixture relationship error was corrected before the checkpoint. Browser integration remains pending.

## Phase 5 — Account-owned history (code checkpoint passed)

- Added an additive D1 assessment-history table and authenticated list/open/save endpoints. The server recomputes permitted snapshots, constrains every read/write to the verified account, deduplicates retries, and appends reevaluations.
- Added opt-in saving through existing Clerk sign-in, tab-local pending-save recovery, saved-audit listing, reopening, and dated history. Restricted history stays protected after entitlement removal. Original local storage is unchanged.
- 26 focused checks and production build passed, including a connected DOM test using actual request handlers and SQLite: guest search, guide back/close/reopen, assessment, simulated sign-in, save failure/retry, reopening, and append-only reevaluation. Tests use a fictional fixture, never the production-facing catalogue. Real Clerk sign-in and visual/mobile browser behavior remain unverified.
- A full-suite check identified outdated privacy-copy assertions; these were updated to require the new opt-in storage distinction, not removed. Privacy copy and release instructions now describe exactly when data leaves the browser.
