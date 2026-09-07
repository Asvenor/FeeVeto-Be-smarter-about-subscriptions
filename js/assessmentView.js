import { element, alternativeCard } from "./render.js";
import { formatMoney } from "./calculations.js";
import { requirementsForProductType } from "./serviceCatalog.js";

export function renderAssessment(container, assessment) {
  container.replaceChildren();
  container.append(
    element("h3", "", assessment.title),
    element("p", "fit-label", assessment.fitLabel),
  );
  const reasons = element("ul", "assessment-reasons");
  for (const reason of assessment.reasons)
    reasons.append(element("li", "", reason));
  container.append(reasons);
  container.append(
    element(
      "p",
      "",
      assessment.currentAnnualMinor === null
        ? "Current annual spending: unknown."
        : `Current annual spending: ${formatMoney(assessment.currentAnnualMinor, assessment.currency)} (based on your bill).`,
    ),
  );
  const cards = element("div", "instant-results");
  for (const item of assessment.alternatives.items) {
    const card = alternativeCard(item);
    if (item.id === assessment.selectedOfferId)
      card.prepend(element("p", "fit-label", "Suggested next option"));
    const comparison = item.comparison;
    card.append(
      element(
        "p",
        "comparison-cost",
        comparison.estimatedSavingsMinor === null
          ? comparison.reason
          : comparison.estimatedSavingsMinor >= 0
            ? `Estimated annual savings: ${formatMoney(comparison.estimatedSavingsMinor, comparison.currency)}.`
            : `Estimated extra annual cost: ${formatMoney(-comparison.estimatedSavingsMinor, comparison.currency)}.`,
      ),
    );
    if (comparison.commitment)
      card.append(element("p", "field-help", comparison.commitment));
    const labels = new Map(requirementsForProductType(item.productType));
    for (const [ids, prefix] of [
      [item.retainedFeatures, "Essential features retained"],
      [item.lostPreferences, "Preferences not covered"],
      [item.unconfirmedEssentials, "Must-have features still unconfirmed"],
    ]) {
      if (ids?.length)
        card.append(
          element(
            "p",
            "field-help",
            `${prefix}: ${ids.map((id) => labels.get(id) || id).join(", ")}.`,
          ),
        );
    }
    cards.append(card);
  }
  if (!assessment.alternatives.items.length)
    cards.append(
      element(
        "p",
        "",
        assessment.alternatives.message ||
          "No eligible checked comparison is available.",
      ),
    );
  container.append(
    cards,
    element("h4", "", "Your next step"),
    element("p", "", assessment.nextStep),
  );
  const details = element("details", "assessment-evidence");
  details.append(
    element("summary", "", "Assumptions, missing answers, and date"),
  );
  details.append(
    element(
      "p",
      "",
      `Assessed ${new Date(assessment.assessedAt).toLocaleString()}. Calculation: ${assessment.version}; ranking: ${assessment.rankingVersion}.`,
    ),
  );
  for (const assumption of assessment.assumptions)
    details.append(element("p", "", assumption));
  if (assessment.missing.length)
    details.append(
      element("p", "", `Still unknown: ${assessment.missing.join("; ")}.`),
    );
  details.append(
    element(
      "p",
      "",
      "Sources and verification dates are listed on each comparison. Catalogue facts are flagged for rechecking after 90 days.",
    ),
  );
  container.append(details);
}
