import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileResearchRecord, expandCatalogue, catalogueCoverage, writePrivateBundle } from '../scripts/catalogue-expand.mjs';
import { selectRecommendations, validateOffer } from '../functions/_shared/alternatives.js';

const base = JSON.parse(await readFile(new URL('../fixtures/catalogue.example.json', import.meta.url), 'utf8'));
const checkedAt = '2026-09-07';
const record = {
  productId: 'fictional-expanded', productName: 'Fictional Expanded', planName: 'Standard',
  pricingModel: 'subscription', officialUrl: 'https://expanded.example/',
  sourceUrls: ['https://expanded.example/pricing'], features: ['templates'],
  description: 'Fictional research input for tests, never production.',
  limitations: ['Test fixture only.'], evidence: 'Fictional source evidence for the compiler test.',
};
const batches = [{ checkedAt, productType: 'graphic_design', records: [record] }];
const options = { minProducts: 2, requiredProductTypes: ['graphic_design'], asOf: new Date(checkedAt) };

test('research compiler retains unknown price, availability, ads and unverified features', () => {
  const offer = compileResearchRecord(record, 'graphic_design', checkedAt);
  assert.equal(offer.priceMinor, null);
  assert.equal(offer.priceCurrency, null);
  assert.equal(offer.priceVerifiedAt, null);
  assert.equal(offer.advertisements, null);
  assert.equal(offer.countryAvailability.status, 'unknown');
  assert.ok(offer.unknownFeatures.includes('team_collaboration'));
  assert.deepEqual(offer.unsupportedFeatures, []);
  const result = selectRecommendations([offer], { serviceId: 'canva', country: 'US', platform: 'web', mustHave: ['team_collaboration'] });
  assert.equal(result.items[0].matchStatus, 'candidate');
  assert.equal(result.items[0].price.amountMinor, null);
});

test('free stays zero while sourced annual and one-time prices keep their billing semantics', () => {
  const free = compileResearchRecord({ ...record, pricingModel: 'free' }, 'graphic_design', checkedAt);
  assert.equal(free.priceMinor, 0);
  assert.equal(free.billingInterval, null);
  assert.equal(free.freePlanLimits, true);
  const annual = compileResearchRecord({ ...record, priceMinor: 12000, priceCurrency: 'EUR', billingInterval: 'yearly', upfrontCommitmentMonths: 12 }, 'graphic_design', checkedAt);
  assert.equal(annual.priceMinor, 12000);
  assert.equal(annual.priceCurrency, 'EUR');
  assert.equal(annual.upfrontCommitmentMonths, 12);
  assert.equal(compileResearchRecord({ ...record, pricingModel: 'one_time' }, 'graphic_design', checkedAt).billingInterval, 'one_time');
});

test('expansion preserves every baseline record and root field without mutating inputs', () => {
  const original = structuredClone(base);
  const result = expandCatalogue({ ...base, privateProvenance: 'baseline' }, batches, options);
  assert.deepEqual(result.catalogue.offers.slice(0, base.offers.length), base.offers);
  assert.equal(result.catalogue.privateProvenance, 'baseline');
  result.catalogue.offers[0].description = 'changed output';
  assert.deepEqual(base, original);
  assert.equal(result.coverage.distinctServiceCount, 2);
});

test('duplicate products, disguised duplicate names and insufficient unique coverage fail closed', () => {
  assert.throws(() => expandCatalogue(base, [...batches, ...batches], options), /already exists/);
  assert.throws(() => expandCatalogue(base, [{ ...batches[0], records: [{ ...record, productName: 'Fictional Studio' }] }], options), /name already exists/);
  assert.throws(() => expandCatalogue(base, batches, { ...options, minProducts: 3 }), /Only 2/);
  const coverage = catalogueCoverage([...base.offers, { ...base.offers[0], id: 'another-tier', offerId: 'another' }]);
  assert.equal(coverage.productCount, 1);
  assert.equal(coverage.distinctServiceCount, 1);
  assert.throws(() => expandCatalogue(base, batches, { ...options, requiredProductTypes: ['online_courses'] }), /Missing category/);
});

test('explicit family mapping prevents related services from inflating the target', () => {
  const result = expandCatalogue(base, batches, { ...options, minProducts: 1, families: { 'fictional-expanded': 'fictional-studio' } });
  assert.equal(result.coverage.productCount, 2);
  assert.equal(result.coverage.distinctServiceCount, 1);
  assert.throws(() => catalogueCoverage(base.offers, { families: { missing: 'fictional-studio' } }), /existing products/);
});

test('unsupported, unreviewed, future, overlong and extraneous claims are rejected', () => {
  for (const change of [
    { evidence: '' }, { sourceUrls: [] }, { privateCredential: 'not-a-key' },
    { sourceUrls: ['https://expanded.example/?token=not-a-key'] },
    { features: ['unrecognised_claim'] }, { unsupportedFeatures: ['templates'] },
    { limitations: ['x'.repeat(181)] }, { description: 'x'.repeat(241) },
  ]) assert.throws(() => compileResearchRecord({ ...record, ...change }, 'graphic_design', checkedAt));
  assert.throws(() => expandCatalogue(base, [{ ...batches[0], checkedAt: '2027-01-01' }], options), /future-dated/);
  assert.throws(() => expandCatalogue(base, [{ ...batches[0], checkedAt: '2020-01-01' }], options), /rechecking/);
});

test('country and server lists beyond 24 retain later markets and still exclude wrong markets', () => {
  const countries = 'AT BE BG CA HR CY CZ DK EE FI FR DE SK SI HU IE IT LV LT LU MY MT NL NZ PL PT RO SG ES SE CH GB US'.split(' ');
  const offer = compileResearchRecord({ ...record, countryAvailability: { status: 'limited', countries } }, 'graphic_design', checkedAt);
  assert.deepEqual(validateOffer(offer).countryAvailability.countries, countries);
  assert.deepEqual(validateOffer({ ...offer, serverCountries: countries }).serverCountries, countries);
  assert.equal(selectRecommendations([offer], { serviceId: 'canva', marketCurrency: 'USD' }).items.length, 1);
  assert.equal(selectRecommendations([offer], { serviceId: 'canva', country: 'JP', marketCurrency: 'USD' }).items.length, 0);
});

test('compiler preserves paid/free permissions in the existing matcher', () => {
  const free = compileResearchRecord({ ...record, pricingModel: 'free' }, 'graphic_design', checkedAt);
  const query = { serviceId: 'canva', includeFree: true, includePaid: false };
  assert.equal(selectRecommendations([free], query).state, 'access_restricted');
  assert.equal(selectRecommendations([free], query, { premiumAccess: true }).items.length, 1);
});

test('private bundle writer refuses public destinations and never overwrites reviewed bundles', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'feeveto-catalogue-test-'));
  const privateDir = join(temp, '.private');
  await mkdir(privateDir);
  const bundle = expandCatalogue(base, batches, options);
  await assert.rejects(writePrivateBundle(join(temp, 'public'), bundle, {}), /private directory/);
  const destination = join(privateDir, 'reviewed');
  await writePrivateBundle(destination, bundle, { baseSha256: 'test' });
  const saved = await readFile(join(destination, 'catalogue.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), bundle.catalogue);
  assert.equal((await stat(join(destination, 'catalogue.json'))).mode & 0o777, 0o600);
  await assert.rejects(writePrivateBundle(destination, bundle, {}), /EEXIST/);
  assert.equal(await readFile(join(destination, 'catalogue.json'), 'utf8'), saved);
});
