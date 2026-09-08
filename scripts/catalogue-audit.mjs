import assert from 'node:assert/strict';
import { writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCatalogueFile } from './catalogue-validate.mjs';
import { SUPPORTED_SERVICES } from '../js/serviceCatalog.js';
import { CURRENCIES } from '../js/config.js';
import { resolveAccess } from '../functions/_shared/access-policy.js';
import { validateOffer, selectRecommendations } from '../functions/_shared/alternatives.js';
import { CATALOGUE_KEY } from '../functions/_shared/catalogue-store.js';
import { handleRecommendationsRequest } from '../functions/api/alternatives/recommendations.js';
import { JSDOM } from 'jsdom';
import { alternativeCard } from '../js/render.js';

export function auditRenderedCards(catalogue) {
  const dom = new JSDOM('<main></main>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    for (const offer of catalogue.offers) {
      const item = selectRecommendations([offer], { productType: offer.productType }, { premiumAccess: true }).items[0];
      const card = alternativeCard(item, offer.relevantServices[0]);
      assert.equal(card.querySelector('h4').textContent, `${offer.productName} — ${offer.planName}`);
      const terms = [...card.querySelectorAll('dt')];
      const price = terms.find((term) => term.textContent === 'Verified price').nextElementSibling.textContent;
      if (offer.priceMinor === null) assert.equal(price, 'Check current pricing');
      if (offer.pricingModel === 'free') assert.equal(price, 'Free');
      assert.equal(card.querySelectorAll('.alternative-sources a').length, offer.sourceUrls.length);
      for (const link of card.querySelectorAll('a')) {
        assert.equal(new URL(link.href).protocol, 'https:');
        assert.ok(link.rel.includes('noopener'));
      }
    }
    return { passed: true, cards: catalogue.offers.length, visualBrowserTest: false };
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
}

export async function auditCatalogue(catalogue) {
  // Real catalogue records + production handler/loader/matcher. Only the KV
  // transport and identity verification result are simulated; no network calls.
  const identities = {
    signedOut: {}, ordinary: { authenticated: true },
    beta: { authenticated: true, privateMetadata: { role: 'user', betaAccess: true } },
    admin: { authenticated: true, privateMetadata: { role: 'admin', betaAccess: false } },
    paid: { authenticated: true, paidPremiumAccess: true },
  };
  const matrix = [];
  let kvReads = 0;
  const env = { FEEVETO_ALTERNATIVES: { get: async (key, options) => {
    assert.equal(key, CATALOGUE_KEY);
    assert.equal(options.type, 'json');
    kvReads += 1;
    return structuredClone(catalogue);
  } } };
  for (const service of SUPPORTED_SERVICES) {
    for (const currency of CURRENCIES) {
      for (const [identity, settings] of Object.entries(identities)) {
        const access = resolveAccess(settings);
        const request = new Request('https://feeveto.example/api/alternatives/recommendations', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(access.authenticated ? { Authorization: 'Bearer fictional-test-session' } : {}) },
          // Deliberately forged body flags must not change ordinary access.
          body: JSON.stringify({ serviceId: service.id, marketCurrency: currency, limit: 12, role: 'admin', betaAccess: true, premiumAccess: true }),
        });
        const response = await handleRecommendationsRequest({ request, env }, { accessResolver: async () => {
          assert.equal(access.authenticated, true, 'Signed-out discovery must not call session verification.');
          return access;
        } });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.ok(result.items.length > 0, `No basic output: ${service.id}/${currency}/${identity}.`);
        assert.equal(result.accessScope, access.premiumAccess ? 'complete' : 'public');
        for (const item of result.items) {
          assert.equal(item.productType, service.productType);
          assert.equal(item.matchStatus, 'general');
          if (!access.premiumAccess) assert.notEqual(item.pricingModel, 'free');
        }
        matrix.push({ serviceId: service.id, currency, identity, returned: result.items.length, total: result.total });
      }
    }
  }
  let assertionsByRecord = 0;
  for (const raw of catalogue.offers) {
    const offer = validateOffer(raw);
    assert.ok(offer);
    const query = { productType: offer.productType, includePaid: true, includeFree: true };
    const publicResult = selectRecommendations([raw], query);
    const completeResult = selectRecommendations([raw], query, { premiumAccess: true });
    assert.equal(publicResult.items.length, offer.pricingModel === 'free' ? 0 : 1);
    assert.equal(completeResult.items.length, 1);
    assert.equal(completeResult.items[0].price.amountMinor, offer.priceMinor);
    assert.equal(completeResult.items[0].price.currency, offer.priceCurrency);
    assert.equal(selectRecommendations([raw], { ...query, includeFree: false, includePaid: false }, { premiumAccess: true }).items.length, 0);
    for (const feature of offer.unsupportedFeatures) {
      assert.equal(selectRecommendations([raw], { ...query, mustHave: [feature] }, { premiumAccess: true }).items.length, 0);
    }
    for (const feature of offer.unknownFeatures) {
      const result = selectRecommendations([raw], { ...query, mustHave: [feature], country: offer.countryAvailability.countries[0] || 'US', platform: offer.platforms[0] || 'web' }, { premiumAccess: true });
      if (result.items.length) assert.notEqual(result.items[0].matchStatus, 'matched');
    }
    if (offer.countryAvailability.status === 'limited') {
      const excluded = ['US', 'CH', 'GB', 'JP', 'CN', 'AQ'].find((country) => !offer.countryAvailability.countries.includes(country));
      if (excluded) assert.equal(selectRecommendations([raw], { ...query, country: excluded, marketCurrency: 'USD' }, { premiumAccess: true }).items.length, 0);
    }
    assertionsByRecord += 1;
  }
  const badSession = await handleRecommendationsRequest({ env, request: new Request('https://feeveto.example/api/alternatives/recommendations', {
    method: 'POST', headers: { Authorization: 'Bearer invalid-test-session' }, body: JSON.stringify({ serviceId: 'canva' }),
  }) }, { accessResolver: async () => resolveAccess() });
  assert.equal(badSession.status, 401);
  const basicRequest = () => new Request('https://feeveto.example/api/alternatives/recommendations', { method: 'POST', body: JSON.stringify({ serviceId: 'canva' }) });
  const failed = await handleRecommendationsRequest({ request: basicRequest(), env: { FEEVETO_ALTERNATIVES: { get: async () => { throw new Error('Test storage failure'); } } } });
  assert.equal(failed.status, 503);
  const retry = await handleRecommendationsRequest({ request: basicRequest(), env });
  assert.equal(retry.status, 200);
  return { passed: true, matrixCases: matrix.length, recordCases: assertionsByRecord, kvReads,
    invalidSessionRejected: true, storageFailureAndRetry: true, matrix,
    verificationBoundary: 'Local production-handler tests with actual staged catalogue, simulated identities and in-memory KV transport. No live Clerk, browser, or production KV verification.' };
}

async function main() {
  const [file, output] = process.argv.slice(2);
  assert.ok(file && output, 'Usage: node scripts/catalogue-audit.mjs <catalogue.json> <new .private/report.json>');
  const result = await validateCatalogueFile(file);
  const report = await auditCatalogue(result.catalogue);
  report.rendering = auditRenderedCards(result.catalogue);
  const parent = await realpath(dirname(resolve(output)));
  assert.ok(parent.split(sep).includes('.private'), 'Keep detailed catalogue audit reports private.');
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`Passed ${report.matrixCases} service/currency/access cases and ${report.recordCases} per-offer checks. Local only.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
