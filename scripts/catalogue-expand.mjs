import { readFile, readdir, mkdir, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { validateOffer, freshnessFor } from '../functions/_shared/alternatives.js';
import { PRODUCT_TYPE_IDS, SUPPORTED_SERVICES, requirementsForProductType } from '../js/serviceCatalog.js';

const OPTIONAL_FIELDS = [
  'platforms', 'countryAvailability', 'advertisements', 'storageGb', 'freePlanLimits',
  'languages', 'levels', 'serverCountries', 'switchingDifficulty', 'priceMinor', 'priceCurrency',
  'billingInterval', 'upfrontCommitmentMonths', 'introductoryTerms', 'renewalTerms', 'usageLimits', 'pricingUrl',
];
const INPUT_FIELDS = new Set([
  'productId', 'productName', 'offerId', 'planName', 'pricingModel', 'officialUrl', 'sourceUrls',
  'features', 'unsupportedFeatures', 'description', 'limitations', 'evidence', ...OPTIONAL_FIELDS,
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkedDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function normalizeSources(urls) {
  assert(Array.isArray(urls) && urls.length > 0 && urls.length <= 10, 'One to ten official source URLs are required.');
  return urls.map((value) => {
    const url = new URL(value);
    assert(url.protocol === 'https:' && !url.username && !url.password, 'Sources must be credential-free HTTPS URLs.');
    assert(![...url.searchParams.keys()].some((key) => /^(utm_|affiliate|affid|token|secret|api_key)/i.test(key)), 'Remove tracking or credential parameters from sources.');
    return url.href;
  });
}

export function compileResearchRecord(record, productType, checkedAt) {
  assert(record && typeof record === 'object' && !Array.isArray(record), 'Expected a research record.');
  assert(Object.keys(record).every((key) => INPUT_FIELDS.has(key)), `Unexpected field on ${record.productId || 'record'}.`);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.productId), 'Use a stable lowercase product slug.');
  assert(typeof record.evidence === 'string' && record.evidence.trim().length > 0, `Missing evidence note: ${record.productId}.`);
  assert(checkedDate(checkedAt), 'A real source-check date is required.');
  assert(PRODUCT_TYPE_IDS.includes(productType), `Unknown product type: ${productType}.`);
  const relevantServices = SUPPORTED_SERVICES.filter((service) => service.productType === productType).map(({ id }) => id);
  const requirements = requirementsForProductType(productType).map(([id]) => id);
  const features = record.features || [];
  const unsupportedFeatures = record.unsupportedFeatures || [];
  assert(Array.isArray(features) && Array.isArray(unsupportedFeatures), 'Feature claims must be arrays.');
  const offerId = record.offerId || 'curated';
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(offerId), 'Use a stable lowercase offer slug.');
  const optional = Object.fromEntries(OPTIONAL_FIELDS.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
  const offer = {
    id: `${record.productId}-${offerId}`, productId: record.productId, offerId,
    productName: record.productName, planName: record.planName,
    providerServiceId: '', relevantServices, productType, relationship: 'replacement',
    description: record.description, pricingModel: record.pricingModel,
    priceMinor: record.pricingModel === 'free' ? 0 : null, priceCurrency: null,
    billingInterval: record.pricingModel === 'free' ? null : record.pricingModel === 'one_time' ? 'one_time' : 'varies',
    upfrontCommitmentMonths: null, introductoryTerms: null, renewalTerms: null,
    features, unsupportedFeatures,
    unknownFeatures: requirements.filter((id) => !features.includes(id) && !unsupportedFeatures.includes(id)),
    limitations: record.limitations || [], usageLimits: [], platforms: [],
    countryAvailability: { status: 'unknown', countries: [] }, advertisements: null, storageGb: null,
    freePlanLimits: record.pricingModel === 'free', languages: [], levels: [], serverCountries: [],
    switchingDifficulty: 'unknown', officialUrl: normalizeSources([record.officialUrl])[0], pricingUrl: null,
    sourceUrls: normalizeSources(record.sourceUrls), verifiedAt: checkedAt, reviewRating: null,
    trialOnly: false, affiliateUrl: null, affiliateStatus: 'not_applied', ...optional,
  };
  offer.priceVerifiedAt = offer.priceMinor === null ? null : checkedAt;
  if (offer.pricingUrl) offer.pricingUrl = normalizeSources([offer.pricingUrl])[0];
  const validated = validateOffer(offer);
  assert(validated, `Invalid compiled offer: ${offer.id}.`);
  // The runtime normalizer is deliberately forgiving of older records. New
  // research must not silently lose fields, country lists, or long limitations.
  assert(isDeepStrictEqual(offer, validated), `Normalization would change or truncate ${offer.id}; correct the source record.`);
  return offer;
}

export function catalogueCoverage(offers, { families = {}, asOf = new Date() } = {}) {
  const familyFor = (id) => families[id] || id;
  const products = new Set(offers.map(({ productId }) => productId));
  for (const [id, family] of Object.entries(families)) {
    assert(products.has(id) && products.has(family), 'Family mappings must reference existing products.');
    assert(!families[family] || families[family] === family, 'Family mappings must point directly to a canonical product.');
  }
  return {
    offerCount: offers.length,
    productCount: products.size,
    distinctServiceCount: new Set([...products].map(familyFor)).size,
    freeOffers: offers.filter((offer) => offer.pricingModel === 'free').length,
    publicPaidOffers: offers.filter((offer) => offer.pricingModel !== 'free').length,
    unknownPaidPrices: offers.filter((offer) => offer.pricingModel !== 'free' && offer.priceMinor === null).length,
    unknownAvailability: offers.filter((offer) => offer.countryAvailability.status === 'unknown').length,
    unknownPlatforms: offers.filter((offer) => !offer.platforms.length).length,
    recordsDueForRecheck: offers.filter((offer) => freshnessFor(offer.verifiedAt, asOf).needsRecheck).map(({ id }) => id),
    sourceCount: new Set(offers.flatMap(({ sourceUrls }) => sourceUrls)).size,
    categories: PRODUCT_TYPE_IDS.map((productType) => {
      const subset = offers.filter((offer) => offer.productType === productType);
      return { productType, offers: subset.length,
        services: new Set(subset.map(({ productId }) => familyFor(productId))).size,
        publicPaidOffers: subset.filter((offer) => offer.pricingModel !== 'free').length,
        freeOffers: subset.filter((offer) => offer.pricingModel === 'free').length };
    }),
  };
}

export function expandCatalogue(base, batches, { minProducts = 150, families = {}, asOf = new Date(), requiredProductTypes = PRODUCT_TYPE_IDS } = {}) {
  assert(base?.schemaVersion === 2 && Array.isArray(base.offers) && base.offers.length, 'A nonempty schema-version 2 baseline is required.');
  assert(Number.isSafeInteger(minProducts) && minProducts >= 1, 'Minimum product count must be a positive integer.');
  const offers = structuredClone(base.offers);
  const existingProducts = new Set(offers.map(({ productId }) => productId));
  const normalizedName = (name) => String(name || '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  const existingNames = new Set(offers.map(({ productName }) => normalizedName(productName)));
  const evidence = [];
  for (const batch of batches) {
    assert(Array.isArray(batch.records) && batch.records.length, 'Each research batch needs records.');
    assert(checkedDate(batch.checkedAt) && !freshnessFor(batch.checkedAt, asOf).needsRecheck, 'Research date is future-dated or needs rechecking.');
    for (const record of batch.records) {
      // Expansion is additive. Updating an existing product is a separate review,
      // never an accidental replacement or another tier used to inflate counts.
      assert(!existingProducts.has(record.productId), `Product already exists: ${record.productId}. Review separately instead of replacing it.`);
      assert(!existingNames.has(normalizedName(record.productName)), `Product name already exists: ${record.productName}.`);
      const offer = compileResearchRecord(record, batch.productType, batch.checkedAt);
      existingProducts.add(offer.productId);
      existingNames.add(normalizedName(offer.productName));
      offers.push(offer);
      evidence.push({ id: offer.id, checkedAt: batch.checkedAt, note: record.evidence, sourceUrls: offer.sourceUrls });
    }
  }
  const ids = new Set();
  const keys = new Set();
  for (const offer of offers) {
    assert(validateOffer(offer), `Invalid offer: ${offer.id}.`);
    const key = `${offer.productId}:${offer.offerId}`;
    assert(!ids.has(offer.id) && !keys.has(key), 'Duplicate offer identity.');
    ids.add(offer.id); keys.add(key);
  }
  const coverage = catalogueCoverage(offers, { families, asOf });
  assert(coverage.distinctServiceCount >= minProducts, `Only ${coverage.distinctServiceCount} distinct services; need ${minProducts}.`);
  for (const category of requiredProductTypes) {
    const entry = coverage.categories.find(({ productType }) => productType === category);
    assert(entry?.offers > 0 && entry.publicPaidOffers > 0, `Missing category or public paid coverage: ${category}.`);
  }
  return { catalogue: { ...structuredClone(base), offers }, coverage, evidence };
}

const hash = (value) => createHash('sha256').update(value).digest('hex');

export async function writePrivateBundle(outputDir, bundle, provenance) {
  const destination = resolve(outputDir);
  const parent = await realpath(dirname(destination));
  assert(parent.split(sep).includes('.private'), 'Write catalogue bundles inside an existing .private directory, never frontend assets.');
  // A fresh directory prevents overwriting either the baseline or a reviewed
  // bundle. If interrupted, keep the partial folder and use a new output name.
  await mkdir(destination, { mode: 0o700 });
  const catalogueJson = `${JSON.stringify(bundle.catalogue, null, 2)}\n`;
  const manifest = { ...provenance, catalogueSha256: hash(catalogueJson),
    bytes: Buffer.byteLength(catalogueJson), stagedOnly: true,
    verificationBoundary: 'Provider-source review and local tests; not provider-app testing or live publication.' };
  for (const [name, value] of Object.entries({ 'catalogue.json': bundle.catalogue, 'coverage.json': bundle.coverage, 'evidence.json': bundle.evidence, 'manifest.json': manifest })) {
    await writeFile(resolve(destination, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  return { destination, manifest };
}

async function main() {
  const { values } = parseArgs({ options: {
    base: { type: 'string' }, research: { type: 'string' }, 'output-dir': { type: 'string' },
    families: { type: 'string' }, 'min-products': { type: 'string', default: '150' },
  } });
  assert(values.base && values.research && values['output-dir'], 'Usage: node scripts/catalogue-expand.mjs --base <private.json> --research <private-directory> --output-dir <new .private/directory> [--families <private.json>]');
  const baseText = await readFile(values.base, 'utf8');
  const batchFiles = (await readdir(values.research)).filter((file) => file.endsWith('.json')).sort();
  const texts = await Promise.all(batchFiles.map((file) => readFile(resolve(values.research, file), 'utf8')));
  const familiesText = values.families ? await readFile(values.families, 'utf8') : '{}';
  const bundle = expandCatalogue(JSON.parse(baseText), texts.map((value) => JSON.parse(value)), {
    families: JSON.parse(familiesText), minProducts: Number(values['min-products']),
  });
  const output = await writePrivateBundle(values['output-dir'], bundle, {
    generatedAt: new Date().toISOString(), baseSha256: hash(baseText), familiesSha256: hash(familiesText),
    baselineOffersPreserved: JSON.parse(baseText).offers.length,
    research: batchFiles.map((file, index) => ({ file, sha256: hash(texts[index]) })),
  });
  process.stdout.write(`Staged ${bundle.coverage.offerCount} offers / ${bundle.coverage.distinctServiceCount} distinct services in ${output.destination}. Nothing uploaded.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
