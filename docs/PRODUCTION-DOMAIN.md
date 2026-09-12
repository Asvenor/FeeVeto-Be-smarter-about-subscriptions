# FeeVeto production-domain release — 12 September 2026

## Current outcome

**The website, tested guest alternatives and email-only Production authentication are live at [feeveto.com](https://feeveto.com/). A real signed-in account has saved, reloaded and reopened an audit successfully, then signed out with protected details cleared. Full public-launch readiness is not yet confirmed.** The user approved launching with email authentication while Google setup remains paused. The deployed frontend and backend use the matching Production Clerk instance. The broader real-account role/isolation matrix, fresh sign-in after logout and remaining launch checks are still outstanding.

The owner approved this custom-domain release and direct Worker deployment. Payments remain disabled. No catalogue replacement, database migration, identity migration, paid plan purchase or new payment activation was performed for this release.

This is a dated operational snapshot. It supersedes the deployment/domain/contact status in the earlier [launch-readiness report](LAUNCH-READINESS.md), without erasing that report's evidence or outstanding broader QA requirements.

## Source and deployment record

| Item | Verified release value |
| --- | --- |
| Public origin | `https://feeveto.com` |
| Cloudflare Worker | `feeveto` |
| Deployed source commit | `fedcf0e26b80c4b484a69d4961c67567aaa6385d` |
| Deployed Worker version | `1ee5a133-6367-4fdf-9e7a-4afe467feaaa`, serving 100% of traffic |
| Deployment ID | `90607dec-c31d-4bb0-8777-f0aa8ffca716` |
| Deployment timestamp | `2026-09-12T14:28:11.230433Z` |
| Deployment method | User-approved Wrangler deployment |
| Source pull request | [PR #20](https://github.com/Asvenor/FeeVeto-Be-smarter-about-subscriptions/pull/20), open and not merged at this snapshot |
| Current `origin/main` | `071a37b512cc17efc19112288af151743cb5a18a` |
| Pre-email-switch Worker version | `1355ad25-4310-42fd-8290-8d4ecaef858a` — Development authentication |
| Historical pre-domain Worker version | `c8314fee-30d1-476c-b38c-c46e137ba23a` |

The live Worker therefore contains the reviewed domain patch ahead of `main`. A future Git-triggered deployment from `main` can replace it until PR #20 is reviewed and merged. Do not describe the PR as merged or the deployment as originating from `main`. Recheck the deployed version after any subsequent release.

The initial domain release deployed source `9d4f06441698db8ba4bdba13da1a18820c07c08f` as version `1355ad25-4310-42fd-8290-8d4ecaef858a`. The later, user-approved email-only release atomically deployed the matching Production frontend and encrypted runtime Clerk configuration. The Cloudflare build publishable-key setting was also updated and verified through both its UI and API so future builds use Production. `BILLING_ENABLED=false` was preserved.

## Changes included

- Apex-domain routing for `feeveto.com` and a canonical redirect from `www.feeveto.com`, preserving the request path and query.
- HTTPS redirects for the tested HTTP apex request.
- Canonical, Open Graph, social-image, robots and sitemap URLs on `https://feeveto.com`.
- Preserved access to the former Worker origin so existing browser-local data can still be exported.
- Public privacy operator: **Edward Nyarko**. Support, privacy and account-data contact: [inbox_business@outlook.com](mailto:inbox_business@outlook.com).
- An explicit manual contact path for account-history access, export or deletion requests, requiring verified account ownership. No self-service account-history export/deletion feature or legal-compliance guarantee was added.
- Focused domain-routing, metadata and documentation tests. Existing access, matching, storage and payment rules were retained.
- Matching Production Clerk frontend/backend configuration, with email authentication enabled and Google, Apple and username authentication disabled by the approved launch scope. No payment or paid-entitlement activation accompanied this switch.

## Local automated verification

| Check | Result |
| --- | --- |
| Locked dependency installation (`npm ci`) | PASS |
| Full `npm run check` | PASS — 353 tests, no failures |
| Production build | PASS |
| Fresh dependency advisory audit | PASS — 0 known vulnerabilities reported |
| Additional affected-test runs | PASS — 50 tests for the domain patch; 75 focused tests for the Production email release |
| Documentation-targeted verification | PASS — 16 tests |
| Scoped source/build secret and private-catalogue checks | PASS — no matching secret/private-key patterns, serialized private catalogue or browser source maps found |

Private credential files remain ignored and restricted to owner read/write permissions (`0600`). No secret values are part of this report or browser assets. The pattern scan is a bounded verification, not a claim that arbitrary secret formats are mathematically impossible.

## Verified live results

These HTTP checks were reverified on the deployed custom domain after the Production email switch, not only against local or mocked responses. Dependency installation, the full 353-test check, production build and zero-advisory audit were also rerun for that release.

| Request or flow | Observed result |
| --- | --- |
| `https://feeveto.com/` | HTTP 200 |
| `https://www.feeveto.com/…` | HTTP 308 to the apex; tested path and query preserved |
| `http://feeveto.com/…` | HTTP 308 to HTTPS; tested path and query preserved |
| Former `https://feeveto.edward-nyarko.workers.dev/` | HTTP 200, retained for old-origin data access |
| `/privacy.html` → `/privacy` | HTTP 307 then HTTP 200; confirmed operator/contact details present |
| Public frontend assets | Production Clerk configuration present; no Development Clerk configuration or secret values found in the checked assets |
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

After the email switch, the existing browser draft and EUR preference survived reload. The browser loaded both Clerk and its UI scripts from `clerk.feeveto.com`; the Account dropdown displayed Sign in and Sign up. An extension popup initially interrupted sign-in automation; that blocker was subsequently cleared. The user reported completing registration, and the real browser then showed Signed in. Email-inbox delivery and verification-code entry were not inspected or independently recorded.

The signed-in session survived refresh and the account-history request initially returned the proper empty state. The following checks then used the user's real Production session, not a mocked token or impersonation:

- With no existing local subscription entries, one explicitly fictional test entry, `Netflix — launch test (fictional)`, was added at **€10 per month**.
- Save and review displayed **“Saved to your account and this browser”** and rendered two general EUR-market alternatives.
- Saved audits displayed **Netflix** with **one dated assessment**. The history heading normalizes the service name, so it does not repeat the local fictional-entry suffix.
- After a full reload, Signed in was restored and the same single Netflix assessment was fetched from account storage. No duplicate was created by the reload.
- Reopening that saved assessment displayed Your personal audit with **€120 annual cost** from **€10 EUR/month**, several-times-per-month use, two general alternatives and explicitly unknown provider prices. History remained at version 1 with only one assessment.
- Sign-out cleared the protected result details. Saved audits displayed **“Sign in to open account audits. Your local audit still works without an account.”** No Netflix account-history item remained rendered while signed out.

The fictional €10 Netflix entry remains in both this browser's local subscriptions and the Production account's saved history. It is QA data, not evidence of a real subscription or spending. No other local entries were replaced, no account history was migrated, and no owner/beta permissions were granted during these checks. The browser was left signed out after the privacy check. An attempt to open sign-in again for handoff was blocked by another Chrome extension popup; no fresh login was completed, and the interruption does not demonstrate an authentication-code defect.

Fresh sign-in after logout, independent verification-email delivery/code timing, beta/admin access, account switching/isolation and live request-failure/retry remain unverified. Do not extrapolate those cases from the successful single-account save, reopen and logout checks.

## Production email authentication and paused Google setup

The Production Clerk instance is `ins_3JEK1lmSsHvIcMi1IrgnQBBX0Xk`.

Completed for the new instance/domain:

- Production instance created for FeeVeto.
- All five required CNAME records created as DNS-only records.
- Clerk DNS, mail and SSL setup reports complete.
- Private key material kept outside Git in ignored files with `0600` permissions.
- The user explicitly approved the email-only Production launch. The Production Frontend API reports email-code verification and email-code sign-in enabled. The existing signup password requirement was retained: “email-only” describes the available identity provider, not a promise that every registration step is passwordless.
- Username login, username signup and the required-username setting are disabled. Google and Apple are disabled in Production. Apple remains excluded because the required developer membership is absent; no paid developer plan was purchased.
- The matching Production publishable key is included in the deployed frontend and the corresponding runtime Clerk configuration is stored as encrypted bindings. Future Cloudflare builds are configured with the Production publishable key. No private key enters the browser build.
- Google Cloud project `feeveto` created without enabling billing.

**Google remains paused by the user:** Google only offered the account owner's personal address for the public consent-screen support contact. The user declined to publish that address, so setup stopped before the consent application or OAuth client was created. No personal address was published on a consent screen. The unbilled project remains available; no account or project was deleted. The later approval for email-only authentication resolves the immediate launch-method choice; it does not authorize resuming Google setup or publishing a personal address. Google is not required for this approved email-only release.

The initial domain deployment used Development keys; the current email release **uses the matching Production instance**. This was verified in the deployed runtime/frontend configuration and the Production Frontend API, not inferred only from successful DNS validation. The Clerk CLI's aggregate readiness workflow can still compare against social providers enabled in Development; Production settings were independently verified with Google and Apple disabled by explicit user choice. Do not re-enable either provider merely to satisfy that workflow.

Required follow-through:

1. Complete fresh sign-in after logout when the user is ready. The user's registration report, observed signed-in session, refresh restoration, authenticated save/reload/reopen and protected-data clearing on sign-out are recorded above; verification-email delivery/code timing was not observed directly.
2. Assign the intended owner/beta roles only through server-controlled Clerk private metadata after the corresponding Production accounts exist and ownership has been verified. Verify signed-out, ordinary, beta and owner access separately; missing permissions must remain ordinary unpaid access. No Production role grants were made in this check.
3. Extend the verified save/reload/reopen flow to editing, deliberate request-failure/retry and account-isolation checks under the new Production identities. Do not infer completion of the remaining cases from a successful single-account save.
4. Resume Google only after a separate approved support-identity decision and explicit user instruction. Keep it disabled otherwise; email launch does not depend on it.

Production account creation does not migrate Development user IDs or their account-saved assessments. No identity mapping or reassignment has been performed. Any later migration needs explicit ownership verification and a documented scope; email similarity alone is not authorization to transfer data.

## Data preservation and rollback

The existing private catalogue and D1 account/billing data were not replaced or migrated. Existing backups and recovery evidence remain referenced in the [launch-readiness report](LAUNCH-READINESS.md).

The real-account QA flow did create one new fictional Netflix assessment through the normal authenticated application save. It remains available for review; no database restoration, deletion or manual ownership reassignment was used.

Browser-local subscriptions, currency preferences and unfinished drafts belong to their origin. They do not automatically appear on `feeveto.com` from the old Worker address. Keep the old address accessible while users export their local subscriptions there and import them on the new site. Local exports do not transfer Clerk accounts or account-saved assessment history.

Before any rollback, review the current deployed state and approve the exact target. The immediate pre-email-switch version is `1355ad25-4310-42fd-8290-8d4ecaef858a`; it uses Development authentication and must not be treated as an interchangeable Production-auth release. The older `c8314fee-30d1-476c-b38c-c46e137ba23a` is retained only as the historical pre-domain rollback point. Reverting to either can make new Production accounts inaccessible even though their data remains stored. Prefer a reviewed fix that retains the Production identity configuration when feasible.

A code rollback is not a DNS rollback and does not restore KV, D1, Clerk configuration or Google OAuth settings. Preserve newly saved data; do not restore an old database merely to undo a code release. Review the frontend/runtime key pairing and account implications before any rollback. Never leave a Development frontend using Production backend keys, or the reverse. Record the resulting Worker version and retest the affected live flows.

## Launch status and remaining boundaries

- **Live and verified:** custom-domain guest website, tested alternatives, redirects, published privacy contact, anonymous access restrictions, Production email client loading, a real signed-in session restored after refresh, one account-saved audit fetched and reopened after reload, protected account details cleared on logout and disabled purchases.
- **User-reported:** Production registration completed. The resulting signed-in account was observed directly; mailbox delivery and verification-code entry were not.
- **Not yet complete:** fresh sign-in after logout, the complete Production account-role/isolation matrix and remaining saved-audit edit/failure/retry checks. Independent verification-email/code delivery timing was not observed. These require appropriate accounts and user participation.
- **Deliberately paused, not required for the approved email launch:** Google consent/client setup. Apple and username authentication remain disabled.
- **Still manual:** handling privacy/account-data requests through the supplied contact with verified ownership; no self-service account-history export/deletion UI.
- **Not implied by this release:** completion of the broader physical-device, browser, accessibility or performance matrix listed in the earlier launch report, legal compliance, payment launch or a public announcement.

Complete and record the real-account checks and reconcile PR #20 with `main` before declaring this a fully verified account-enabled public launch. Payments remain a separate, disabled release gate.
