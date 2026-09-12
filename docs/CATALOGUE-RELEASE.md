# Catalogue expansion — approved live publication

Historical catalogue publication record, not today's Worker release identity. Keep its private backups and provenance. See [launch readiness](LAUNCH-READINESS.md) for current verification and the stable code rollback point.

Published September 7, 2026, after the owner approved backing up/replacing the
live catalogue and deploying the country-list fix. No GitHub merge, payment
activation, account-data migration or new database was performed.

## Release identity

- Site: <https://feeveto.edward-nyarko.workers.dev/>
- Worker: `feeveto`
- Deployed source: `42b2133c9d7a4eb958f2f774ab0c982d2bbf592d`
- Source branch: `feature/catalogue-expansion` (local; not pushed or merged)
- Active Worker version: `d38b10d6-1bae-4faa-9fe0-a9ce2031537c`
- Previous Worker version: `ebfe0537-bba6-4408-a4f9-823b2293f718`
- Existing storage: `FEEVETO_ALTERNATIVES`, key `catalogue:v2`, schema 2
- Published catalogue SHA-256: `fe5207813883c3a3992a2268512031c7cb5d8d3a616421f839ad86b8a86e2ab9`

The live catalogue and Worker matched the expected baseline before the change.
The approved upload was read back with exactly the same hash and parsed content.
The current runtime bindings and compatibility settings match the previous
Worker version, including both Clerk secrets, KV and the saved-audit D1 binding.
The public HTML, privacy page and main script remain unchanged.

## Coverage and boundaries

The catalogue grew from 42 to 172 offers, with all previous records retained.
There are 158 product identifiers, conservatively grouped into 156 distinct
services across 20 existing categories. Pricing tiers do not inflate this count.
The existing 28 recognized subscription inputs and matching rules are unchanged.

The only runtime code change increases country-availability and VPN-server
country list capacity from 24 to 249. This prevents valid markets near the end
of long lists from being discarded; it does not infer availability or convert
currencies. Explicit country still overrides the currency market hint.

There are 110 paid/one-time offers and 62 free-plan offers. Existing access rules
remain: paid suggestions are public; free plans require server-verified Premium,
admin or beta entitlement. No permission is taken from request-body flags.

Important evidence limits:

- 76 paid offers have no verified numeric price; they show “Check current pricing.”
- 128 offers have unconfirmed country availability and remain provisional candidates
  with verification guidance, not confirmed local matches.
- 43 offers have no confirmed platform list.
- Source review is not hands-on product testing. The 90-day recheck policy remains.
- Private catalogue/research records are absent from Git and frontend assets.

## Verification

- All 194 automated tests and the production build passed.
- Worker packaging dry run passed; frontend secret/private-record scans passed.
- The actual reviewed catalogue passed schema validation, 560 local service/currency/
  identity cases, 172 per-offer checks, and 172 DOM-rendered card checks. These local
  tests simulate Clerk identities and KV transport.
- Live responses matched the reviewed catalogue for all 112 recognized-service/
  currency combinations and five detailed requirement/country cases.
- Basic Netflix, Canva and Dropbox discovery returned three initial suggestions
  each. Requests for up to 12 returned eight, five and eight respectively in USD.
- Live assessments passed for all three; a detailed Canva assessment produced a
  switch result. Missing subscription prices remained unknown.
- Live `/api/access` returned HTTP 200 for an ordinary unpaid guest. Guest account
  history and invalid-session recommendations returned HTTP 401. Forged admin/beta/
  premium request flags could not retrieve restricted free-plan records.
- Mozilla VPN remained eligible in the US, verifying the longer country-list fix.
- Unknown alternative prices remained null and original currencies were retained.
- Browser automation was denied because its admin security policy could not be
  verified. Signed-in save/reopen, live beta/admin UI, visual/mobile/keyboard checks,
  and a real browser failure/retry were not repeated. Failure/retry and access-role
  regression checks passed locally; this is not equivalent to live browser testing.

## Retained private backup and recovery

The owner-only, ignored directory `.private/catalogue-live-release-20260907/`
contains the original live `catalogue-before.json`, Worker metadata, manifests,
deployment/import logs and `live-verification-final.json`. The earlier reviewed
research archive `.private/feeveto-catalogue-review-2026-09-07.tar.gz` also remains.
The original `.private/verified-alternatives.json` was not overwritten.

Retain both the old catalogue and Worker version. Rollback requires an explicitly
approved, compatible code/data pair: restore the old catalogue before reverting
the country-list fix, allowing KV propagation before confirming results. Do not
restore the old saved-audit database or delete new user data. Recheck current live
state before any rollback to avoid overwriting subsequent catalogue edits.

Cloudflare KV is eventually consistent and has no compare-and-swap write lease;
the preflight comparisons are safety checks, not atomic concurrency protection.
References: [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
and [Wrangler deployment guidance](https://developers.cloudflare.com/workers/wrangler/commands/).
