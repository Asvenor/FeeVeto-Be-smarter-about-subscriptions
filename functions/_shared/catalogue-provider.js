import { loadPrivateCatalogue } from "./catalogue-store.js";
import { selectRecommendations } from "./alternatives.js";

// A provider returns validated catalogue records; authorization and ranking stay
// here so a future source cannot accidentally change the public/premium boundary.
export async function curatedRecommendations(
  context,
  query,
  access,
  { load = loadPrivateCatalogue } = {},
) {
  const catalogue = await load(context);
  return selectRecommendations(catalogue, query, {
    premiumAccess: access?.premiumAccess === true,
  });
}
