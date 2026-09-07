# Intent-to-audit release

This branch evolves the existing FeeVeto app: instant supported-service discovery, optional two-stage questions, explainable server assessments, and account-owned append-only history. The old local subscription list and export format remain unchanged.

## Required configuration

- Build: matching Clerk publishable key as `VITE_CLERK_PUBLISHABLE_KEY` (public).
- Worker runtime: `CLERK_SECRET_KEY` as a secret, matching `CLERK_PUBLISHABLE_KEY`, and applicable `CLERK_AUTHORIZED_PARTIES`. Never put a secret key in frontend/build variables or commits.
- Existing private KV: `FEEVETO_ALTERNATIVES`, key `catalogue:v2`, schema 2. Creating a namespace does not populate it. Validate the existing private file; no catalogue import is required for this change if production data is healthy.
- Existing D1: `FEEVETO_BILLING` / `feeveto-billing`. Apply additive `migrations/0002_saved_audits.sql` before releasing the account-save routes. It adds a separate history table; it does not modify billing tables or upload browser subscriptions.
- No optional data API, AI service, new paid integration, or new catalogue records are needed.

## Local preview

Use Node 22.22.2+, 24.15.0+, or 26+ as specified in package.json. Run `npm ci` and `npm run check`.

Vite alone (`npm run dev`) previews the interface, not the Worker APIs. For a functional local preview:

```sh
npm run build
npx wrangler d1 migrations apply feeveto-billing --local
npx wrangler kv key put catalogue:v2 --binding FEEVETO_ALTERNATIVES --path .private/verified-alternatives.json --local
npx wrangler dev --ip 127.0.0.1 --port 8787
```

Use only the existing validated private catalogue for realistic local verification. `.private/`, `.dev.vars*`, and `.wrangler/` are ignored. Development Clerk credentials belong in ignored `.dev.vars`; a matching public key must be present at build time. Without credentials, guest discovery/assessment works but account-save testing requires controlled test doubles and is not a real Clerk integration test.

## Explicit release actions (not run automatically)

1. Review the branch and checkpoint log. Confirm browser/mobile/real sign-in checks against a staging Worker with matching development Clerk credentials.
2. Back up production D1 according to the owner's retention policy. Apply `npx wrangler d1 migrations apply feeveto-billing --remote` only after release approval.
3. Keep existing Worker/KV bindings and securely configure missing runtime credentials. Build with the matching public key.
4. Deploy only after explicit approval. GitHub Pages is a static preview and cannot serve account/alternative APIs; the full experience requires Cloudflare Worker deployment.
5. Verify guest, ordinary, beta, admin, save/reopen/reevaluate, account ownership, and errors on the released host. Do not call local tests live verification.

Recovery: previous code can run with the additive table left in place. Keep existing commits and database history; do not delete the history table as an automatic rollback.

## Storage and access

`feeveto_state_v2` remains local subscriptions. `feeveto_journey_draft_v1` stores only the current request/answers, not protected comparisons. A tab-scoped pending-save request preserves explicit save intent through sign-in/retry. Each authenticated save is normalized and recomputed on the server, never taken from a browser-provided result or role.

`saved_audit_versions` uses verified Clerk ownership, owner-scoped request idempotency, and new rows for reevaluation. Reads and writes constrain the owner on the server. Complete historical snapshots are withheld when the account no longer has Premium; its own answers and dates remain available. Saves refresh the catalogue at save time, so the saved date/result may differ from the preceding preview. Local exports do not include account history. Self-service account-history deletion/export is not implemented; review this retention limitation before public launch.

## Data boundary and limitations

Future providers connect at `functions/_shared/catalogue-provider.js`, supplying checked records to the same schema, access, and ranking pipeline. Curated KV is the current source; external APIs are not called.

Recognition uses supported names and explicit phrases, not general AI reasoning. Limited categories/markets may return fewer than three suggestions. No ratings appear without a source, review count, scale, and date. Records older than 90 days require rechecking. Unknown capability/prices remain unknown; different currencies are never converted. New natural-language discovery does not replace the original detailed form for highly specific legacy requirements.

Stripe branding and sandbox webhook/secret configuration remain separate pending work. Browser policy verification currently blocks that approved dashboard operation. No live payment, production migration, merge, or deployment has been performed for this journey.
