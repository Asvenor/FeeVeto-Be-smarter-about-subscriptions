import { validateOffer } from './alternatives.js';

export const CATALOGUE_KEY = 'catalogue:v2';

export class CatalogueConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CatalogueConfigurationError';
  }
}

export async function loadPrivateCatalogue(context) {
  const store = context.env?.FEEVETO_ALTERNATIVES;
  if (!store || typeof store.get !== 'function') {
    throw new CatalogueConfigurationError('The FEEVETO_ALTERNATIVES KV binding is not configured.');
  }
  const catalogue = await store.get(CATALOGUE_KEY, { type: 'json', cacheTtl: 60 });
  if (!catalogue || catalogue.schemaVersion !== 2 || !Array.isArray(catalogue.offers)) {
    throw new CatalogueConfigurationError('The private alternatives catalogue is missing or invalid.');
  }
  if (!catalogue.offers.length) throw new CatalogueConfigurationError('The private alternatives catalogue is empty.');
  const validated = catalogue.offers.map(validateOffer);
  const ids = validated.map((offer) => offer?.id);
  const offerKeys = validated.map((offer) => offer && `${offer.productId}:${offer.offerId}`);
  if (validated.some((offer) => !offer) || new Set(ids).size !== ids.length || new Set(offerKeys).size !== offerKeys.length) {
    throw new CatalogueConfigurationError('The private alternatives catalogue contains invalid or duplicate offers.');
  }
  return catalogue.offers;
}
