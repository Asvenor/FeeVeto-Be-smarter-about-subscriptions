# FeeVeto Monthly and Lifetime billing

Implementation is test-first. No production deployment, live Stripe prices, real charges, or production migrations are authorized by this document. `wrangler.billing-test.jsonc` uses placeholder resource IDs for local simulation only; do not deploy that configuration.

## Approved offers

| Plan | Price | Stripe price | Checkout mode |
| --- | --- | --- | --- |
| Premium Monthly | $2.99 USD/month | 299 minor units; recurring month, interval_count 1, licensed | subscription |
| Premium Lifetime | $49.99 USD once | 4999 minor units; one-time | payment |

Both unlock the same existing Premium features for one Clerk account. Free audits and ordinary public alternatives remain available. Admin/beta complimentary access stays exclusively in Clerk private metadata. A payment cannot grant admin rights.

Only USD purchase prices are approved. The global audit currency preference never changes payment prices, saved subscription billing amounts, country answers or verified provider prices. No automatic tax, trials, coupons, quantity selection, external payment methods, or guessed exchange rates are enabled. Confirm tax obligations and price-inclusive/exclusive policy before live activation.

## Stripe setup (test environment first)

1. Confirm the seller account and sandbox identity in Stripe. CLI authorization alone neither proves FeeVeto seller branding nor enables live payments. Use test credentials only. Never print or commit API keys, the CLI credential file, or webhook signing secrets.
2. Create a FeeVeto Premium test product with the two prices above. Do not edit or archive pre-existing products, prices or subscriptions. Record the new non-secret price IDs.
3. Create a dedicated test customer-portal configuration. Enable payment-method updates, invoice history, and subscription cancellation **at period end**. Disable subscription plan/quantity changes, subscription pause and promotions; buying lifetime happens through FeeVeto Checkout. Keep cancellation proration disabled. Store this exact configuration's `bpc_...` ID; do not change another application's default portal.
4. For hosted testing, use a separate Worker, separate D1 database, and test Clerk instance with the correct origins. A hosted test deployment still requires approval. Locally, use the supplied isolated configuration and storage below.
5. Configure runtime variables/secrets from the table below. `BILLING_ENABLED` stays `false` until setup is verified. Vite receives only the Clerk publishable key, never Stripe/Clerk secret keys.
6. Register `/api/billing/webhook` for the test Worker, or forward test events locally using the official Stripe CLI. Use the signing secret for that specific endpoint/listener. Keep the endpoint API version compatible with the installed Stripe SDK; the current implementation supports invoice parent references and item-level subscription periods.

Required webhook events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`

Stripe's [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [webhook delivery guidance](https://docs.stripe.com/webhooks), and [portal configuration](https://docs.stripe.com/customer-management/configure-portal) describe the lifecycle and self-service options used here.

## Runtime configuration

| Setting | Purpose |
| --- | --- |
| `BILLING_ENABLED` | Literal `true` enables creating Checkout sessions. Missing/false disables new checkout, not existing entitlements or webhook processing. |
| `BILLING_MODE` | `test` by default; `live` is a separately approved release. Stripe objects must match. |
| `STRIPE_MONTHLY_PRICE_ID` | Approved $2.99 USD monthly price for this environment. |
| `STRIPE_LIFETIME_PRICE_ID` | Approved $49.99 USD one-time price for this environment. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Dedicated period-end cancellation portal configuration. |
| `STRIPE_SECRET_KEY` | Secret matching the environment; server only. |
| `STRIPE_WEBHOOK_SECRET` | Endpoint/listener signing secret; server only. |
| `STRIPE_LEGACY_LIFETIME_PRICE_IDS` | Comma-separated verified old lifetime prices, in this same Stripe mode/account only. |
| `STRIPE_LEGACY_MONTHLY_PRICE_IDS` | Equivalent allowlist for future monthly price migrations. |
| `STRIPE_PRICE_ID` | Old lifetime price alias retained for existing grants; not used for new Checkout. |
| `FEEVETO_BILLING` | D1 binding containing all four migrations. |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | Matching runtime Clerk credentials, as before. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Matching browser build key; not a secret. |

`.dev.vars.example` contains placeholders only. Use ignored `.dev.vars` or a private environment file locally, and encrypted Worker secrets remotely. `.private/stripe-billing-cli.toml` must stay ignored and accessible only to the current OS user. The current CLI uses its own developer authorization; that is not a server API key for the Worker. Both same-mode `sk_` and `rk_` server keys are supported, while `pk_` browser keys are rejected. Prefer a restricted key granting only Checkout Sessions, Customers, Subscriptions and Customer Portal write access, plus Prices, Invoices and Invoice Payments read access. Verify permission coverage with sandbox checks before release. See [Stripe key guidance](https://docs.stripe.com/keys).

The optional administrative script `node scripts/billing-sandbox-setup.mjs <sandbox-account-id>` uses the already authorized official Stripe CLI. It requires an explicit expected account, checks test mode before each request, creates/reuses only resources marked for FeeVeto's monthly/lifetime setup, and validates the resulting prices and portal. Its ignored `.private/billing-sandbox/setup.json` report contains no secrets. It does not retrieve server keys, change branding, enable checkout or deploy anything.

## Local verification

Commands below affect local simulated storage only:

```sh
npm ci
npm run check
npx wrangler d1 migrations apply feeveto-billing-test --local --config wrangler.billing-test.jsonc --persist-to .private/billing-local-state
npx wrangler deploy --dry-run --config wrangler.billing-test.jsonc --outdir .private/billing-worker-build
npx wrangler dev --local --config wrangler.billing-test.jsonc --persist-to .private/billing-local-state --port 8790
```

Provide matching test secrets privately before expecting sign-in or Checkout. An empty local alternatives KV must be populated separately with approved private catalogue data when exercising discovery; it is not evidence of a matching failure. Never use `--remote` or the production catalogue/database to test billing.

For the configured FeeVeto sandbox, `node scripts/billing-local.mjs` starts the official Stripe test listener and an isolated Worker on port 8790. It verifies the sandbox account and exact prices first, reads the ignored `runtime.env` and development `.env.local`, and writes the listener secret only to a private, mode-0600 `preview.env`. The source `runtime.env` is left unchanged with checkout disabled. Apply the local migrations and build above first; stop the harness with Ctrl+C to stop its listener and Worker together. Never print either environment file or commit the local state.

`node scripts/billing-sandbox-verify.mjs --run-sandbox` is an **opt-in external integration test**, not part of `npm test`. It needs the running harness, authenticated Clerk CLI for FeeVeto's development instance, and an ignored `test-user.json` identifying the dedicated ordinary development user (`externalId: feeveto-billing-sandbox-v1`, plus `userId`). Preview Clerk mutations before running. The test consumes short-lived, one-use sign-in tickets through Clerk's documented public development API; no browser cookies, auth mocks, custom claims or weakened origin checks are used. It creates actual sandbox Checkout sessions and API-paid test subscriptions, checks real signed webhook delivery and local access, then cancels only its own subscriptions, expires its unused checkouts and ends its test sign-in session. Reports stay under `.private/billing-sandbox/`. Test customer/payment history remains for inspection; no existing account or payment is deleted.

`node scripts/billing-sandbox-verify.mjs --prepare-monthly-checkout` instead leaves one unpaid, hour-long sandbox Checkout open for manual testing and records its URL privately. It does not complete or pay it. Completing that link grants access to the dedicated **test account**, not the owner's complimentary account. Keep the local harness running for signed webhook forwarding. The return page alone is not proof of access: verify the dedicated account's server status afterwards. Do not mistake this mode's handoff report for a completed integration test.

After manual payment, run `node scripts/billing-sandbox-verify.mjs --verify-hosted-checkout <cs_test_id>`. This reads the actual owned Checkout, exact approved price and paid status from Stripe, then verifies paid Premium through the real ordinary Clerk account. It does not pay, refund or cancel existing purchases. For an upgrade test, `--prepare-lifetime-checkout` requires existing monthly access and leaves an unpaid lifetime Checkout for manual completion. Verifying that completed lifetime session also checks that Stripe has no remaining FeeVeto monthly renewal for the same customer. Use the complete private Checkout URL, including its fragment; truncating it can break the hosted page.

If the local listener stops during a pause, restart the harness before testing again. For an already-paid sandbox Checkout, verify the exact matching `checkout.session.completed` event and use the official Stripe CLI's `events resend <event-id>` with the intended sandbox configuration (preview with `--dry-run`). Check the forwarded webhook returns HTTP 200 and rerun hosted verification. Do not pay again, forge a webhook, or edit entitlements manually. A local recovery does not prove production webhook delivery.

In a sandbox, complete a real hosted test Checkout for each plan and verify the signed event reaches this Worker and updates D1. A generated unrelated `stripe trigger` fixture is not sufficient to prove the account/product-linked flow. Use Stripe test clocks for renewal and failed-payment lifecycle checks where supported. Test the customer portal's cancellation and payment-method update. Test an ordinary account, not an admin/beta account, because complimentary accounts intentionally cannot buy.

## Entitlements and lifecycle

- Clerk verifies every account request; the server retrieves the mapped Stripe customer. Request bodies cannot select a customer, user ID, price, role or entitlement.
- One persistent checkout reservation per account, Stripe idempotency keys, and current-session recovery guard retries and parallel clicks. A timed-out request must be retried, not replaced with an untracked purchase.
- Checkout completion is re-fetched from Stripe. Product, exact price, payment status, account/customer identity and live/test mode must agree. Redirect parameters only start confirmation polling.
- Monthly access comes from a verified paid invoice/payment ledger and current subscription state, not `active` alone. `past_due` retains only a previously paid, unexpired period. There is no unpaid grace period or free trial. Cancellation at period end preserves that paid period; terminal cancellation or expiry removes monthly access without removing lifetime/complimentary access.
- Events can arrive twice, out of order or concurrently. The Worker retrieves current subscription state and uses D1 revisions to reject stale overwrites. The invoice ledger keeps the longest legitimate paid period instead of trusting event order.
- Lifetime upgrades grant a separate purchase, then cancel FeeVeto monthly subscriptions for that same customer without proration or an extra invoice. Cancellation errors return a retryable failure. The interface warns when cancellation is still pending; lifetime access itself is not lost.
- A full refund records a payment-specific tombstone. Refunded invoices/purchases cannot be revived by a delayed completion event. Partial refunds do not revoke access. A later legitimate payment can grant access again. Refunding lifetime does not automatically restart a cancelled monthly subscription.
- No catalogue records, audit answers, saved-audit history, or Clerk metadata are migrated by billing migration 0004.

## Migration and recovery

Migration 0004 is additive: customer mappings, lifetime purchases, subscriptions, paid invoices and invoice payment links. Existing `billing_entitlements` and refund tombstones remain intact. Before any production migration, export/back up the intended database, inventory existing Stripe prices and in-flight sessions, and verify the legacy allowlist. Legacy rows have no mode column, so never copy test grants or test price IDs into live storage/allowlists.

Previously completed old-price lifetime grants are preserved through the explicit allowlist. **Do not change from old to new price configuration while old-format Checkout sessions are still open or unprocessed:** finish/reconcile those with the prior handler first. Old-format sessions did not contain the new plan/mode metadata and are not accepted by the new fulfillment path. Existing old customers may acquire a new dedicated customer mapping on a future purchase; do not assume historical purchases will all appear in the new portal without a reviewed customer migration.

On a failed webhook, inspect the event in Stripe and retry it after repairing configuration or storage. Do not set a browser premium flag or manually edit Clerk complimentary metadata to hide a billing failure. For a failed lifetime-upgrade cancellation, confirm the paid lifetime grant and the exact owned monthly subscription, then retry the original event; if necessary cancel that monthly subscription in Stripe without proration. Alert on unresolved webhook failures and reconcile before Stripe's retry window ends. Permanent background reconciliation/operations alerting is not implemented in this version.

An abandoned open Checkout expires after one hour. The same plan resumes the same session; a different plan is blocked until expiry, preventing simultaneous charges. There is not yet an in-app “discard checkout” action. Changing price/origin configuration mid-checkout can cause safe retry failures; reconcile open sessions before changing it.

## Before real payments

Production remains gated on approval of seller branding and statement descriptor, support contact, refund/consumer-cancellation policy, precise lifetime-access promise, tax handling and receipts. Dispute/chargeback automation is not implemented; handle those through a reviewed policy before launch. Verify real sandbox payments, renewals, SCA/failed payment, full/partial refunds, upgrade cancellation retries, mobile layout and keyboard navigation first. Unit/DOM tests with simulated Stripe responses are not proof of a successful hosted payment. Do not enable `BILLING_MODE=live`, create live products, apply production migrations or deploy without a separate approval.

## Verification checkpoint — 2026-09-08

- Clean dependency installation completed; `npm run check` passed 216 tests and the production Vite build. Billing unit/DOM tests use simulated Stripe responses, real SQLite storage and a real Stripe signature-verification test.
- All four migrations applied successfully to isolated local Cloudflare storage. The local Worker bundle dry run and generated runtime types passed; no remote database or deployment was changed.
- Official Stripe CLI authorization verified a test-only sandbox. The two actual sandbox prices and dedicated portal were created and validated through Stripe's API; IDs are recorded in the ignored setup report. No Checkout payment, real charge or existing customer was created by setup.
- The user-saved test server key was securely verified against the intended sandbox and approved prices. The actual Stripe listener signing secret is available only in the private isolated preview environment. Original configuration and production checkout remain disabled; only the local port-8790 preview is enabled in test mode.
- **12 real sandbox API checks passed** (report run `feeveto-billing-dcbc56be-21d0-484f-b713-47c68ecc15f1`): signed-out restrictions; real Clerk ordinary-user authentication; both exact-price Checkout sessions; duplicate Checkout reuse; no unpaid grant; real paid-invoice webhook grant; billing portal session; period-end cancellation; full-refund revocation; paid repurchase after refund; terminal cancellation; and declined-payment rejection. Some checks contain multiple assertions. All subscriptions created by that test were cancelled; its sessions were expired/ended. No real money was charged.
- The earlier API payments **did not complete hosted Checkout**. Subsequently, the user completed the actual **$2.99 monthly hosted sandbox Checkout**. Stripe confirmed the exact price, paid Checkout and active subscription. The local listener had stopped during the pause, so the first entitlement check failed. After restarting only the local preview/listener, the official Stripe CLI resent that exact completion event; the Worker returned HTTP 200. Hosted verification then passed all three checks (report run `feeveto-billing-7f4a9aa7-ffbb-4c55-9d66-23569f3a3ee9`), including paid Premium for the ordinary test user with no admin/beta grant. No duplicate payment or manual entitlement edit was needed.
- Browser control is working again. The monthly hosted screen was exercised and manually completed, but the return browser remained signed into the owner's complimentary account. The dedicated purchaser's entitlement was verified separately with its real Clerk session; the ordinary purchaser's return-page Premium state is not yet browser-verified.
- The user also completed the actual **$49.99 lifetime hosted sandbox Checkout** for that same monthly test account. Its completion and subscription-change events reached the restored listener and returned HTTP 200 without manual resend. Hosted verification passed all four checks (report run `feeveto-billing-a21a22df-8fa8-4961-85c9-fe54b8cc2260`): exact paid lifetime purchase, server-verified paid Premium without complimentary privileges, and no remaining FeeVeto monthly renewal in Stripe. Lifetime access was active with no cancellation retry pending. These were sandbox payments only; no real money was charged.
- SCA, calendar-month renewal, and portal UI/mobile/keyboard interaction remain unverified. An earlier billing-anchor reset with no proration produced no new invoice, so it was not reported as renewal success; the passing API test checks a new paid subscription instead. Automated renewal/upgrade scenarios also pass with simulated Stripe responses.
- Secret/private paths were verified ignored by Git. No secret values were printed or added to source; the follow-up scripts contain no credentials. No push, merge, production configuration change, migration or deployment was performed.
