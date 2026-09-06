export const CATALOGUE_KEY = 'catalogue:v1';

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
  if (!catalogue || catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.offers)) {
    throw new CatalogueConfigurationError('The private alternatives catalogue is missing or invalid.');
  }
  return catalogue.offers;
}
