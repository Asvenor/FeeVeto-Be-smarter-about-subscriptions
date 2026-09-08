# FeeVeto owner controls

## Using the panel

Sign in to FeeVeto, then choose **Owner** next to the account menu. The server must verify the account's Clerk private metadata contains `role: "admin"`. Ordinary users, beta testers and paid users cannot access owner endpoints. No browser-stored flag or user-editable metadata grants administration.

To assign access, select FeeVeto in Clerk Dashboard → **Users** → your account → **Metadata** → **Private metadata**. Merge `"role": "admin"` into existing metadata without erasing other fields. Reload FeeVeto. Friends who only need complimentary Premium should have `"role": "user", "betaAccess": true`; do not give them admin access. Owner settings cannot assign roles or reveal secrets.

### Purchase controls

- **Accept new purchases** pauses both plans when off. New installations default off.
- **Offer Monthly** and **Offer Lifetime** independently control new checkouts.
- Choose **Save purchase settings** to apply changes. Concurrent edits are rejected; refresh and review your choices before retrying.
- The deployment launch gate (`BILLING_ENABLED`) and valid Stripe setup are required too. The panel cannot override that gate, install credentials or change test/live mode.

Pausing does **not** cancel existing subscriptions, stop renewals, remove paid access, revoke already-applied discounts or expire Stripe checkout links already issued. Billing management and signed webhook processing remain separate. Base prices stay $2.99 USD/month and $49.99 USD lifetime; discount codes do not change the original price records.

### Discount codes

1. Enter an 8–32-character letter/number code and a whole-number percentage from 1–80.
2. Select Monthly, Lifetime, or both. Monthly discounts apply to the first payment or every payment of that subscription. Lifetime discounts apply once.
3. Optionally set a future redemption deadline (in your local time) and maximum uses.
4. **Save discount draft** persists it in D1 without contacting Stripe. Drafts are not redeemable.
5. When the correct Stripe setup is available, **Activate code** explicitly publishes it. Retry the same code after an uncertain response; do not create a duplicate.
6. **Discard draft**, **Stop activation**, **Deactivate code**, and **Retry deactivation** handle each saved state. Disabling a code blocks new FeeVeto uses before contacting Stripe. Existing monthly discounts continue as originally agreed.

Codes are permanently unique within test or live mode, including discarded codes. A different code is required for changed terms. Test codes never become live codes automatically. Usage is shown as unknown when Stripe counts have not been retrieved; it is not reported as zero. The panel currently lists the newest 200 codes. There is no customer directory, role editor, revenue dashboard or subscription-cancellation tool.

## Security and configuration

`GET/PUT /api/admin/settings` and `GET/POST/PATCH /api/admin/discounts` require server-verified private admin role. Mutations require same-origin bounded JSON. D1 primary reads, revision checks and atomic audit triggers protect settings and preserve an action history. Missing configuration fails closed. Discount eligibility is checked against stored mode/plan/expiry and verified Stripe coupon/product/promotion data; checkout never accepts arbitrary prices or entitlement flags.

Before publishing dependent code, back up the intended D1 database and apply additive migrations `0004_monthly_lifetime_billing.sql` and `0005_owner_controls.sql`. No existing entitlement, saved assessment or catalogue is replaced. Keep runtime secrets separate from build variables and browser assets.

For the payment-held production release, use `BILLING_MODE=live` and `BILLING_ENABLED=false`. Live mode selects where future production drafts are stored; it does not enable charges. Preserve existing Clerk secrets, KV and D1 bindings. Do not deploy the isolated `wrangler.billing-test.jsonc` or copy sandbox credentials into production.

Future payment activation still needs separately approved live Stripe credentials, approved live prices, portal configuration, signed webhook setup and end-to-end live verification. Afterwards the owner can pause/reopen new purchases and manage codes without code edits. Fully free codes are intentionally unsupported; complimentary access continues through Clerk admin/beta metadata.

## Release evidence — 8 September 2026

Implementation and verification are in progress on `feature/experience-redesign`; this entry will be finalized after live checks. The previous Worker version is `d38b10d6-1bae-4faa-9fe0-a9ce2031537c`. No automatic merge or payment launch is part of this release.

- Pre-release `npm run check`: **306 tests passed**, including real-SQLite owner/checkout regressions, catalogue fixture validation and production build. Stripe activation/checkout in these tests uses mocks, not real Stripe writes.
- Local authenticated browser: owner controls load, paused settings save, a draft persists after refresh, and discarding it does not activate Stripe. The test draft remains inactive in isolated local storage; no production code was created. Refresh keeps the owner route while Clerk initializes.
- Owner layout has no horizontal overflow at 320 and 390 CSS pixels. All panel inputs have labels; keyboard Tab advances from code to percentage. Temporary viewport overrides were reset. This is not full assistive-technology or cross-browser certification.
- Before production changes, the D1 SQL export and Time Travel bookmark were saved in a private ignored recovery folder. Existing Clerk instance/secrets and private catalogue are retained. Changed source and built assets passed secret-pattern checks; no private environment files are tracked.
