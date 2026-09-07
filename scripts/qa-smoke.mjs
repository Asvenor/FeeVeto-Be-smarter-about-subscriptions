// Explicit local-only browser QA. Uses fictional catalogue data and no account bypass.
// Start Vite, then run with PLAYWRIGHT_MODULE pointing to an installed Playwright module.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { APP_CONFIG } from '../js/config.js';
import { handleRecommendationsRequest } from '../functions/api/alternatives/recommendations.js';
import { CatalogueConfigurationError } from '../functions/_shared/catalogue-store.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4174';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('QA must run locally.');
const output = new URL('../.private/qa/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile(new URL('../fixtures/catalogue.example.json', import.meta.url))).offers;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let failure = false;
  let requests = 0;
  await page.route('**/api/alternatives/recommendations', async (route) => {
    requests += 1;
    const source = route.request();
    const response = await handleRecommendationsRequest({ request: new Request(source.url(), { method: 'POST', headers: source.headers(), body: source.postData() }) }, {
      catalogueLoader: async () => { if (failure) throw new CatalogueConfigurationError('Test outage'); return fixture; },
    });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), APP_CONFIG.storageKey);
  const ready = () => page.waitForFunction(() => document.querySelector('#currency-preference')?.options.length === 4);
  const waitResults = () => page.waitForFunction(() => !document.querySelector('#subscription-list .empty-alternatives')?.textContent.includes('Looking for'));
  await page.goto(base);
  await ready();
  assert.equal(await page.locator('#currency-preference').inputValue(), 'USD');
  await page.locator('[name="name"]').fill('Canva');
  await page.locator('[name="price"]').fill('12.50');
  await page.locator('#currency-preference').selectOption('EUR');
  assert.equal(await page.locator('[name="currency"]').inputValue(), 'USD');
  await page.locator('#submit-button').click();
  await page.locator('.general-suggestions-note').waitFor();
  assert.equal((await saved()).subscriptions.length, 1);
  assert.equal((await saved()).subscriptions[0].currency, 'USD');
  assert.match(await page.locator('.alternative-card').innerText(), /Check current pricing/);
  await page.locator('#subscription-list').screenshot({ path: new URL('after-mobile-results.png', output).pathname, style: '.site-header, .toast, .skip-link { visibility: hidden !important; }' });

  await page.getByRole('button', { name: 'Improve alternative matches for Canva' }).click();
  await page.locator('[name="requirement_templates"]').selectOption('must');
  await page.locator('[name="country"]').fill('US');
  await page.locator('[name="platform"]').selectOption('web');
  await page.locator('[name="householdUse"][value="false"]').check();
  await page.locator('[name="householdUse"][value=""]').check();
  await page.locator('[name="neededFeatures"]').fill('Private local QA note');
  await page.locator('#result-search').fill('hidden by search');
  await page.locator('#submit-button').click();
  await waitResults();
  assert.equal(await page.locator('#result-search').inputValue(), '');
  let data = await saved();
  assert.equal(data.subscriptions.length, 1);
  assert.equal(data.subscriptions[0].detailedReview.householdUse, null);
  assert.deepEqual(data.subscriptions[0].detailedReview.mustHaveRequirements, ['templates']);
  assert.equal(await page.locator('.subscription-card').count(), 1);
  await page.getByRole('button', { name: 'Edit Canva', exact: true }).click();
  assert.equal(await page.locator('[name="neededFeatures"]').inputValue(), 'Private local QA note');
  await page.locator('[name="name"]').fill('Cancelled edit');
  await page.locator('#cancel-edit').click();
  assert.deepEqual((await saved()).subscriptions, data.subscriptions);

  await page.getByRole('button', { name: 'Edit Canva', exact: true }).click();
  await page.locator('[name="productType"]').selectOption('cloud_storage');
  assert.equal(await page.locator('[name="serviceId"]').inputValue(), '');
  await page.locator('[name="requirement_file_sharing"]').selectOption('must');
  await page.locator('#submit-button').click(); await waitResults();
  data = await saved();
  assert.equal(data.subscriptions.length, 1);
  assert.deepEqual(data.subscriptions[0].detailedReview.mustHaveRequirements, ['file_sharing']);
  assert.equal(data.subscriptions[0].detailedReview.country, 'US');

  await page.locator('[name="name"]').fill('Netflix');
  assert.equal(await page.locator('#advertisement-field').isVisible(), false);
  await page.locator('[name="requirement_ad_free"]').selectOption('must');
  await page.locator('[name="price"]').fill('9.99');
  await page.locator('[name="currency"]').selectOption('CHF');
  await page.locator('#submit-button').click(); await waitResults();
  assert.equal((await saved()).subscriptions.length, 2);
  assert.match(await page.locator('#currency-summary').innerText(), /CHF/);
  for (const currency of ['GBP', 'CHF', 'USD', 'EUR']) {
    await page.locator('#currency-preference').selectOption(currency);
    assert.deepEqual((await saved()).subscriptions.map((item) => item.currency), ['USD', 'CHF']);
  }
  await page.reload();
  await ready();
  assert.equal(await page.locator('#currency-preference').inputValue(), 'EUR');
  await page.getByRole('button', { name: 'Edit Netflix', exact: true }).click();
  assert.equal(await page.locator('[name="requirement_ad_free"]').inputValue(), 'must');
  assert.equal(await page.locator('[name="currency"]').inputValue(), 'CHF');
  await page.locator('#cancel-edit').click();
  await page.getByRole('button', { name: 'Delete Netflix', exact: true }).click();
  assert.equal((await saved()).subscriptions.length, 1);
  await page.locator('#toast-action').click();
  assert.equal((await saved()).subscriptions.length, 2);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-data').click();
  const download = await downloadPromise;
  const backup = await readFile(await download.path());
  assert.equal(JSON.parse(backup).subscriptions.length, 2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#import-file').setInputFiles({ name: 'qa-backup.json', mimeType: 'application/json', buffer: backup });
  await page.waitForFunction(() => document.querySelector('#toast-message').textContent === 'Backup imported.');
  assert.equal((await saved()).subscriptions.length, 2);
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"subscriptions":[{"name":"Invalid","amountMinor":null}]}') });
  await page.waitForFunction(() => /not been replaced/.test(document.querySelector('#toast-message').textContent));
  assert.equal((await saved()).subscriptions.length, 2);

  failure = true;
  await page.locator('[name="name"]').fill('Canva');
  await page.locator('[name="price"]').fill('10');
  await page.locator('#submit-button').click();
  await page.getByRole('button', { name: 'Retry alternatives for Canva' }).waitFor();
  assert.equal((await saved()).subscriptions.length, 3);
  assert.equal(await page.locator('.general-suggestions-note').count(), 0);
  failure = false;
  await page.getByRole('button', { name: 'Retry alternatives for Canva' }).click();
  await page.locator('.general-suggestions-note').waitFor();

  // Supported service changes reveal only relevant fields; no saved record is edited here.
  for (const [name, field] of [['Dropbox', 'storageRequiredGb'], ['Netflix', 'requiredTitle'], ['Duolingo', 'targetLanguage']]) {
    await page.locator('[name="name"]').fill(name);
    assert.equal(await page.locator(`[name="${field}"]`).isVisible(), true);
  }
  await page.locator('[name="name"]').fill('Unknown local service');
  assert.equal(await page.locator('[name="productType"]').inputValue(), '');
  await page.locator('[name="price"]').fill('5');
  await page.locator('#submit-button').click();
  await page.getByText('This service or use case is not supported for curated alternatives yet. The basic audit is still available.', { exact: true }).waitFor();
  assert.equal((await saved()).subscriptions.length, 4);

  const dimensions = [];
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(size.document <= size.viewport + 1, `Overflow at ${width}: ${JSON.stringify(size)}`);
    dimensions.push(width);
    await page.screenshot({ path: new URL(`after-${width}.png`, output).pathname, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.hero').screenshot({ path: new URL('after-mobile-hero.png', output).pathname, style: '.site-header, .toast, .skip-link { visibility: hidden !important; }' });
  await page.addStyleTag({ content: 'html { font-size: 200%; } body { font-size: 200%; }' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Enlarged text overflows');
  await page.screenshot({ path: new URL('after-enlarged-text.png', output).pathname, fullPage: true });
  await page.reload();
  await ready();
  // Desktop 1440x900 at 200% browser zoom has a 720x450 CSS layout viewport.
  // This tests reflow equivalence, not native browser-toolbar zoom controls.
  await page.setViewportSize({ width: 720, height: 450 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '200% zoom-equivalent viewport overflows');
  await page.screenshot({ path: new URL('after-200-percent-zoom-equivalent.png', output).pathname });
  await page.reload();
  await ready();
  await page.locator('#clear-all').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#clear-dialog').evaluate((node) => node.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#clear-dialog').evaluate((node) => node.open), false);
  assert.equal(await page.locator('#clear-all').evaluate((node) => node === document.activeElement), true);
  await page.locator('#submit-button').click();
  assert.equal(await page.locator('[name="name"]').evaluate((node) => node === document.activeElement), true);
  await page.locator('[name="name"]').fill('Dropbox');
  await page.locator('[name="price"]').fill('5');
  await page.locator('[name="country"]').fill('U');
  await page.locator('#submit-button').click();
  assert.equal(await page.locator('[name="country"]').evaluate((node) => node === document.activeElement), true);
  assert.equal((await saved()).subscriptions.length, 4);
  const brokenAnchors = await page.locator('a[href^="#"]').evaluateAll((links) => links.filter((link) => !document.getElementById(link.hash.slice(1))).map((link) => link.hash));
  assert.deepEqual(brokenAnchors, []);
  assert.deepEqual(errors, []);
  const storageContext = await browser.newContext();
  await storageContext.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Test quota failure'); }; });
  const storagePage = await storageContext.newPage();
  await storagePage.goto(base);
  await storagePage.locator('#storage-warning').waitFor({ state: 'visible' });
  await storagePage.locator('[name="name"]').fill('Local unknown service');
  await storagePage.locator('[name="price"]').fill('10');
  await storagePage.locator('#submit-button').click();
  await storagePage.locator('.subscription-card').waitFor();
  assert.equal(await storagePage.locator('#storage-warning').isVisible(), true, 'Success toast must not conceal a storage failure');
  await storageContext.close();
  console.log(JSON.stringify({ result: 'PASS', viewports: dimensions, requests, pageErrors: errors, screenshots: output.pathname, auth: 'Signed-out only; server policy tested separately. No development account credentials.' }, null, 2));
} finally { await browser.close(); }
