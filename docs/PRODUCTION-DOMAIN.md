# FeeVeto production-domain release — 12 September 2026

## Current outcome

**The website and tested guest alternatives are live at [feeveto.com](https://feeveto.com/). Full public-launch readiness is not yet confirmed.** Production Clerk setup exists, but the deployed application still uses Development authentication. The user paused Google setup before creating its consent application or OAuth client. Production account sign-in, access roles and saved-audit verification remain required before declaring the account launch complete.

The owner approved this custom-domain release and direct Worker deployment. Payments remain disabled. No catalogue replacement, database migration, identity migration, paid plan purchase or new payment activation was performed for this release.

This is a dated operational snapshot. It supersedes the deployment/domain/contact status in the earlier [launch-readiness report](LAUNCH-READINESS.md), without erasing that report's evidence or outstanding broader QA requirements.

## Source and deployment record

| Item | Verified release value |
| --- | --- |
| Public origin | `https://feeveto.com` |
| Cloudflare Worker | `feeveto` |
| Deployed source commit | `9d4f06441698db8ba4bdba13da1a18820c07c08f` |
| Deployed Worker version | `1355ad25-4310-42fd-8290-8d4ecaef858a` |
| Deployment method | User-approved Wrangler deployment |
| Source pull request | [PR #20](https://github.com/Asvenor/FeeVeto-Be-smarter-about-subscriptions/pull/20), open and not merged at this snapshot |
| Current `origin/main` | `071a37b512cc17efc19112288af151743cb5a18a` |
| Pre-release rollback Worker version | `c8314fee-30d1-476c-b38c-c46e137ba23a` |

The live Worker therefore contains the reviewed domain patch ahead of `main`. A future Git-triggered deployment from `main` can replace it until PR #20 is reviewed and merged. Do not describe the PR as merged or the deployment as originating from `main`. Recheck the deployed version after any subsequent release.

## Changes included

- Apex-domain routing for `feeveto.com` and a canonical redirect from `www.feeveto.com`, preserving the request path and query.
- HTTPS redirects for the tested HTTP apex request.
- Canonical, Open Graph, social-image, robots and sitemap URLs on `https://feeveto.com`.
- Preserved access to the former Worker origin so existing browser-local data can still be exported.
- Public privacy operator: **Edward Nyarko**. Support, privacy and account-data contact: [inbox_business@outlook.com](mailto:inbox_business@outlook.com).
- An explicit manual contact path for account-history access, export or deletion requests, requiring verified account ownership. No self-service account-history export/deletion feature or legal-compliance guarantee was added.
- Focused domain-routing, metadata and documentation tests. Existing access, matching, storage and payment rules were retained.

## Local automated verification

| Check | Result |
| --- | --- |
| Locked dependency installation (`npm ci`) | PASS |
| Full `npm run check` | PASS — 353 tests, no failures |
| Production build | PASS |
| Fresh dependency advisory audit | PASS — 0 known vulnerabilities reported |
| Additional affected-test run | PASS — 50 tests |
| Scoped source/build secret and private-catalogue checks | PASS — no matching secret/private-key patterns, serialized private catalogue or browser source maps found |

Private credential files remain ignored and restricted to owner read/write permissions (`0600`). No secret values are part of this report or browser assets. The pattern scan is a bounded verification, not a claim that arbitrary secret formats are mathematically impossible.

## Verified live results

These checks used the deployed custom domain, not only local or mocked responses.

| Request or flow | Observed result |
| --- | --- |
| `https://feeveto.com/` | HTTP 200 |
| `https://www.feeveto.com/…` | HTTP 308 to the apex; tested path and query preserved |
| `http://feeveto.com/…` | HTTP 308 to HTTPS; tested path and query preserved |
| Former `https://feeveto.edward-nyarko.workers.dev/` | HTTP 200, retained for old-origin data access |
| `/privacy.html` → `/privacy` | HTTP 307 then HTTP 200; confirmed operator/contact details present |
| Anonymous `/api/access` | Ordinary access; premium/admin/complimentary flags false |
| Anonymous `/api/admin/status` and `/api/audits` | HTTP 401 |
| `/api/billing/plans` | New purchases unavailable |
| Basic Netflix alternatives | Three general, guest-accessible paid offers |
| Basic Canva alternatives | Three general, guest-accessible paid offers |
| Basic Dropbox alternatives | Three general, guest-accessible paid offers |
| Tested private-asset paths | HTTP 404 |

“Paid offers” above describes the alternative providers' plans, not a FeeVeto purchase requirement. Restricted comparisons were not unlocked to make these results appear. Sparse suggestions remain general recommendations, not confirmed personalised matches.

The privacy page's `.html` URL currently redirects to the clean `/privacy` path. This redirect was verified and is not a missing privacy page.

A real browser check on the apex also rendered Netflix suggestions using the browser's existing EUR preference: two general suggestions, with unknown pricing kept unknown. The existing draft and currency preference were retained. This is distinct from the three-offer basic API checks above, which can differ by market.

## Clerk and Google setup: what is complete and what is pending

The Production Clerk instance is `ins_3JEK1lmSsHvIcMi1IrgnQBBX0Xk`.

Completed for the new instance/domain:

- Production instance created for FeeVeto.
- All five required CNAME records created as DNS-only records.
- Clerk DNS, mail and SSL setup reports complete.
- Private key material kept outside Git in ignored files with `0600` permissions.
- The user approved Google and email sign-in. Apple is disabled in Production because the required developer membership is absent; no paid developer plan was purchased.
- Google Cloud project `feeveto` created without enabling billing.

**Paused by the user:** Google only offered the account owner's personal address for the public consent-screen support contact. The user declined to publish that address, so setup stopped before the consent application or OAuth client was created. No personal address was published on a consent screen. The unbilled project remains available; no account or project was deleted. A separately approved support identity, or explicit approval to launch with email sign-in alone, is needed before continuing.

The Cloudflare runtime Clerk pair and frontend build publishable key **still use the matching Development instance**. Creation of a Production instance or successful DNS validation does not mean the running application has switched to it. The Clerk CLI's aggregate readiness check still lists Apple because its workflow compares against providers enabled in Development; the Production configuration was separately verified with Apple disabled by explicit user choice. Do not re-enable it merely to satisfy that workflow.

Required follow-through:

1. Resolve the paused Google support-identity choice, then finish the consent/client configuration with the exact Clerk Production callback and approved domain settings. Alternatively, obtain explicit approval for email-only Production sign-in.
2. Verify the intended Google and email methods in Production.
3. Update the frontend build publishable key and runtime publishable/secret key together to the matching Production instance; retain encrypted server-only secret storage.
4. Build and deploy the matching frontend/backend configuration, then verify real Production sign-in and sign-out on `feeveto.com`.
5. Assign the intended owner/beta roles only through server-controlled Clerk private metadata. Verify signed-out, ordinary, beta and owner access separately; missing permissions must remain ordinary unpaid access.
6. Verify account save, revisit, edit, retry and account-isolation behavior under the new Production identities. Do not infer success from a sign-in dialog or a locally passing policy test.

Production account creation does not migrate Development user IDs or their account-saved assessments. No identity mapping or reassignment has been performed. Any later migration needs explicit ownership verification and a documented scope; email similarity alone is not authorization to transfer data.

## Data preservation and rollback

The existing private catalogue and D1 account/billing data were not replaced or migrated. Existing backups and recovery evidence remain referenced in the [launch-readiness report](LAUNCH-READINESS.md).

Browser-local subscriptions, currency preferences and unfinished drafts belong to their origin. They do not automatically appear on `feeveto.com` from the old Worker address. Keep the old address accessible while users export their local subscriptions there and import them on the new site. Local exports do not transfer Clerk accounts or account-saved assessment history.

If this release must be rolled back, review the current deployed state and restore the pre-release Worker version `c8314fee-30d1-476c-b38c-c46e137ba23a` through the normal approved rollback process. A code rollback is not a DNS rollback and does not restore KV, D1, Clerk configuration or Google OAuth settings. Preserve newly saved data; do not restore an old database merely to undo a code release.

If authentication configuration has subsequently switched to Production, review the frontend/runtime key pairing and account implications before any rollback. Never leave a Development frontend using Production backend keys, or the reverse. Record the resulting Worker version and retest the affected live flows.

## Launch status and remaining boundaries

- **Live and verified:** custom-domain guest website, tested alternatives, redirects, published privacy contact, anonymous access restrictions and disabled purchases.
- **Not yet complete:** running Production Clerk authentication, Google consent/client setup and the new Production account-role/saved-audit matrix.
- **Still manual:** handling privacy/account-data requests through the supplied contact with verified ownership; no self-service account-history export/deletion UI.
- **Not implied by this release:** completion of the broader physical-device, browser, accessibility or performance matrix listed in the earlier launch report, legal compliance, payment launch or a public announcement.

Finish and record the pending authentication work, complete the real-account checks and reconcile PR #20 with `main` before declaring this a fully verified account-enabled public launch. Payments remain a separate, disabled release gate.
