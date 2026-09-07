import { normalizeJourneyDraft, journeyQuery } from "./journeyModel.js";
import { annualCost } from "./calculations.js";
import { evaluateSubscription } from "./recommendationEngine.js";
import { requirementsForProductType, serviceById } from "./serviceCatalog.js";

export const ASSESSMENT_VERSION = "personal-audit-v1";

export function compareAnnualCost(draft, offer, now = new Date()) {
  const current = annualCost(draft.amountMinor, draft.cycle);
  const price = offer.price || {};
  let alternative = null;
  let reason = "";
  if (current === null) reason = "Your current price is unknown.";
  else if (price.introductoryTerms)
    reason = "Introductory terms do not provide a stable annual comparison.";
  else if (offer.pricingModel === "free" && price.amountMinor === 0)
    alternative = 0;
  else if (!Number.isSafeInteger(price.amountMinor))
    reason = "The alternative price is unknown.";
  else if (price.currency !== draft.currency)
    reason = "Different currencies: no conversion or savings estimate.";
  else if (
    !Number.isFinite(Date.parse(price.verifiedAt)) ||
    (now.getTime() - Date.parse(price.verifiedAt)) / 86400000 > 90 ||
    new Date(price.verifiedAt) > now
  )
    reason =
      "Recheck this price before estimating savings; its verification is missing or out of date.";
  else if (!["monthly", "yearly"].includes(price.billingInterval))
    reason =
      "A one-time or variable price is not a comparable recurring annual cost.";
  else alternative = annualCost(price.amountMinor, price.billingInterval);
  return {
    currentAnnualMinor: current,
    alternativeAnnualMinor: alternative,
    currency: draft.currency,
    estimatedSavingsMinor:
      current !== null && alternative !== null ? current - alternative : null,
    savingsBasis: "estimate",
    reason,
    commitment:
      price.billingInterval === "yearly" || price.upfrontCommitmentMonths >= 12
        ? "Annual commitment: check the full amount payable upfront."
        : "",
  };
}

export function assessJourney(
  value,
  alternatives,
  { now = new Date(), marketCurrency = value.currency } = {},
) {
  const draft = normalizeJourneyDraft(value);
  const query = journeyQuery(draft, marketCurrency);
  const labels = new Map(requirementsForProductType(draft.productType));
  const label = (id) => labels.get(id) || id;
  const items = (alternatives.items || []).map((offer) => ({
    ...offer,
    comparison: compareAnnualCost(draft, offer, now),
    retainedFeatures: query.mustHave.filter((id) =>
      offer.features?.includes(id),
    ),
    lostPreferences: query.niceToHave.filter((id) =>
      offer.unsupportedFeatures?.includes(id),
    ),
    unconfirmedEssentials: query.mustHave.filter(
      (id) => !offer.features?.includes(id),
    ),
  }));
  const reasons = [];
  const missing = [];
  if (draft.tasks.length)
    reasons.push(`You mainly use it for ${draft.tasks.map(label).join(", ")}.`);
  if (query.mustHave.length)
    reasons.push(`Must keep: ${query.mustHave.map(label).join(", ")}.`);
  if (draft.notNeeded.length)
    reasons.push(`You do not need ${draft.notNeeded.map(label).join(", ")}.`);
  if (draft.audience)
    reasons.push(
      draft.audience === "solo"
        ? "You use it on your own."
        : draft.audience === "team"
          ? "Your team needs collaborative access."
          : "Other people in your household may depend on it.",
    );
  if (draft.usage)
    reasons.push(`Reported use: ${draft.usage.replaceAll("_", " ")}.`);
  else missing.push("How often you use the current service");
  if (draft.amountMinor === null)
    missing.push("Your current subscription price");
  if (!draft.country)
    missing.push(
      "Your actual country (currency supplies only a starting market)",
    );
  if (!draft.tasks.length && !query.mustHave.length)
    missing.push("Your main activities or must-have features");
  if (!draft.audience)
    missing.push("Whether anyone else depends on the subscription");
  if (!draft.switchingTolerance) missing.push("Acceptable switching effort");
  const legacy = evaluateSubscription({
    amountMinor: draft.amountMinor,
    cycle: draft.cycle,
    usage: draft.usage,
    importance: draft.importance,
    category: serviceById(draft.serviceId)?.category,
    status: "active",
    detailedReview: draft.context,
  });
  const hasNeeds = Boolean(query.mustHave.length || query.niceToHave.length);
  const confirmed = items.filter(
    (item) =>
      item.matchStatus === "matched" &&
      hasNeeds &&
      item.unconfirmedEssentials.length === 0,
  );
  const cheaper = confirmed.filter(
    (item) => item.comparison.estimatedSavingsMinor > 0,
  );
  const downgrade = cheaper.find((item) => item.relationship === "downgrade");
  const replacement = cheaper.find((item) => item.relationship !== "downgrade");
  let action = "review",
    title = "Review the fit before changing",
    selected = null;
  let nextStep =
    "Check the unconfirmed details below, then update your answers. You can keep exploring without a savings estimate.";
  const protectedCoverage =
    draft.productType === "cloud_storage" &&
    (draft.importance === "essential" ||
      draft.context?.categoryAnswers?.criticalBackup ||
      draft.tasks.includes("photo_backup") ||
      query.mustHave.includes("photo_backup"));
  if (draft.context?.activeContract === true || protectedCoverage) {
    action = "keep";
    title = draft.context?.activeContract
      ? "Keep coverage; review before renewal"
      : "Keep reliable backup coverage";
    reasons.push(
      ...(protectedCoverage
        ? ["Backup value is not measured only by how often you open the app."]
        : [
            "You reported an active contract. Changing plans may not end your current payments.",
          ]),
    );
    nextStep =
      "Verify your renewal terms and, for backup services, test recovery and export before cancelling or moving anything.";
  } else if (
    draft.usage === "never" &&
    draft.audience === "solo" &&
    !query.mustHave.length &&
    !draft.tasks.length &&
    !["essential", "important"].includes(draft.importance)
  ) {
    action = "cancel";
    title = "Consider cancelling after checking dependencies";
    reasons.push(
      "You reported no use, no must-have features, and no other users.",
    );
    nextStep =
      "Check backups, stored data, linked accounts, and notice periods first. Cancellation does not imply a refund of prepaid fees.";
  } else if (downgrade && ["cost", "explore"].includes(draft.motivation)) {
    action = "downgrade";
    title = "A simpler plan may cover your needs";
    selected = downgrade;
    reasons.push(
      "A checked plan from the same provider supports your selected needs at a lower comparable cost.",
    );
  } else if (replacement && draft.motivation === "cost") {
    action = "switch";
    title = "Consider switching to a lower-cost fit";
    selected = replacement;
    reasons.push(
      "This checked alternative supports your selected needs and has a lower comparable annual cost.",
    );
  } else if (
    draft.motivation === "complexity" &&
    confirmed.some(
      (item) =>
        item.switchingDifficulty === "easy" &&
        item.relationship !== "downgrade",
    )
  ) {
    action = "switch";
    title = "Try an option with an easier migration";
    selected = confirmed.find(
      (item) =>
        item.switchingDifficulty === "easy" &&
        item.relationship !== "downgrade",
    );
    reasons.push(
      "Its recorded migration effort is low. This does not prove its everyday interface is simpler; try your own workflow.",
    );
  } else if (
    ["daily", "several_per_week", "weekly"].includes(draft.usage) &&
    (draft.motivation === "explore" || legacy.recommendation === "keep")
  ) {
    action = "keep";
    title = "Keeping access looks reasonable";
    reasons.push(
      "Frequent use supports continuing access. The catalogue does not establish a better confirmed option for your answers.",
    );
    nextStep =
      "Keep using it if it meets your needs; review your plan and costs again before renewal.";
  }
  if (selected)
    nextStep = `Try ${selected.productName} with your actual tasks. Check the plan limits, export a backup, and confirm current pricing before changing your existing subscription.`;
  if (!items.length)
    reasons.push(
      alternatives.state === "catalogue_unavailable" ||
        alternatives.state === "request_failed"
        ? "The catalogue could not be checked; this is not evidence that no alternatives exist."
        : "No eligible checked alternatives are available for these requirements, market, and access level.",
    );
  return {
    version: ASSESSMENT_VERSION,
    rankingVersion: alternatives.rankingVersion || "curated-v3",
    assessedAt: now.toISOString(),
    action,
    title,
    reasons,
    nextStep,
    missing,
    selectedOfferId: selected?.id || null,
    fitLabel: selected
      ? "Fits the selected requirements"
      : "Provisional personal assessment",
    currentAnnualMinor: annualCost(draft.amountMinor, draft.cycle),
    currency: draft.currency,
    savingsBasis: "estimate",
    assumptions: [
      "Based on your answers and the checked catalogue, not a complete market comparison.",
      "Annual savings are estimates for a future full year, not a promised refund or money already saved.",
      "Customer ratings, when sourced, describe reviews—not your personal suitability.",
    ],
    market: alternatives.market || null,
    alternatives: { ...alternatives, items },
  };
}
