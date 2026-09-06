import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOffer } from '../functions/_shared/alternatives.js';

export async function validateCatalogueFile(filePath) {
  const absolutePath = resolve(filePath);
  let catalogue;
  try {
    catalogue = JSON.parse(await readFile(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read valid JSON from ${absolutePath}: ${error.message}`);
  }
  if (!catalogue || catalogue.schemaVersion !== 2 || !Array.isArray(catalogue.offers)) {
    throw new Error('Catalogue root must contain schemaVersion 2 and an offers array.');
  }
  const ids = new Set();
  const offerKeys = new Set();
  for (const [index, rawOffer] of catalogue.offers.entries()) {
    const offer = validateOffer(rawOffer);
    if (!offer) throw new Error(`Offer ${index + 1} (${rawOffer?.id || 'missing id'}) is invalid.`);
    const offerKey = `${offer.productId}:${offer.offerId}`;
    if (ids.has(offer.id)) throw new Error(`Duplicate offer id: ${offer.id}`);
    if (offerKeys.has(offerKey)) throw new Error(`Duplicate product/offer pair: ${offerKey}`);
    ids.add(offer.id);
    offerKeys.add(offerKey);
  }
  return { absolutePath, catalogue, offerCount: catalogue.offers.length };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error('Usage: node scripts/catalogue-validate.mjs <catalogue.json>');
  const result = await validateCatalogueFile(filePath);
  process.stdout.write(`Validated ${result.offerCount} catalogue offers in ${result.absolutePath}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
