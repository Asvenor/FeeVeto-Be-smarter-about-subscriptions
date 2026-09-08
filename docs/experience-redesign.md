# FeeVeto experience redesign

Status: implemented for local review. This document does not record a production deployment, merge, payment activation or completed launch approval. Payments remain on hold; this redesign does not change billing configuration.

## A clearer workspace

The green visual identity is retained with a quieter layout and three primary destinations:

- **Discover**: one starting request, useful provisional alternatives, and optional search refinement. The illustrative preview remains explicitly separate from saved results.
- **My subscriptions**: device-local bills, original-currency totals, filtering, backups and the unified subscription editor. “Add subscription” opens the editor; “Save and review” remains its primary submit action.
- **Saved audits**: account-owned assessments and dated history. Copy distinguishes these from entries saved only on the current device. Opening an assessment shows its review, with a return link to the originating workspace.

Navigation reveals existing page sections instead of rebuilding controllers or form state. Hash links and browser Back/Forward retain their role. Pricing and help remain available outside the primary navigation; nothing automatically starts checkout.

## Less information at once

The subscription form keeps essential billing, usage and importance fields together. Optional information is grouped in native disclosures: **Renewal & account details**, **What you need**, and **Switching preferences**. These remain parts of the same adaptive form, not extra submission steps. Saved answers are retained; relevant disclosures open for editing or validation so errors remain reachable.

Subscription cards foreground the recommendation, primary reason, confidence, original bill, annual cost and renewal date. Secondary metrics and reasoning are available under **Why this recommendation**. Alternative cards foreground their actual match qualification and source-currency price. **Details & sources** contains extra features, reviews and evidence links. Known exclusions, plan limits, uncertain pricing/compatibility, upfront commitments, introductory terms and renewal conditions stay visible without opening it.

## Boundaries preserved

- Storage formats, legacy migration, save/retry ownership and append-only assessment history are unchanged. Guest saves stay local; signing in does not bulk-upload existing entries. Private notes remain separate from structured matching inputs.
- Matching, recommendation rules and the private catalogue are unchanged. Optional answers refine results; unknown facts never become confirmed matches or zero prices. Existing currency/market precedence and original billing currencies remain intact.
- Clerk sessions and admin/beta/paid entitlements remain server-verified. Presentation controls neither grant access nor embed restricted catalogue records. The free audit stays accessible without login.
- Stripe prices, fulfillment, renewals, refunds and runtime credentials are unchanged. Local visual review is not proof of a live API, payment configuration or deployment. QA results belong in the accompanying release report.

## Local validation — 8 September 2026

The work is isolated on `feature/experience-redesign`, continuing from the preserved, unmerged billing work at `98477fe`. It has not been pushed, merged or deployed.

- `npm run check`: **248 tests passed**, including the production build and catalogue fixture validation. Added connected application tests cover save/edit without duplicates, legacy CHF answers, cancellation, optional-field validation, alternative failure/retry, navigation, a single save action for refreshed history, and stale asynchronous responses. Existing backend access and billing tests still pass; those tests do not make real charges.
- The browser preview uses the real local Worker and existing private catalogue. The validated 172-offer catalogue was imported into the isolated local KV store after confirming that preview store was empty. No production KV data or frontend catalogue assets were changed.
- Real local browser discovery returned suggestions for simple Netflix, Canva and Dropbox requests. Existing account history opened with a return path. An unsaved edit survived workspace and display-currency changes; cancelling retained the original CHF amount and saved record. No test audit was added to the user's account.
- Responsive width checks at 320, 390 and 1280 pixels found no horizontal overflow in the inspected views. Phone and normal-preview layouts were visually reviewed. Keyboard focus reaches search and native optional disclosures; Enter toggles them. The editor focuses its service field. Page structure checks found no duplicate IDs or broken label/description references.
- Changed-file secret-pattern checks and tracked-private-file checks passed. Authentication, the private catalogue boundary, currency arithmetic and Stripe configuration are not replaced by frontend flags.

These are local checks, not a production launch, full assistive-technology audit, broad browser/device certification or live payment verification. The separate privacy page retains its existing readable design. The refreshed main page uses system fonts and no new external image/font service; no claim of a measured Core Web Vitals improvement is made. Following the Cloudflare skill, catalogue setup and verification remained server-side and explicitly local.

## Proposed owner controls — NOT IMPLEMENTED

A future private owner area could manage **Accept new purchases**, separate plan availability and discount codes. Every settings request must verify the Clerk session and server-fetched private `role: "admin"`; beta or paid Premium access must never authorize administration. An owner-only policy can additionally require a server-configured owner ID. Settings should be validated, stored server-side and accompanied by an action log, with the deployment-level safety gate retained.

The existing runtime `BILLING_ENABLED` gate already requires the exact string `"true"` to start/resume checkout. Missing/false disables new checkout without revoking existing access, disabling webhooks or closing the billing portal. It **does not cancel subscriptions, stop renewals or expire previously issued Stripe checkout links**. Changing this setting in the Cloudflare dashboard is a configuration deployment, not an implemented FeeVeto owner toggle. [Cloudflare runtime variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)

Stripe coupons/promotion codes could discount monthly or lifetime purchases while preserving the approved base price. Plan-specific eligibility needs explicit enforcement: both current prices share one Stripe product, so a product restriction alone cannot distinguish the plans. Duration, expiration, redemption limits and customer eligibility need clear controls; changing existing subscribers is a separate action. [Stripe discounts](https://docs.stripe.com/payments/checkout/discounts), [subscription coupon behavior](https://docs.stripe.com/billing/subscriptions/coupons)

Do not simply enable unrestricted or 100% codes. Current lifetime fulfillment requires a positive paid total and PaymentIntent; monthly access requires a paid invoice payment. Fully discounted orders need a separately designed and tested fulfillment path because Stripe can complete a no-cost order without a PaymentIntent. Complimentary admin/beta access remains separate. [Stripe no-cost orders](https://docs.stripe.com/payments/checkout/no-cost-orders)
