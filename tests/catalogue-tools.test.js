import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalogueFile } from '../scripts/catalogue-validate.mjs';
import { validateOffer } from '../functions/_shared/alternatives.js';

const fixturePath = new URL('../fixtures/catalogue.example.json', import.meta.url).pathname;

test('the tracked catalogue fixture is fictional and passes the production validator', async () => {
  const result = await validateCatalogueFile(fixturePath);
  assert.equal(result.offerCount, 1);
  assert.equal(result.catalogue.schemaVersion, 2);
  assert.match(result.catalogue.offers[0].productName, /Fictional/);
});

test('records without official evidence or an actual verification date are rejected', () => {
  const raw = {
    id: 'fictional', productId: 'fictional', offerId: 'free', productName: 'Fictional', planName: 'Free',
    providerServiceId: '', relevantServices: ['canva'], productType: 'graphic_design', relationship: 'replacement',
    description: 'Test only.', pricingModel: 'free', priceMinor: 0, priceCurrency: null, billingInterval: null,
    features: ['templates'], unsupportedFeatures: [], unknownFeatures: [], platforms: ['web'],
    countryAvailability: { status: 'worldwide', countries: [] }, freePlanLimits: true, switchingDifficulty: 'easy',
    officialUrl: 'https://fictional.example/', sourceUrls: [], verifiedAt: '', trialOnly: false,
    affiliateUrl: null, affiliateStatus: 'not_applied',
  };
  assert.equal(validateOffer(raw), null);
  assert.equal(validateOffer({ ...raw, sourceUrls: ['https://fictional.example/evidence'], verifiedAt: 'not-a-date' }), null);
});
