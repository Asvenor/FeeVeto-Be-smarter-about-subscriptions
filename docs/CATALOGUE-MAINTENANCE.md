# Private catalogue maintenance

FeeVeto already has a database: the `FEEVETO_ALTERNATIVES` Workers KV binding,
using the schema-version 2 document at `catalogue:v2`. Keep curated records there,
behind the existing server authorization. No new database service, external API,
frontend catalogue, or commercial-model change is needed for this expansion.

## Research and evidence

Keep research batches and generated bundles in ignored `.private/` storage.
Never force-add them to Git, copy them into `dist`, or include them in frontend
imports. The tracked fixture is fictional and must never be uploaded as real data.

Each batch has `checkedAt`, `productType`, and a `records` array. Records identify
one distinct product and exact plan, official HTTPS destinations, original
descriptions, a source-review note, explicit feature claims and limitations.
The compiler uses `js/serviceCatalog.js` for category and requirement identifiers.

- Verify claims using official product, support, pricing or documentation pages.
- A source-check date means the cited claims were checked; it is not an app test.
- Do not interpret an unmarked table cell or missing feature mention as “No.”
- Unverified requirements become `unknownFeatures`, not supported features.
- Unverified paid prices remain `null`, with no currency or price-verification date.
- Store a verified annual charge as the full annual amount, never a monthly teaser.
- Trials are not free plans. Keep introductory charges and renewals distinct.
- Country availability means enrollment/use availability, not provider headquarters,
  payment currency or VPN server locations. A country-specific plan must be labelled.
- If only a regional offer is verified, scope that record to the verified region.
  Broader availability is not inferred from a worldwide-looking marketing page.
- Optional platform, language, level and switching-effort claims stay unknown until checked.
- Preserve official prices in their source currency; never invent conversion rates.
- Completion certificates, academic credit and professional certification are different.
- Record borrowing, subscription access and permanent purchases distinctly.

Source review remains manual. The tools validate structure and behaviour, not the
truth of a provider's claims or whether a provider will change its plans tomorrow.
The existing 90-day freshness policy remains in effect.

## Build an additive expansion

Start from a private backup of the currently approved catalogue. The compiler
preserves all baseline records and root fields, rejects duplicate product IDs or
names, fills explicit unknowns, and rejects fields that runtime normalization
would truncate. Country and VPN-server lists support up to 249 territories rather
than inheriting the 24-item feature-list limit.

```sh
npm run catalogue:expand -- \
  --base .private/verified-alternatives.json \
  --research .private/catalogue-expansion \
  --families .private/catalogue-product-families.json \
  --output-dir .private/catalogue-review-NEW
```

The default threshold is 150 distinct services. Optional family mappings point
related product IDs directly to one canonical existing ID, so related tools or
hosted companions need not inflate that count. Different pricing tiers never
increase the distinct-product count. Every supported category must have at least
one public paid offer. Adding another plan for an existing product is a separate
editorial update, not this additive-expansion workflow.

The output directory must be new and inside an existing `.private` directory.
The tool never overwrites a reviewed bundle or uploads anything. It writes:

- `catalogue.json`: compatible KV document, with no internal research notes added to offers.
- `coverage.json`: category, unique-service, access, pricing, availability and freshness counts.
- `evidence.json`: private source-review notes for additions.
- `manifest.json`: input/output hashes, preserved-record count and staging boundary.

Protect private research and backups separately: Git intentionally cannot recover them.

## Verify with real staged records

```sh
node scripts/catalogue-validate.mjs .private/catalogue-review-NEW/catalogue.json
npm run catalogue:audit -- \
  .private/catalogue-review-NEW/catalogue.json \
  .private/catalogue-review-NEW/test-report.json
npm run check
```

The audit runs the actual staged records through the production handler, loader,
matcher and card renderer. It covers all recognized services in USD/EUR/GBP/CHF
for signed-out, ordinary, beta, admin and paid identities; category correctness;
forged body flags; unknown prices; incompatible requirements and countries;
invalid sessions; storage failure and retry; and rendered source/price labels.

These are local tests: identity verification outcomes and KV transport are
simulated, and card rendering uses a DOM emulator. They do not prove real Clerk
login, Cloudflare runtime performance, browser layout or live KV publication.
Run browser and live-flow checks separately after an approved import/deployment.

## Publish only after explicit approval

1. Get approval for the exact catalogue bundle, target namespace/key and any Worker deployment.
2. Read the live document and save a new private timestamped backup. Compare it with
   the expected baseline hash/content. Stop if somebody changed the live catalogue;
   reconcile the new work instead of overwriting it.
3. Deploy the reviewed country-list fix before uploading records with longer lists.
   Keep the current Worker version available for rollback. Do not merge automatically.
4. Use the existing explicit `catalogue:publish` tool with the approved file,
   namespace ID and `--remote`. KV has no compare-and-swap guarantee; coordinate
   writers and do not treat a preflight hash check as an atomic write lease.
5. Read back the uploaded key and compare its parsed content. Allow the existing
   KV cache interval before checking live responses.
6. Verify basic Netflix, Canva and Dropbox flows, detailed filtering, signed-out
   paid suggestions, authenticated restricted access and saved-answer retry.
7. Retain both the previous catalogue and Worker version. A rollback must restore
   a compatible pair; rolling back only code can truncate a newer country list.

Signed-out and ordinary visitors still receive eligible paid/one-time offers;
free-plan records remain restricted to server-verified premium/admin/beta access.
No dashboard, payments, automatic scraping, affiliate links or new service-name
recognition rules are added by the catalogue tooling.
