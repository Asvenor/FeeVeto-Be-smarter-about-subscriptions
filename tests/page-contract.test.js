import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_CONFIG, CURRENCY_OPTIONS } from '../js/config.js';

const root = new URL('../', import.meta.url);

test('one-page audit contains the required sections and controls', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const value of ['FeeVeto', 'Keep, switch, or cancel with confidence.', 'id="audit"', 'id="how-it-works"', 'id="privacy"', 'id="faq"', 'id="subscription-form"', 'id="subscription-list"', 'id="announcer"', 'id="sign-in-button"', 'id="sign-up-button"', 'id="user-button"', 'id="access-badge"', 'id="service-id"', 'id="product-type"', 'id="requirement-questions"', 'id="required-title"', 'id="required-game"', 'id="server-country"', 'id="target-language"', 'id="learner-level"', 'id="specific-subject"', 'Save and review']) {
    assert.ok(html.includes(value), `Missing ${value}`);
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Page must not contain duplicate IDs');
  assert.doesNotMatch(html, /\son(?:click|change|submit)=/i);
});

test('subscription inputs use one adaptive form without a detailed-review dialog', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const app = await readFile(new URL('js/app.js', root), 'utf8');
  const render = await readFile(new URL('js/render.js', root), 'utf8');
  assert.doesNotMatch(html, /detail-dialog|detail-form|Save detailed review|Review in more detail/);
  assert.doesNotMatch(app, /openDetailedReview|detailDialog|detailForm|data-close-detail/);
  assert.doesNotMatch(html, /name="adSupportedPlan"/);
  assert.match(render, /Retry alternatives/);
  assert.match(app, /upsertSubscription/);
  assert.match(app, /await journey\.saveSubscription\(item\)/);
  assert.match(html, /aria-describedby="subscription-save-help"/);
  assert.match(html, /id="subscription-save-status"[^>]*role="status"/);
  assert.match(html, /Retry account save/);
});

test('partial-information alternatives have clear guidance and distinct result states', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const render = await readFile(new URL('js/render.js', root), 'utf8');
  const provider = await readFile(new URL('js/alternativeProvider.js', root), 'utf8');
  assert.match(html, /More details help us find better matches\./);
  assert.match(html, /Start with the basics, or add your requirements and preferences for more tailored suggestions\./);
  assert.match(render, /These are general suggestions based on the information provided\./);
  assert.match(render, /Improve my matches/);
  for (const state of ['general_suggestions', 'matched_suggestions', 'unsupported', 'no_matches', 'catalogue_unavailable', 'request_failed', 'access_restricted']) {
    assert.match(provider, new RegExp(state));
  }
});

test('old product name is not visible in page copy or metadata', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const withoutUrls = html.replace(/(?:href|src|content)="[^"]*SubKiller[^"]*"/g, '');
  assert.doesNotMatch(withoutUrls, /SubKiller/i);
});

test('privacy distinguishes local subscriptions from opt-in account assessments', async () => {
  const html = await readFile(new URL('privacy.html', root), 'utf8');
  assert.match(html, /original subscription list stays in this browser/i);
  assert.match(html, /Signing in alone does not upload the local list/i);
  assert.match(html, /does not send the subscription name, entered price, private notes, calculated totals, or your full subscription list/i);
  assert.match(html, /Choosing Save this audit stores those answers/i);
  assert.match(html, /Choosing Save and review in the subscription form while signed in also saves/i);
  assert.match(html, /Protected comparison snapshots are not stored in local or session storage/i);
  assert.match(html, /Clerk for optional authentication/i);
});

test('restricted catalogue records are absent from public frontend sources', async () => {
  const publicCatalogue = await readFile(new URL('data/alternatives.js', root), 'utf8');
  const provider = await readFile(new URL('js/alternativeProvider.js', root), 'utf8');
  assert.match(publicCatalogue, /Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(provider, /data\/alternatives/);
  assert.match(await readFile(new URL('.gitignore', root), 'utf8'), /^\.private\/$/m);
  const fixture = await readFile(new URL('fixtures/catalogue.example.json', root), 'utf8');
  assert.match(fixture, /Fictional/);
  assert.doesNotMatch(fixture, /Adobe Express|Mistral|Photopea|Disney\+|Proton Drive/i);
});

test('private catalogue access uses schema version 2 and a no-store API response', async () => {
  const store = await readFile(new URL('functions/_shared/catalogue-store.js', root), 'utf8');
  const http = await readFile(new URL('functions/_shared/http.js', root), 'utf8');
  assert.match(store, /catalogue:v2/);
  assert.match(store, /schemaVersion !== 2/);
  assert.match(http, /['"]Cache-Control['"]:\s*['"]no-store['"]/i);
});

test('Clerk integration uses only a Vite publishable key in browser code', async () => {
  const auth = await readFile(new URL('js/auth.js', root), 'utf8');
  const access = await readFile(new URL('js/access.js', root), 'utf8');
  const viteConfig = await readFile(new URL('vite.config.js', root), 'utf8');
  assert.match(viteConfig, /VITE_CLERK_PUBLISHABLE_KEY/);
  assert.match(viteConfig, /CLERK_PUBLISHABLE_KEY/);
  assert.match(auth, /__FEEVETO_CLERK_PUBLISHABLE_KEY__/);
  assert.match(auth, /mountUserButton/);
  assert.match(auth, /openSignIn/);
  assert.match(auth, /openSignUp/);
  assert.match(auth, /onAccessChange\(ORDINARY_ACCESS\)/);
  const app = await readFile(new URL('js/app.js', root), 'utf8');
  assert.match(app, /alternativeResults\.clear\(\)/);
  assert.match(app, /cached\.accessScope === 'complete'/);
  assert.doesNotMatch(auth, /CLERK_SECRET_KEY/);
  assert.doesNotMatch(access, /CLERK_SECRET_KEY|privateMetadata|localStorage/);
  assert.doesNotMatch(viteConfig, /environment\.CLERK_SECRET_KEY/);
});

test('Cloudflare access control reads Clerk private metadata only on the backend', async () => {
  const clerkAccess = await readFile(new URL('functions/_shared/clerk-access.js', root), 'utf8');
  const policy = await readFile(new URL('functions/_shared/access-policy.js', root), 'utf8');
  assert.match(clerkAccess, /authenticateRequest/);
  assert.match(clerkAccess, /users\.getUser/);
  assert.match(clerkAccess, /user\.privateMetadata/);
  assert.match(clerkAccess, /acceptsToken:\s*'session_token'/);
  assert.doesNotMatch(clerkAccess, /publicMetadata|unsafeMetadata|request\.json|localStorage/);
  assert.doesNotMatch(policy, /request|localStorage/);
});

test('payment UI relies on signed server fulfillment rather than browser entitlement flags', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const browserBilling = await readFile(new URL('js/billing.js', root), 'utf8');
  const webhook = await readFile(new URL('functions/api/billing/webhook.js', root), 'utf8');
  const billingAccess = await readFile(new URL('functions/_shared/billing-access.js', root), 'utf8');
  assert.match(html, /id="pricing"/);
  assert.match(html, /id="premium-button"/);
  assert.match(html, /one time/i);
  assert.doesNotMatch(browserBilling, /localStorage|premiumAccess\s*=/);
  assert.match(webhook, /constructEventAsync/);
  assert.match(webhook, /priceIds\[0\] !== expectedPriceId/);
  assert.match(billingAccess, /FEEVETO_BILLING/);
  assert.doesNotMatch(`${html}\n${browserBilling}`, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/);
});

test('visual system is light and respects reduced motion', async () => {
  const css = await readFile(new URL('style.css', root), 'utf8');
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /#f5f7f2/i);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /glassmorphism/i);
});

test('one global currency preference drives structured examples and new-entry defaults', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const privacy = await readFile(new URL('privacy.html', root), 'utf8');
  const app = await readFile(new URL('js/app.js', root), 'utf8');
  assert.equal(APP_CONFIG.defaultCurrency, 'USD');
  assert.deepEqual(CURRENCY_OPTIONS.map(([currency]) => currency), ['USD', 'EUR', 'GBP', 'CHF']);
  assert.match(html, /id="currency-preference"/);
  assert.match(html, /data-example-money="annualAudit"/);
  assert.match(html, /data-example-money="potentialSavings"/);
  assert.match(html, /data-example-money="annualCreativeToolkit"/);
  assert.match(html, /data-example-money="creativeToolkitCostPerUse"/);
  assert.doesNotMatch(html, /CHF\s*[0-9]/);
  assert.doesNotMatch(html, /id="audit-currency"/);
  assert.match(app, /renderIllustrativeMoney/);
  assert.match(app, /getAlternatives\(item, token, state\.auditCurrency\)/);
  assert.match(html, /market used for alternatives/);
  assert.match(html, /entered country overrides/);
  assert.match(privacy, /id="page-currency-preference"/);
  assert.match(privacy, /js\/currencyPage\.js/);
});
