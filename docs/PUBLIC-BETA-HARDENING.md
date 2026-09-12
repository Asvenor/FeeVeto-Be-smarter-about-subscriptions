# Public Beta hardening — review release

Historical review record from September 8, 2026. The implementation was subsequently merged and deployed; statements below about pending deployment, old versions and test coverage describe that checkpoint, not today's production state. Use [launch readiness](LAUNCH-READINESS.md) for the current release gate and rollback point. Payments remain disabled.

At the time of this review, the changes were not deployed or merged. The pass polished the existing product rather than replacing its architecture or expanding its catalogue.

## Baseline recorded before editing — 8 September 2026

- Clean working tree at `45cc052`, branch `feature/experience-redesign`. Latest fetched `origin/main` is `411e151`; all 20 commits since main are unmerged work, including the currently deployed journey, billing and owner panel. No open PR was returned by GitHub. Continue this appropriate unmerged pre-launch branch and create one PR; no force-push or squash-merged branch reuse.
- `npm run check`: 306 tests passed; catalogue fixture validation and production build passed. Main JS 105.35 kB / 33.47 kB gzip; shared JS 20.25 / 7.49; main CSS 36.90 / 7.22; shared CSS 29.54 / 6.58. System fonts, no new font service, no frontend catalogue or source maps.
- Live Worker `feeveto`, version `b0a42f0c-0d79-4424-a9f8-8699268320d9`, confirmed 100% active. Runtime `BILLING_ENABLED=false`, `BILLING_MODE=live`; existing Clerk secrets, private KV and D1 bindings remain configured. Live state is inspected only during this task.
- Architecture: Vite/plain JavaScript, deterministic intent parsing, private KV `catalogue:v2`, server-side compatibility/ranking, two-stage optional guided audit plus unified subscription form, local subscription storage, D1 account-owned assessment history, Clerk private admin/beta metadata and separate Stripe entitlements.
- Current parser recognizes services/cost/tasks, but not free-only preference or conflicting intent. Matching already excludes verified incompatibilities but ranking is not a percentage. Cards show qualifications and sourced ratings, without explicit pros/cons or a defined FeeVeto Match score.
- Guest search currently waits on Clerk initialization, and search buttons allow duplicate submissions. Recommendations trusts declared Content-Length before unbounded JSON parsing. No product analytics or inline feedback exists; privacy still mentions obsolete Google Forms feedback.
- Canonical URL, title, favicon, robots and sitemap exist. Social sharing image is missing. Operator legal identity, public support email, terms, billing/cancellation/refund information are not complete; no identity or legal entity will be invented. Existing Clerk development instance remains a separate launch-readiness concern.
- Dedicated Chrome DevTools/Lighthouse MCP is unavailable. The web-perf skill's trace workflow cannot run; asset/code review and available browser mobile/keyboard checks will be reported separately, with no invented Core Web Vitals or synthetic score.

## Scope and review checkpoints

1. Intent/value-first discovery and truthful scored/provisional cards.
2. Shorter existing advanced audit, robust request/loading/error/access behavior.
3. Consent-based aggregate analytics, lightweight feedback, accurate privacy and SEO.
4. Regression tests, production build, mobile/keyboard checks and one reviewable PR.

The current commercial access boundary is retained: free-plan comparisons remain restricted unless the server verifies entitlement. A free-only request must explain that restriction rather than show paid offers as free or leak restricted records.

## Implementation

- Six one-click intent examples. Deterministic free/cheaper/replace/cancel recognition; ambiguous intent offers optional structured direction choices while general discovery still works. Ad-free is not interpreted as free pricing. An explicit All options click clears the free-only restriction.
- Distinct unsupported, no verified coverage, no compatible matches, access-restricted, authentication, infrastructure, network and loading states. No catalogue or external-data expansion.
- Existing two-stage guide retained. Billing period uses cards; activities and feature priority are asked together once. Six main groups cover feature priorities, usage, importance, audience, alternative types and switching effort. Optional compatibility details hold budget, role context, platform/country, ads/limits, storage or required streaming titles. Existing answers are populated and preserved, including partially answered free/paid preferences. Native validation opens the relevant disclosure and focuses the invalid field.
- Pros and cons come from checked feature/limitation records. Missing details are explicit; unknown prices remain unknown; annual commitments and original currencies remain visible. No synthetic reviews, stars, affiliate links or invented savings.
- Keep is a valid recommendation for important established workflows or specific streaming content. Seasonal streaming can recommend pause/rotate without promising savings or claiming another catalogue has the same titles.
- Public search no longer waits for Clerk's script initialization. Clerk scripts load concurrently with deduplication, timeout and Retry. Search and review submission guard duplicate requests and stale responses. Timeouts/network errors give actionable messages, preserving answers.
- Current-account generated avatars match FeeVeto in the header, menu and profile. Uploaded photos and Clerk branding are not replaced. Server-side Clerk role/beta and separate paid entitlements are unchanged.
- New first-party optional measurement and explicit feedback; no browser analytics dependency. New Open Graph/Twitter PNG, description and Public Beta copy. The 1200×630 social asset has an editable SVG source in `assets/`; the PNG in `public/` is copied by Vite and is not loaded by the landing page. Existing favicon, canonical, robots and sitemap remain.

## FeeVeto Match: precise meaning and boundaries

Model: `verified-priority-coverage-v1`. Ranking version: `curated-v4-priority-coverage`.

The percentage is **the weighted share of explicitly selected priorities supported by checked catalogue facts**, rounded to the nearest integer. It is not a probability, a customer review, a measured satisfaction prediction or a guarantee that switching is best. Existing compatibility and ranking rules run first; this is not min/max normalization of ranking scores or the position in a result set. Adding competitors does not change a plan's percentage.

| Selected criterion | Weight in coverage calculation |
| --- | ---: |
| Must-have features | 40 total, divided equally among selected essentials |
| Nice-to-have features | 20 total, divided equally among selected preferences |
| Required platform | 10 |
| Explicit country | 10 |
| Free-only / paid-only preference | 10 |
| Explicit monthly budget | 10 |
| Required storage capacity | 20 |
| Advertisement preference | 5 |
| Free-plan limits preference, for a free offer | 5 |
| Limited switching tolerance | 5 |

Unselected criteria are excluded from the denominator. Verified support gets full credit; unsupported nice-to-haves and unknown facts get zero, never assumed half-credit. At least one feature and two other independently selected dimensions are required for a percentage. Must/nice are one dimension for this threshold; pricing type/budget are also one dimension. An inferred currency market is not a country answer. Accepting any switching effort adds no artificial credit.

Known incompatible essentials/platform/country/capacity/budget/ad/limit constraints are excluded by the existing matcher. Unknown essential support, required country/platform/capacity, an unconfirmed explicit budget, a required no-ad/no-limit policy, or unverified specific content/server/language/level prevents a precise percentage. Stale records also prevent scoring. These remain general/potential matches with verification notes, not falsely confirmed replacements.

The legacy free-limit field normalizes missing values to false; it therefore cannot prove unlimited use. That absence receives no verified credit. We deliberately did not rewrite the catalogue schema/data in this task.

Usage, importance, contract and seasonality affect the **audit decision**, not a guessed provider suitability bonus. Role context is retained but has no percentage bonus: being a student or freelancer does not by itself prove a provider meets that person's needs. “Why this match?” explains selected support and unknowns without exposing internal ranking weights in API responses.

## Measurement and feedback

Frontend: `js/analytics.js`, strict shared schema `js/telemetrySchema.js`; Worker route `POST /api/events`. Measurement is off by default, controlled through Privacy choices on both pages, persisted as a yes/no preference. Do Not Track / Global Privacy Control override the preference. Clearing or disabling consent stops future measurement; there is no unique analytics ID.

The endpoint accepts only fixed event names, known service IDs (or blank), normalized intent, surface, a result-count bucket, explicit feedback choice/reason, and a boolean returning-browser marker on landing visits. Extra or malformed fields are rejected, not silently logged. Client requests omit cookies, tokens and referrers. No free-text intent, notes, bill, budget, questionnaire, email, Clerk/user/session ID, URL or IP is written to the dataset. Network information is still processed by Cloudflare to deliver requests; IP is used only in the short-lived abuse limiter. Feedback is sent only after the person's explicit click and works without broader consent, unless browser privacy signals block it.

Body limit is 1 KiB, including chunked requests. Same-origin checks, content type, a 60/minute per-location/IP Cloudflare limiter and a 60-event page cap limit abuse. This endpoint is intentionally anonymous, so measurements can be sampled, duplicated on uncertain retries, or affected by bots. It is not an authorization or billing source. Storage/configuration failures show feedback as unsent with Retry; they never stop audit or account saving.

### Proposed runtime configuration — not applied to production

- `PRODUCT_ANALYTICS_ENABLED=true` enables endpoint ingestion, **not user consent**. Set false to disable both feedback and measurement server-side.
- `FEEVETO_EVENTS` → Analytics Engine dataset `feeveto_product_events`. Dataset creation occurs on first accepted write after a future approved deployment.
- `FEEVETO_EVENT_LIMIT` → namespace `260908001`, 60 requests / 60 seconds. The isolated local config uses namespace `260908002` and dataset `feeveto_product_events_test`.
- No analytics API token is sent to the Worker or frontend. Reading aggregates later requires an account-side read token or Cloudflare dashboard access; keep that credential private.
- `keep_vars=true` preserves existing dashboard-managed runtime configuration (including the payment launch gate/mode and any authorized origins) on a later deployment. The analytics flag declared in source is the intentional new override. Secrets remain runtime secrets, not build output.
- Observability is sampled, query strings redacted, automatic invocation logs disabled. Application code does not log request bodies or raw auth exceptions. Existing Cloudflare infrastructure/security processing still applies.
- The same configuration retains the existing private KV/D1 bindings. **No D1 migration, catalogue import, role changes, payment toggle or production secret changes are required by this patch.** Existing deployment `BILLING_ENABLED=false` must remain in effect; this branch does not turn it on.

Cloudflare reference checks: [Analytics Engine setup](https://developers.cloudflare.com/analytics/analytics-engine/get-started/), [three-month retention/limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/), [rate-limiting semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Rate limits are location-local/approximate, not a globally exact count. Local binding acceptance is not evidence of remote Analytics Engine persistence; remote setup and an aggregate-read smoke test remain part of a later approved deployment.

Review account eligibility, quotas and [Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) before enabling the production binding. Documentation checked on 8 September 2026 says usage is not yet billed, but describes planned metered pricing. Do not assume the service will remain free; no paid plan or production dataset was activated here.

### Event map and useful launch questions

`blob1` event; `blob2` known service ID; `blob3` normalized intent; `blob4` surface; `blob5` result-count bucket; `blob6` helpful yes/no; `blob7` feedback reason; `blob8` first-observed/returning-browser marker. `double1=1`; `index1` event name. Cloudflare supplies timestamp and sampling interval.

| Question | Evidence to inspect |
| --- | --- |
| Is the homepage understood? | `result_feedback` with confusing / too-little-information; actual user observations are still needed |
| Do visitors search? | `landing_visit` versus `intent_submitted` counts |
| Do searches return alternatives? | `alternatives_requested` versus `alternatives_shown`, split by result-count bucket and service |
| Do people explore providers? | `alternative_clicked` versus non-empty results |
| Is the optional review engaging? | `advanced_audit_started` versus `advanced_audit_completed` |
| Are accounts/saves useful? | `account_signup_started` and successful `audit_saved` counts; signup-button clicks are **not** completed registrations |
| Do results differ meaningfully? | Compare general and selected-requirement test cases, plus feedback by surface; do not log personal answers to measure this |
| Do people return? | Boolean returning-browser counts among consenting landing visits, not cross-device retention |

Example aggregate query in Cloudflare Analytics Engine SQL:

```sql
SELECT blob1 AS event, SUM(_sample_interval * double1) AS estimated_events
FROM feeveto_product_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY event
ORDER BY estimated_events DESC
```

These are event ratios, **not a linked unique-user conversion funnel**. Consent, returning pages, retries and multiple searches bias the counts. There are no current production measurements from this new implementation and no invented conversion targets/results. Validate product readiness with observed use and feedback before adding complexity.

## Verification and limitations

- Clean dependency install completed. Automated regression suite: **329 passed, zero failed**; production build passed. Tests include signed-out/ordinary/beta/admin policies, direct unauthorized requests, protected-result clearing, mixed currencies, legacy data, duplicate saves, retries, deterministic coverage and critical unknowns, safe events, consent/privacy signals, same-origin/body limits and Clerk script timeout/retry. Historical snapshots without a saved match calculation say “Not scored” and retain existing answers for reevaluation. Package-registry dependency audit found **zero known vulnerabilities** across installed dependencies on 8 September 2026; this is not a guarantee against undiscovered issues.
- Existing private catalogue validation: 172 offers, unchanged. Local real-catalogue public Netflix, Canva and Dropbox requests each returned HTTP 200, three general suggestions, `accessScope=public`. No price or offer was invented to make a result appear.
- Local browser owner session verified through Clerk. Actual guided Canva review retained the $20 USD bill and selected answers, returned a checked lower-cost option and differentiated numeric versus potential matches. Reopening, Tab and Escape preserved answers and focus. Explicit feedback was accepted by the **local** endpoint, not a remote production dataset.
- A stalled preview during a clean dependency reinstall caused a real request timeout; the draft survived. After restarting the isolated preview, reopening and submitting the retained answers succeeded. Regression tests cover direct Retry/idempotency paths and now guarantee non-technical timeout recovery messages. No account assessment or subscription was deleted, and no new real account-save/payment was necessary for this browser test.
- Browser layout checks at 360, 390, 768, 1024 and 1440 pixels found no document or guided-dialog horizontal overflow for the landing/results and streaming-guide flows. Netflix has exactly one ads question, a required-title field and no storage field; unanswered ads stay unanswered. Additional menu/profile checks use the small viewport and preserve Clerk branding. The server-verified owner saw free ChatGPT plans; guest direct API calls did not reveal restricted offers. Ordinary/beta identity variants are automated tests, not separate real browser account sessions. This is not a screen-reader certification or a full cross-browser/device lab.
- Dropbox showed its storage question without streaming title/advertisement questions. The owner's existing saved-audit list loaded, with no horizontal overflow at all five widths. The actual Clerk profile modal's generated placeholder was green; its branding stayed visible. No user photo or account profile was edited.
- Dedicated Chrome DevTools profiling is unavailable, so Lighthouse and measured LCP/CLS/INP are **not completed**. Code/asset audit: system fonts, no render-blocking remote fonts or analytics script, no landing-image download (social PNG is metadata only), bounded/deduplicated requests, no public source maps. New functionality adds a small amount of JS/CSS; no framework or browser dependency was added.
- Final approximate bundle sizes: main JS 116.9 kB / 37.2 kB gzip, shared JS 24.0 / 8.9, main CSS 40.3 / 7.9, shared CSS 30.0 / 6.7; combined primary JS grew about 5.2 kB gzip from baseline. The improved public-search startup removes the Clerk wait; no synthetic speed score is claimed. Social PNG is 65.6 kB. Built-asset scan found zero private offer IDs, zero source maps and zero secret-key-like values. Only `.env.example` / `.dev.vars.example`, not private environment files, are tracked.
- Cloudflare configuration/types generation and **local dry-run** Worker bundling succeeded. No deployment occurred. The Git-linked production trigger includes only `main`, not this review branch. Existing GitHub Pages deploy job skips pull requests.

## Remaining launch decisions — do not invent or silently enable

1. Supply and publish the operator/legal identity and a suitable public support/privacy contact. The signed-in account email is not treated as permission to publish it. Finalize terms and required notices appropriate to the actual operator/jurisdictions; this patch is not legal approval.
2. Review account-history retention/deletion/export handling. Local clear/export is not account-history deletion/export; the privacy page discloses that the account-history self-service interface is not yet present.
3. Plan the Clerk production-instance transition separately, including trusted origins, owner/beta metadata and existing user/audit ownership. Changing instance keys does not automatically transfer existing user IDs or saved account history.
4. Approve deployment only after reviewing this PR and proposed analytics bindings/privacy text, then verify remote event storage and the complete live flow. No new code in this PR is claimed live.
5. Keep payments paused. Production Stripe credentials/prices, webhook and entitlement checks, seller/purchase information, monthly renewal/cancellation and refund/lifetime terms remain a separate commercial launch gate. The owner panel cannot bypass that gate; pausing new purchases does not cancel any existing renewals.
