# Intent-to-audit release

This branch evolves the existing FeeVeto app: instant supported-service discovery, optional two-stage questions, explainable server assessments, and account-owned append-only history. The old local subscription list and export format remain unchanged.

## Current release status — September 7, 2026

Published to [the live FeeVeto site](https://feeveto.edward-nyarko.workers.dev/) after explicit user approval of the saved-audit and refund-safeguard database additions. Source commit: `5e68d0a20c936faf2f6e16ec03f8153eeabcb88b`; active Worker version: `ebfe0537-bba6-4408-a4f9-823b2293f718`. Both migrations succeeded, existing Clerk secrets/KV were preserved, and D1 is now bound. No main-branch merge or payment activation was performed.

All 185 automated tests and the build passed. Live HTML, privacy, and main JavaScript match the tested build; public Netflix/Canva/Dropbox discovery and assessments passed, while guest history and forged-permission saves were denied. Real signed-in browser save/reopen and mobile/keyboard visual checks remain unverified; the existing Clerk development instance remains in use. Stripe setup and account-history deletion/export remain separate unfinished work.

The private pre-migration backup remains at `.private/feeveto-billing-before-account-save-20260907.sql` (ignored, owner-only). Previous Worker version: `01438779-02c2-4dbd-a667-fa6207dbc119`. Any rollback must be deliberate: retain the additive database tables and account records, and do not automatically restore an old SQL backup over new saves. The preview's localhost data is separate from live storage; transfer browser subscriptions only by explicit export/import, then save each desired entry while signed in.

The earlier checkpoint outcomes below document verification boundaries at the time; this approved publication supersedes their pending-deployment status, not their unresolved browser/payment limitations.

## Required configuration

- Build: matching Clerk publishable key as `VITE_CLERK_PUBLISHABLE_KEY` (public).
- Worker runtime: `CLERK_SECRET_KEY` as a secret, matching `CLERK_PUBLISHABLE_KEY`, and applicable `CLERK_AUTHORIZED_PARTIES`. Never put a secret key in frontend/build variables or commits.
- Existing private KV: `FEEVETO_ALTERNATIVES`, key `catalogue:v2`, schema 2. Creating a namespace does not populate it. Validate the existing private file; no catalogue import is required for this change if production data is healthy.
- Existing D1: `FEEVETO_BILLING` / `feeveto-billing`. Apply additive `migrations/0002_saved_audits.sql` before releasing the account-save routes. It adds a separate history table; it does not modify billing tables or upload browser subscriptions.
- Also apply `migrations/0003_refund_ordering.sql` for the payment safeguard found during integration testing. Refund tombstones prevent late or repeated checkout events from reviving a refunded payment. Paid access is pinned to `STRIPE_PRICE_ID`, so sandbox purchases cannot unlock a separately configured live Price. If changing the commercial Price later, explicitly preserve legitimate existing lifetime purchases through a reviewed migration/allowlist; do not simply swap the variable and abandon old entitlements. Prefer separate sandbox and production databases.
- No optional data API, AI service, new paid integration, or new catalogue records are needed.

## Local preview

Use Node 22.22.2+, 24.15.0+, or 26+ as specified in package.json. Run `npm ci` and `npm run check`.

Vite alone (`npm run dev`) previews the interface, not the Worker APIs. For a functional local preview:

```sh
npm run build
npx wrangler d1 migrations apply feeveto-billing --local
npx wrangler kv key put catalogue:v2 --binding FEEVETO_ALTERNATIVES --path .private/verified-alternatives.json --local
npx wrangler dev --local --ip 127.0.0.1 --port 8787 --env-file .env.local
```

Use only the existing validated private catalogue for realistic local verification. `.private/`, `.env*`, `.dev.vars*`, and `.wrangler/` are ignored (except safe example files). Before building, use the linked FeeVeto application's development instance with `clerk env pull --instance dev --file .env.local`. This securely writes `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` locally. Vite injects only the publishable key; the Worker accepts that same public-key variable alongside its server-only secret. Never print or commit the file. Do not mix this setup with `.dev.vars`: [Cloudflare's local environment rules](https://developers.cloudflare.com/workers/local-development/environment-variables/) give `.dev.vars` precedence over `.env` files.

The Clerk developer CLI login and website sign-in are separate. Refresh `http://127.0.0.1:8787/`, sign in through FeeVeto, personalise a result, and choose **Save this audit**. Refresh again and choose **Open my saved audits** to verify account persistence. CLI authorization, guest API checks, and mocked tests alone do not verify that flow. Without credentials, guest discovery/assessment works but account-save testing requires controlled test doubles and is not a real Clerk integration test.

## Explicit release actions (not run automatically)

1. Review the branch and checkpoint log. Confirm browser/mobile/real sign-in checks against a staging Worker with matching development Clerk credentials.
2. Back up production D1 according to the owner's retention policy. Apply `npx wrangler d1 migrations apply feeveto-billing --remote` only after release approval.
3. Keep existing Worker/KV bindings and securely configure missing runtime credentials. Build with the matching public key.
4. Deploy only after explicit approval. GitHub Pages is a static preview and cannot serve account/alternative APIs; the full experience requires Cloudflare Worker deployment.
5. Verify guest, ordinary, beta, admin, save/reopen/reevaluate, account ownership, and errors on the released host. Do not call local tests live verification.

Recovery: previous code can run with the additive table left in place. Keep existing commits and database history; do not delete the history table as an automatic rollback.

## Storage and access

### Unified subscription saving

`Save and review` now saves the submitted entry's account assessment when signed in, in addition to its existing browser copy. Guests keep the browser-only flow. The explanatory text appears beside the submit button; private notes are stripped from the account request. Existing entries are not bulk-uploaded on login: edit and save an individual entry to add it to the account.

The account endpoint derives a stable audit ID from the verified owner plus the submitted browser-entry ID. Edits append versions under that audit; request-key retries do not create duplicates. Unknown services can save a basic assessment without claiming a catalogue match. Current admin/beta/paid checks remain on the server.

Failed explicit form saves remain in `feeveto_subscription_account_outbox_v1` in tab session storage with the initiating account ID and structured input only. Retry uses the same request key. Another account cannot receive that pending save automatically. The UI reports browser-only, pending, successful account save, or retryable failure, and account lists reload after saves and sign-in. Clearing browser entries still does not delete account history.

`feeveto_state_v2` remains local subscriptions. `feeveto_journey_draft_v1` stores only the current request/answers, not protected comparisons. A tab-scoped pending-save request preserves explicit save intent through sign-in/retry. Each authenticated save is normalized and recomputed on the server, never taken from a browser-provided result or role.

`saved_audit_versions` uses verified Clerk ownership, owner-scoped request idempotency, and new rows for reevaluation. Reads and writes constrain the owner on the server. Complete historical snapshots are withheld when the account no longer has Premium; its own answers and dates remain available. Saves refresh the catalogue at save time, so the saved date/result may differ from the preceding preview. Local exports do not include account history. Self-service account-history deletion/export is not implemented; review this retention limitation before public launch.

## Data boundary and limitations

Future providers connect at `functions/_shared/catalogue-provider.js`, supplying checked records to the same schema, access, and ranking pipeline. Curated KV is the current source; external APIs are not called.

Recognition uses supported names and explicit phrases, not general AI reasoning. Limited categories/markets may return fewer than three suggestions. No ratings appear without a source, review count, scale, and date. Records older than 90 days require rechecking. Unknown capability/prices remain unknown; different currencies are never converted. New natural-language discovery does not replace the original detailed form for highly specific legacy requirements.

Stripe branding and sandbox webhook/secret configuration remain separate pending work. Browser policy verification currently blocks that approved dashboard operation. No live payment, production migration, merge, or deployment has been performed for this journey.

## Verified outcome on September 7, 2026

- Clean install (`npm ci --offline`), 180 automated tests, production build, and Worker packaging dry run passed. No production secrets or private environment files are tracked; none of the 42 private record IDs/descriptions occur in frontend bundles.
- Local migrations 0001/0002/0003 applied successfully. The real local Worker plus the existing 42-offer private catalogue returned guest Netflix/Canva/Dropbox suggestions (2/1/3), HTTP 200 assessments, a detailed Canva switch comparison, HTTP 401 for guest history, and correct unsupported/unknown-route errors. Run `node scripts/journey-smoke.mjs http://127.0.0.1:8787/` while the local Worker is running.
- Connected DOM tests execute real handlers and SQLite, with simulated Clerk identity and a fictional test fixture. They verify saving through sign-in, visible save failure/retry, duplicate prevention, reload recovery, back/close/reopen, stale-search protection, sign-out clearing, and dated history. They are not a visual browser or live Clerk/Stripe test.
- Browser policy verification blocked desktop/mobile visual and real authentication checks. New APIs are not deployed: last checked live `/api/access` was HTTP 200 and live `/api/assessment` was HTTP 404. This branch is not cleared for launch until browser/staging authentication checks and pending Stripe setup are completed.

### Local authentication setup follow-up

- Refreshed the official Clerk developer login, verified the existing FeeVeto app/development instance, and securely pulled matching development keys into ignored `.env.local` with owner-only file permissions. No production instance was configured or changed.
- Re-ran all 180 automated tests and the production build successfully with the public key present. An exact-value scan confirmed the secret key is absent from every frontend build file.
- Restarted the local Worker with local-only storage and explicit `.env.local`. Guest Netflix/Canva/Dropbox requests and assessments passed using the existing private catalogue. Local `/api/access` returned HTTP 200 with ordinary unpaid permissions; `/api/audits` returned HTTP 401 without a session.
- Real website sign-in/save/reopen remains pending the user's browser test; developer login does not establish a website session. Stripe configuration remains pending. Nothing was deployed, merged, or enabled for live payments.

Design references: [Cloudflare D1 prepared statements and batches](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Stripe webhook ordering and duplicates](https://docs.stripe.com/webhooks). No third-party API is required for discovery.
