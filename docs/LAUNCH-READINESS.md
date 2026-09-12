# FeeVeto launch readiness — 12 September 2026

## Executive summary

**BLOCKING LAUNCH: FeeVeto is not yet cleared for its first public invitation.** The existing product works in the tested discovery and assessment flows, and this focused patch fixes realistic launch risks. A custom domain, Clerk Production, operator/contact information and the remaining real-account/browser matrix are outstanding. Production browser opt-in analytics and feedback ingestion are verified for the tested flow. None of the remaining gates is replaced by a local test result.

Work continues on `fix/public-beta-launch-readiness`, created from current main `eed56eee72cbfe094068c709ffd1bba6055904a0`. Existing history and local work were preserved. This patch has not been merged or deployed; DNS, production configuration, user accounts and payments were not changed. No catalogue expansion, paywall activation or new product architecture is included.

## Reconstructed product state

These classifications describe implementation and the evidence available, not blanket launch approval.

| Component | Classification | Current state |
| --- | --- | --- |
| Landing, intent recognition, discovery | READY | Optional-account, supported-service rules; six launch services return public suggestions |
| Private catalogue and matching | READY | 172 validated private offers; compatibility and access filtering precede ranking |
| FeeVeto Match, pros/cons, explanation | READY | Deterministic verified-priority coverage; sparse results have no percentage; unknown prices stay unknown |
| Advanced audit, currency | READY | Guided assessment and original-currency calculations work in tested cases; no invented exchange rates |
| Browser saving/revisiting/editing | READY | Final Chrome guest save/edit/refresh retained one original-currency record without duplication |
| Account saving/revisiting | NEEDS FIX | Implemented with owner-scoped D1 history and retry/idempotency tests; final real Production-account matrix still required |
| Clerk and complimentary access | NEEDS FIX | Server-checked private metadata works; deployed instance is Development, not Production |
| Cloudflare/API/security | NEEDS FIX | Existing deployment healthy; this patch's headers and abuse controls await approved deployment |
| Analytics | READY | Live Chrome opt-in landing/search/result events confirmed in Analytics Engine storage |
| Feedback ingestion | READY | Synthetic direct and browser feedback confirmed in storage; browser acknowledgement visible |
| Privacy/SEO/domain | NEEDS FIX | Privacy corrections in patch; operator/contact and custom-domain migration unresolved |
| Account-history self-service deletion/export | NOT IMPLEMENTED | A verified manual privacy-request process is needed; local export/delete is not account-history export/delete |
| Stripe/Owner controls | NOT REQUIRED FOR LAUNCH | Existing implementation retained; new purchases disabled |
| Banks, auto-cancellation, LLMs, alerts, app, expanded admin/catalogue | NOT REQUIRED FOR LAUNCH | Explicitly deferred |

## DONE IN CODE — changes, bugs and security fixes

- Correcting an inferred free-only intent now updates the actual request instead of retaining a hidden stale filter.
- Failed alternative refresh no longer announces “Alternatives updated” to screen readers. The status now reflects success or failure; the real rate-limit/retry check exposed this bug.
- JSON imports reject files above 5 MiB and lists above 1,000 subscriptions before replacement. Existing data survives rejected imports; file and parsed-record limits are both checked.
- Worker responses gain anti-framing CSP, `X-Frame-Options: DENY`, `nosniff`, and a referrer policy. CSP is deliberately narrow: it does not pretend to be a complete script allowlist or break Clerk's challenges.
- Same-origin browser API checks reject cross-origin requests. Existing Clerk session verification, owner-scoped SQL, private admin/beta metadata and separate paid entitlements remain authoritative. Origin checks are not authentication.
- New short-lived API and write rate limiters fail safely when missing. Read-only matching POSTs do not consume the stricter write bucket. Stripe webhooks retain signature verification and feedback retains its own protection.
- Unexpected failures return a safe reference instead of raw dependency errors; logs contain a fixed operation and random reference, not bodies, tokens, email or financial information.
- Wrangler moved to 4.131.1 with patched sharp 0.35.4, resolving dependency advisory `GHSA-rgj7-g3m4-5g8c`; the fresh dependency audit reports zero known vulnerabilities, not a guarantee against unknown issues.
- GitHub Actions now runs quality checks only. The obsolete static Pages deployment is removed, preserving the required **Quality checks** job.
- README corrects Node support, Owner functionality and disabled-payment status. Historical reports are explicitly dated evidence. Privacy explains Clerk's pre-login requests, account-history limitations and inactive payments; third-party trademark ownership is stated.

No authentication bypass, frontend catalogue, invented review, price, discount or affiliation was introduced. Legacy storage identifiers are retained intentionally; development examples in historical instructions are not production links.

## Production configuration — observed versus proposed

Current public host: [FeeVeto](https://feeveto.edward-nyarko.workers.dev/). Worker `feeveto` serves `worker.js` and `dist` through `ASSETS`; APIs remain same-origin. Its Git integration tracks **main only**, build `npm run build`, deploy `npx wrangler deploy`, Node 22. The active build/deployment is successful. No custom Worker domain is configured.

| Setting | Required state |
| --- | --- |
| Build `VITE_CLERK_PUBLISHABLE_KEY` | Production publishable key after approved migration; currently Development |
| Runtime `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Same Clerk instance; secret only in encrypted Worker runtime settings |
| `CLERK_AUTHORIZED_PARTIES` | Exact approved additional HTTPS origins if needed; current request origin is already included by server code; no extra origins currently configured |
| `BILLING_ENABLED` | Keep `false`; current runtime `BILLING_MODE=live` does **not** mean purchases are enabled |
| Stripe setup | No new production Stripe credentials/products needed for free beta; do not copy sandbox configuration |
| `FEEVETO_ALTERNATIVES` | Existing KV `cb8a5e7564cf4d3f8c3ace6cc712b69e`, key `catalogue:v2`, schema 2 |
| `FEEVETO_BILLING` | Existing D1 `feeveto-billing`, ID `3d000ffe-251a-4a58-8b72-17193ba956b0` |
| `PRODUCT_ANALYTICS_ENABLED` / `FEEVETO_EVENTS` | Existing `true` / `feeveto_product_events`; endpoint enablement is not visitor consent |
| `FEEVETO_EVENT_LIMIT` | Existing namespace `260908001`, 60 requests/60 seconds |
| `FEEVETO_API_LIMIT` | **New, not live:** namespace `260912001`, 120 requests/60 seconds |
| `FEEVETO_WRITE_LIMIT` | **New, not live:** namespace `260912002`, 20 requests/60 seconds |
| Runtime preservation | Keep `keep_vars=true`, existing secrets, KV/D1, and sampled redacted observability |

Rate limits are approximate per Cloudflare location/IP, not globally exact or per-account quotas. Deploy the reviewed Worker and both new bindings together: missing limiters intentionally produce a retryable 503. This patch requires no SQL migration or catalogue upload. Cloudflare guidance informed these safeguards. [Build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

## REQUIRES MY ACTION — domain, Clerk and Cloudflare

### Domain and Cloudflare

1. Supply the actual owned production domain and preferred apex/www hostname; none is invented here. With an active owned Cloudflare zone, open Worker **feeveto → Settings → Domains & Routes → Add → Custom Domain**. Review existing DNS records before changing them; Cloudflare creates the Worker DNS record and certificate. Do not overwrite unrelated services. [Custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
2. Choose one canonical host. Configure deliberate HTTP-to-HTTPS and alternate-host redirects, preserving useful paths without redirect loops. Verify the homepage and APIs on that host before redirecting the old host. Update homepage/privacy canonical URLs, Open Graph/Twitter URLs, robots and sitemap together.
3. Before changing origins, export needed browser subscriptions on the old host, then import on the new one. Browser drafts, consent and preferences do not automatically move between domains.
4. Keep production branch `main`, locked dependency installation, and Node compatible with `package.json` (22.22.2+ in 22.x, 24.15.0+ in 24.x, or 26+). Preserve runtime secrets separately from build variables. Only after review, deploy the same checked main commit with the new rate-limit bindings. [Build image configuration](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
5. If a previous GitHub Pages site remains published, unpublish it under repository **Settings → Pages**. Removing its workflow does not remove an old deployment. [GitHub instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site)

### Clerk Production

Clerk CLI 3.3.0 inspection identified app `app_3IxBTR7IHayTnEm7oToPCrk8yNL`, Development instance `ins_3IxBTTlpepCSsqN31SCskV1uNr1`; Production is not configured.

1. In [Clerk Dashboard](https://dashboard.clerk.com/), select FeeVeto, then **Development → Create production instance**. Clone appropriate settings, then review the remaining checklist. Set the owner-approved domain and add the exact DNS records Clerk supplies; its CNAME records should be DNS-only, not Cloudflare-proxied. Complete certificate verification. Follow the [production checklist](https://clerk.com/docs/guides/development/deployment/production).
2. Reconfigure chosen sign-in providers with production OAuth credentials and exact callbacks; verify Paths/redirect settings and restrict allowed subdomains/origins. Do not copy development callback URLs to public production.
3. Securely replace the Cloudflare build publishable key and matching runtime publishable/secret pair together during the approved release. Never put a secret in a `VITE_` variable, Git, PR or chat.
4. Recreate owner/test accounts deliberately. Development users and metadata do not automatically transfer. Decide how existing D1 assessments remain accessible before switching IDs: preserve a private backup and use verified ownership mapping or an explicit old-history policy, never automatic email matching. [Instance separation](https://clerk.com/docs/guides/development/managing-environments)
5. Under **Users → account → Metadata → Private metadata**, merge these keys without erasing unrelated metadata:
   - Owner: `{"role":"admin","betaAccess":false}`.
   - Friend: `{"role":"user","betaAccess":true}`.
   - Ordinary: `{"role":"user","betaAccess":false}` or absent permissions.
   Do not use public/unsafe metadata or quoted booleans. Reload and test each role; beta is not admin.
6. Complete actual sign-up, sign-in, profile, refresh/session persistence, save/reopen and sign-out on the new domain. Developer CLI login is not website login. Production login remains blocked until this succeeds.

## Legal/privacy input still needed

Supply the operator's publishable identity, operating country and appropriate contact/address details, plus a monitored **private** support/privacy channel. A GitHub username or anonymous yes/no feedback is not a substitute. Agree a process for verified account-data export/deletion requests and retention of D1 assessments/backups. Deleting a Clerk profile currently does not delete D1 history.

Confirm processor contracts, international processing/transfer disclosures and applicable user rights for the actual operator and target markets. If Swiss FADP applies, FDPIC guidance requires controller identity/details, purposes, relevant recipients and applicable foreign-processing information. This is a readiness review, not legal approval. [FDPIC guidance](https://www.edoeb.admin.ch/en/duty-to-provide-information)

Payments stay disabled. Paid-sale terms, refunds, recurring billing and lifetime promises must be completed before a later commercial launch, not manufactured to delay the free beta.

## Tests, browsers and evidence limits

**Local:** clean locked install, **344 tests passed**, production build passed, dependency audit zero. The final suite includes the refresh-announcement regression found during browser testing. Patched Wrangler type generation and Worker packaging dry run passed. Tests cover role/ownership boundaries, imports, currency, deterministic scoring, retries and duplicate saves. Secret-pattern scans of reachable Git refs and built assets found no matches; only example environment files are tracked and client source maps are absent. These are scoped scans, not proof that every possible secret pattern is detectable.

**Live:** homepage, privacy, robots and sitemap returned 200. Canva, Netflix, ChatGPT, Claude, Photoshop and Dropbox each returned 200 and three general suggestions without a fabricated score. Detailed Canva assessment returned a switch result with a $240 original annual cost. Anonymous saved-audit/admin requests returned 401. Final local Worker checks repeated all six services, verified anti-framing headers and cross-origin 403s, guest access 200 and anonymous admin/audits 401; the new protections are not yet live.

**Browsers:** the in-app browser recognized the live owner. Local real Clerk Development and the real private catalogue produced a complete Canva assessment: one must-have plus country/platform and switching context yielded explainable 100% verified-priority coverage; unknown prices remained unknown. Results had no horizontal overflow at 360, 390, 768, 1024 and 1440 pixels. Native Safari completed signed-out Canva discovery on the final local build. A temporary local preview/tool hang was recovered; Chrome and Safari were working again for the final checks.

Final local Chrome evidence:

- All six example buttons worked. Free ChatGPT correctly showed access restriction for an ordinary visitor under the preserved commercial model. Correcting the goal to Spend less restored three paid results and All filtering.
- EUR examples displayed €2,184 and €516, with the selection retained after refresh.
- A guest Canva entry at CHF 12.50/month retained its original CHF currency and CHF 150 annual cost while the global preference was GBP. GBP totals showed no invented zero; an explicit CHF subtotal remained visible. Edit/save still showed one record, and refresh retained both the GBP preference and CHF record.
- Clear audit initially focused Keep; Escape closed it, returned focus to Clear audit and left the record intact.
- Exercising the local limiter with 121 requests produced HTTP 429. Refresh alternatives showed wait/retry guidance and kept the saved record. After the limit window, Retry restored three alternatives without changing the price or duplicating the record. The incorrect success announcement found in this test is fixed in code.
- No unexpected error-level Chrome console logs appeared in normal flows. Deliberately induced HTTP 429 responses produced expected network errors during fault injection. Earlier warnings concerned Development Clerk and structural avatar CSS.

Still **incomplete**: the four actual Production roles, real Production account save/login/session/sign-out, manual JSON import/export, full modal/mobile states, Firefox, physical devices, VoiceOver and complete accessibility testing. These are not inferred from automated tests or the sampled browser checks. Use fictional information and dedicated test accounts.

**Links:** 15 unique public result links checked: 11 returned 200; Perplexity, DxO, Box and Icedrive returned 403 to automated requests, but their official help/product/plan pages were subsequently retrieved through web checks. No broken 404 was found; those four responses are bot restrictions, not evidence that the services disappeared. A Hulu link redirected to Disney+ in the Swiss test context; its regional intent/current destination still requires manual confirmation. Official-source retrieval does not certify every destination's experience on every device or market.

**Measurement:** fresh production **browser opt-in analytics and feedback ingestion are verified**. The first synthetic direct feedback event was accepted at `2026-09-12T12:13:20.818Z` and confirmed in storage. Then measurement was temporarily enabled in the existing live Chrome session, using the existing fictional Photoshop query and explicit feedback. Cloudflare Analytics Engine Studio's read-only grouped query confirmed one `landing_visit` at `12:15:56`, and one each of `intent_submitted`, `service_recognized`, `alternatives_requested` and `alternatives_shown` at `12:15:57` on 12 September 2026 UTC. Feedback samples increased from one before QA to three, latest `12:16:00`; the browser also displayed its acknowledgement. Consent was unchecked again, restoring its original setting. These points are synthetic QA traffic, not real-user behavior or conversion results. The earlier SQL-connector failure was worked around through Studio; success is based on stored events, not only HTTP acknowledgements. Consent/privacy-signal and simulated-failure regressions pass locally; this is not a complete production privacy-signal matrix. `account_signup_started` exists, but no completed-registration event or unique-user funnel is implemented or claimed.

**Performance:** main JS 117.20 kB / 37.30 gzip; shared JS 24.83 / 9.16; CSS 70.33 / 14.56 combined. The dedicated profiler was unavailable, so Lighthouse, LCP/CLS/INP and a full mobile performance trace were not measured. Bundle sizes are not a performance score.

Stripe lifecycle tests in the automated suite are not new hosted-checkout evidence. No live/test charge was initiated in this pass; broader payment verification remains a separate launch gate described in [BILLING.md](BILLING.md).

## Launch gate

PASS below is scoped to the stated evidence. Overall result remains **BLOCKED**.

| Gate | Status | Evidence or remaining action |
| --- | --- | --- |
| Production custom domain | BLOCKED | Owner must choose/configure it |
| HTTPS | PASS | Current workers.dev HTTPS works; recheck chosen host |
| Production build/reproducibility | PASS | Locked install/build; main-only Worker deployment identified |
| Critical console errors | PASS | No unexpected errors in normal Chrome flows; induced 429 network errors were expected. Remaining browser/Production-auth matrix is separate |
| Canva/ChatGPT/general alternatives | PASS | Live six-service API checks and sampled browser rendering |
| Netflix behavior | PASS | Sensible general, provisional suggestions; no library guarantee |
| Advanced audit/edit/guest save | PASS | Real local assessment plus final Chrome one-record edit/save/refresh checks |
| Production account persistence | BLOCKED | Real Production login/save/reopen/sign-out matrix still required |
| Explainable Match | PASS | Deterministic coverage tests; sparse results unscored |
| Official links | BLOCKED | No broken 404; official sources recovered for four bot-gated sites. Hulu's Swiss redirect still needs confirmation |
| Mobile complete journey | BLOCKED | Five result widths passed; remaining modal/auth/error states unverified |
| Clerk Production login | FAIL | Production instance not configured |
| Ordinary cannot claim admin/beta | PASS | Server policy/forgery regressions; real Production-role matrix pending |
| Private data denied anonymously | PASS | Live 401s and protected-catalogue/owner-isolation tests |
| Privacy/operator details | BLOCKED | Data-flow corrections in code; identity/contact/process pending |
| Browser opt-in analytics | PASS | Live Chrome landing/search/result events confirmed in storage; consent restored after synthetic QA |
| Feedback ingestion | PASS | Direct and browser QA feedback confirmed in production storage, with visible browser acknowledgement; not user metrics |
| Error states and recovery | PASS | Real local Chrome 429, retained record/price, and successful Retry after the limit window; not a production outage test |
| Rollback strategy | PASS | Stable identity, catalogue backup and D1 bookmark recorded; no restore exercised |
| Enable Stripe/payments | NOT REQUIRED | Keep purchases disabled |

## Stable rollback point and data safety

- Current stable source: **`eed56eee72cbfe094068c709ffd1bba6055904a0`**.
- Active Worker version: **`787dcf8b-d908-4a58-ac29-615a7e20a10d`**, 100% traffic.
- Deployment: `012e26db-6e7d-4fea-8aad-160008587d97`, 8 September 2026, 16:29 UTC.
- Earlier version: `b0a42f0c-0d79-4424-a9f8-8699268320d9`; not preferred over the current checked stable point.
- Private catalogue backup: `.private/launch-catalogue-20260912.json`, 172 valid records; SHA-256 `fe5207813883c3a3992a2268512031c7cb5d8d3a616421f839ad86b8a86e2ab9`.
- D1: 14 tables, 184,320 bytes observed. Current Time Travel bookmark was read successfully into `.private/launch-d1-bookmark-20260912.json`. No SQL export was run because it can pause database service; arrange one privately if needed before an approved data migration. No restore was performed.

For an approved code rollback: Cloudflare **Workers & Pages → feeveto → Deployments → stable version ⋯ → Rollback**, then repeat smoke tests and verify purchases remain disabled. Keep the referenced bindings/resources available. Rollback changes the active Worker version, not KV/D1 contents. All existing migrations are additive; preserve tables and new saves. Never restore an old database just to revert code. D1 recovery overwrites data and needs a separately reviewed incident plan; refresh bookmarks/backups before release because recovery windows expire. [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/)

## Exact recommended launch sequence

1. Resolve domain, operator/privacy contact, retention and Clerk identity-migration decisions; complete configuration preparation without unexpected live changes.
2. Review this one launch-readiness PR and all outstanding gates. Merge only when approved; merging main triggers the existing Cloudflare deployment.
3. Verify the deployed commit, runtime keys, unchanged KV/D1, new limiters and disabled payments.
4. Verify custom-domain HTTPS/redirects and Clerk Production with anonymous, ordinary, beta and admin testers.
5. Complete supported/unsupported/free/cheap discovery, advanced audit, edit/save/refresh/retry, original currencies, sign-out, mobile and remaining browsers. Recheck official destinations.
6. Reconfirm the tested opt-in analytics and feedback storage flow after the approved release/domain change; failure must not interrupt the audit.
7. Confirm the stable rollback version, current configuration record and private backups. Do not invite users while any critical gate remains FAIL/BLOCKED.
8. Invite 10–20 private testers; fix critical issues only. Then invite approximately 20–50 external beta users, measure aggregate behavior and address the largest observed problem before wider promotion.

## OPTIONAL AFTER LAUNCH and manual destinations

After the approved domain is live, use [Google Search Console](https://search.google.com/search-console/): add a Domain property, publish its generated DNS verification record, verify, submit `sitemap.xml`, and inspect the homepage/privacy URLs. [Verification instructions](https://support.google.com/webmasters/answer/34592?hl=en)

Useful later pages: `/canva-alternatives`, `/chatgpt-alternatives`, `/netflix-alternatives`, `/photoshop-alternatives`, `/dropbox-alternatives`, `/claude-alternatives`. Do not generate thin pages or expand features to postpone this beta. Completed-signup measurement, broader catalogue work and commercial activation are separate decisions.

Manual destinations: [repository and PRs](https://github.com/Asvenor/FeeVeto-Be-smarter-about-subscriptions/pulls), [Cloudflare dashboard](https://dash.cloudflare.com/), [Clerk dashboard](https://dashboard.clerk.com/), [live FeeVeto](https://feeveto.edward-nyarko.workers.dev/), [current privacy page](https://feeveto.edward-nyarko.workers.dev/privacy.html). The changes described as DONE IN CODE remain review-branch work until an approved deployment is verified.
