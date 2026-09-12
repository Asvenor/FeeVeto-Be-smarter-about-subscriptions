# FeeVeto polish and QA — 7 September 2026

Historical QA evidence. Branches, dependencies, deployment state and test counts below describe this dated pass and may have been superseded. See [launch readiness](LAUNCH-READINESS.md) for current verification and remaining blockers.

## Scope and baseline

Repository: Asvenor/FeeVeto-Be-smarter-about-subscriptions. Branch `fix/feeveto-polish` was created from fetched `origin/main` (`60c9248`). The working tree was clean. Still-unmerged PR #16's partial-information fix (`473615a`) was carried forward as `ce37eb0`; its original branch remains untouched. This PR therefore includes that fix and should be reviewed with #16 in mind, not treated as an independent second implementation of it.

Pre-polish inherited suite: **108 passing tests**, production build passed. Local baseline browser had no JavaScript exception or page-width overflow, but a failed alternative request displayed a contradictory “general candidates” notice. Other inspected issues included duplicate ad/collaboration questions, optional booleans that could not be cleared, silently ignored custom service corrections, disappearing saved results under filters, stale account status, and privacy copy that omitted structured requests.

The active deployment was verified read-only at `https://feeveto.edward-nyarko.workers.dev/`. The old GitHub Pages URL in canonical/social metadata was stale and has been corrected. No production data, accounts, permissions, configuration, or deployment were changed.

## Implemented

- Green primary controls with stronger contrast, scoped Clerk theme, generated-header-avatar initials, focus rings, comfortable radio/priority targets, readable sign-in-unavailable state, and reserved account-control width. Uploaded or unclassified avatar images are not replaced or tinted.
- Basic input yields eligible general suggestions; improving a match uses the existing populated form. Errors never masquerade as incomplete requirements or real no-match results.
- Optional yes/no answers can return to **Unanswered**. Ads, collaboration, and exclusives share one applicable priority question, with legacy boolean answers migrated into that control on edit.
- Explicit service corrections survive storage. A product type alone now retains country, platform, limits, and requirements. Unrelated old priorities do not affect the new type. Losing automatic service recognition clears the old automatically selected type.
- Saving resets result filters/search so the entry is visible; repeat refresh requests are ignored/disabled while pending. Background responses no longer steal form focus. Existing sequencing protects newer saves/deletions/access changes from stale results.
- Account/session switching immediately clears old entitlements; late access responses after sign-out are ignored. Authentication failures clear cached comparisons. Supplied sessions that fail verification return an explicit authentication error. Signed-out discovery remains public; server metadata controls restricted records.
- Requests have a 15-second network timeout. Unknown `/api/*` paths return JSON 404, never a static HTML page.
- Unknown provider capacity/prices do not become zero. Malformed imported amounts/currencies/cycles reject the entire import instead of silently dropping entries or relabelling money. Storage failures remain visible after success toasts.
- Local notes no longer influence the audit via keyword matching. Privacy and account-access copy now describes actual data flows and distinguishes the free audit from complete comparisons.

## Verification completed

- `npm ci`: passed; lockfile unchanged. Existing upstream deprecation warnings for `crypto-js` and `uuid` remain.
- `npm run check`: **121 tests passed**, catalogue fixture validation and production build passed. Canonical URLs and crawler metadata target the verified Worker site; the build now includes `robots.txt` and `sitemap.xml` without depending on the separate legacy Pages workflow.
- Regression coverage: generic/custom service round trips, applicable priorities, nullable booleans/capacity, notes, malformed backups, JSON routing, authentication errors, failed token lookup, time-bounded requests, generated-versus-photo avatar classification, account switching and late sign-out responses. Existing signed-out/ordinary/beta/admin access policy and API tests remain passing.
- Isolated local Chrome workflow on both Vite development and final production-preview assets, invoking the real recommendation handler through explicit test-only request interception with the repository's fictional catalogue fixture: basic save, general suggestions, improve, edit/cancel, type correction, saved requirements, second subscription, filtered save, deletion/undo, JSON export/import, invalid import, outage/retry, unsupported service, reload, original USD/CHF billing, EUR/GBP/CHF/USD preference changes, unknown pricing, country preservation, and validation focus. No authentication bypass was added to application code.
- Widths **360, 390, 768, 1024, 1440 px**: no page-level horizontal overflow. Enlarged text and a **720×450 CSS viewport equivalent to a 1440×900 window at 200% zoom** also passed reflow checks. Native browser-toolbar zoom was not independently automated; CSS `zoom` was not accepted as a substitute because it does not trigger equivalent viewport breakpoints.
- Keyboard: save/validation focus, clear dialog opened via Enter, Escape dismissal and return focus. Page anchor targets and duplicate IDs checked. No page JavaScript errors in the smoke workflow; only deliberately injected request failures.
- Actual Clerk sign-in modal loaded in isolated Chrome using the existing public **test** key; green primary action measured as `rgb(22, 103, 61)` with white text, modal fit at 390 px, and required Clerk branding remained visible. No credentials were entered or accounts created.
- Ignored private catalogue checked locally: 42/42 records valid; basic queries for Canva, Netflix, Dropbox, Photoshop, ChatGPT and Claude each returned eligible public suggestions. No private record contents were put in browser screenshots, Git, or frontend assets.
- Production output contains only intended HTML, CSS, JS, and icon assets; checked for secret-key prefixes, private metadata, private catalogue binding names and fixture/evidence records. No such contents were found.

Reproduce browser checks with Vite on localhost:4174 and an installed Playwright runtime:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/qa-smoke.mjs
```

Screenshots are local-only under ignored `.private/qa/`: mobile results, landing view, responsive pages, zoom-equivalent view, enlarged text, and the real Clerk sign-in modal. A pre-polish mobile capture is retained locally. Long element captures can include sticky-header/toast capture artifacts. No screenshots containing account details or private offers are published in this PR.

## Clerk settings still outside this repository

The violet image inspected on the deployed header was Clerk's **generated default avatar**, not an uploaded photograph. Changing `colorPrimary` alone cannot recolor that image. Repository code now provides green initials only for the header trigger when Clerk explicitly reports `user.hasImage === false`; its real UserButton still owns all interaction. The shared appearance is passed to Clerk initialization, UserButton and `userProfileProps.appearance` for the embedded account modal.

For generated avatars in the dropdown, account profile and hosted account pages, open the correct Clerk application/instance, then **Customization → Avatars**. Set the generated-avatar background to **Solid**, color **#16673d**, and a white initials/silhouette foreground. Apply the same green accent in the hosted account-page appearance/branding settings where applicable. Do not replace uploaded user photos. These instance settings were **not changed**.

References: [Clerk appearance variables](https://clerk.com/docs/js-frontend/guides/customizing-clerk/appearance-prop/variables), [separate UserProfile appearance](https://clerk.com/docs/expressjs/guides/customizing-clerk/appearance-prop/overview), [generated avatar customization](https://clerk.com/changelog/2023-05-26).

## Release blockers / not verified

1. Deployed `/api/access` still returned **503 “Account access is not configured.”** Deployed recommendations still returned **503 “The alternatives catalogue is not configured.”** These were rechecked on 7 September. Configure **Worker runtime** `CLERK_SECRET_KEY` (secret) and the matching publishable key, not merely build-time settings. Set `VITE_CLERK_PUBLISHABLE_KEY` for the frontend build, and verify authorized origins for the final domain.
2. Verify the deployed `FEEVETO_ALTERNATIVES` KV binding and explicitly import the validated private schema-v2 catalogue at `catalogue:v2`. The endpoint response does not prove whether the precise cause is a missing binding or a missing value. No import was performed during this task.
3. After review/merge and an explicitly authorized deployment, test actual ordinary, beta and admin sessions, sign-out/access-loss, the profile dropdown and account-management modal end-to-end. No account credentials were available for these local signed-in scenarios. Automated policy/lifecycle tests are not a claim of a complete live-account test. Signed-in before/after profile screenshots were therefore not manufactured.
4. `npm audit --omit=dev` reported **20 existing dependency-tree advisories: 7 high, 13 moderate**. They include Clerk's wallet/mobile dependency chain, React Native/Metro and transitive packages. Some suggested fixes require a major Clerk downgrade. No forced audit fix, dependency downgrade, or assurance of exploitability/non-exploitability was made. Investigate reachable packages and compatible supported updates separately before release.
5. Real-device touch, assistive-technology reading and all third-party hosted account pages were not exhaustively tested. No payment, affiliate, catalogue expansion, account-permission change, or framework migration was added.

**This is not a production-readiness declaration.** The polished code requires review and deployment, and the live configuration/security/account-test items above remain open.
