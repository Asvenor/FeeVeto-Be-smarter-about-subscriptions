import { CURRENCIES, BILLING_CYCLES, USAGE_OPTIONS } from "./config.js";
import {
  SUPPORTED_SERVICES,
  serviceById,
  supportedServiceFor,
  PRODUCT_TYPE_IDS,
  requirementsForProductType,
} from "./serviceCatalog.js";
import { normalizeDetailedReview } from "./storage.js";

export const JOURNEY_VERSION = 1;
export const DRAFT_KEY = "feeveto_journey_draft_v1";
export const MOTIVATIONS = [
  ["cost", "Spend less"],
  ["needs", "Find a better fit"],
  ["complexity", "Something simpler"],
  ["unused", "I rarely use it"],
  ["explore", "Explore my options"],
];
const clean = (value, max = 160) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const minor = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999
    ? value
    : null;
const normalizedText = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const contains = (text, phrase) =>
  ` ${normalizedText(text)} `.includes(` ${normalizedText(phrase)} `);

export function normalizeJourneyDraft(value = {}, defaultCurrency = "USD") {
  const service = serviceById(value.serviceId);
  const productType =
    service?.productType ||
    (PRODUCT_TYPE_IDS.includes(value.productType) ? value.productType : "");
  const allowed = new Set(
    requirementsForProductType(productType).map(([id]) => id),
  );
  const ids = (input) =>
    Array.isArray(input)
      ? [...new Set(input.filter((id) => allowed.has(id)))].slice(0, 12)
      : [];
  const mustHave = ids(value.mustHave);
  const niceToHave = ids(value.niceToHave).filter(
    (id) => !mustHave.includes(id),
  );
  const currency = CURRENCIES.includes(value.currency)
    ? value.currency
    : CURRENCIES.includes(defaultCurrency)
      ? defaultCurrency
      : "USD";
  return {
    version: JOURNEY_VERSION,
    originalRequest: clean(value.originalRequest, 1000),
    serviceId: service?.id || "",
    productType,
    serviceName: service?.name || clean(value.serviceName, 80),
    motivation: MOTIVATIONS.some(([id]) => id === value.motivation)
      ? value.motivation
      : "explore",
    currency,
    currencyExplicit: value.currencyExplicit === true,
    amountMinor: minor(value.amountMinor),
    cycle: BILLING_CYCLES.some(([id]) => id === value.cycle)
      ? value.cycle
      : "monthly",
    country: /^[A-Z]{2}$/.test(value.country) ? value.country : "",
    platform: [
      "web",
      "windows",
      "macos",
      "linux",
      "ios",
      "android",
      "smart_tv",
      "game_console",
    ].includes(value.platform)
      ? value.platform
      : "",
    tasks: ids(value.tasks),
    mustHave,
    niceToHave,
    notNeeded: ids(value.notNeeded).filter(
      (id) => !mustHave.includes(id) && !niceToHave.includes(id),
    ),
    usage: USAGE_OPTIONS.some(([id]) => id === value.usage) ? value.usage : "",
    audience: ["solo", "team", "household"].includes(value.audience)
      ? value.audience
      : "",
    budgetMinor: minor(value.budgetMinor),
    budgetCurrency: CURRENCIES.includes(value.budgetCurrency)
      ? value.budgetCurrency
      : currency,
    switchingTolerance: ["easy", "moderate", "any"].includes(
      value.switchingTolerance,
    )
      ? value.switchingTolerance
      : "",
    acceptAds: typeof value.acceptAds === "boolean" ? value.acceptAds : null,
    acceptFreeLimits:
      typeof value.acceptFreeLimits === "boolean"
        ? value.acceptFreeLimits
        : null,
    includeFree:
      typeof value.includeFree === "boolean" ? value.includeFree : null,
    includePaid:
      typeof value.includePaid === "boolean" ? value.includePaid : null,
    context: normalizeDetailedReview(value.context),
    importance: [
      "essential",
      "important",
      "useful",
      "nice_to_have",
      "not_important",
    ].includes(value.importance)
      ? value.importance
      : "",
  };
}

export function parseIntent(request, currency = "USD") {
  const originalRequest = clean(request, 1000);
  const candidates = SUPPORTED_SERVICES.filter((service) =>
    service.aliases.some((alias) => contains(originalRequest, alias)),
  );
  const from = candidates.filter((service) =>
    service.aliases.some((alias) => contains(originalRequest, `from ${alias}`)),
  );
  const selected =
    from.length === 1
      ? from[0]
      : candidates.length === 1
        ? candidates[0]
        : null;
  const draft = normalizeJourneyDraft(
    { originalRequest, serviceId: selected?.id },
    currency,
  );
  draft.motivation = /expensive|cost|cheaper|save money|afford|price/i.test(
    originalRequest,
  )
    ? "cost"
    : /rarely|never use|don.t use|unused/i.test(originalRequest)
      ? "unused"
      : /simpler|complicated|complex|easy/i.test(originalRequest)
        ? "complexity"
        : "explore";
  const money = originalRequest.match(
    /(?:\b(USD|EUR|GBP|CHF)\s*|([$€£])\s*)(\d+(?:[.,]\d{1,2})?)/i,
  );
  const tail = originalRequest.match(
    /(\d+(?:[.,]\d{1,2})?)\s*(USD|EUR|GBP|CHF)\b/i,
  );
  if (money || tail) {
    draft.amountMinor = minor(
      Math.round(
        Number(String(money?.[3] || tail?.[1]).replace(",", ".")) * 100,
      ),
    );
    draft.currency =
      money?.[1]?.toUpperCase() ||
      { $: "USD", "€": "EUR", "£": "GBP" }[money?.[2]] ||
      tail?.[2]?.toUpperCase() ||
      currency;
    draft.currencyExplicit = true;
  }
  if (/per year|a year|annual|yearly|\/year/i.test(originalRequest))
    draft.cycle = "yearly";
  else if (/per week|weekly|\/week/i.test(originalRequest))
    draft.cycle = "weekly";
  else if (/quarterly|per quarter/i.test(originalRequest))
    draft.cycle = "quarterly";
  for (const [code, pattern] of [
    ["CH", /\b(switzerland|swiss)\b/i],
    ["US", /\b(united states|usa|in the us)\b/i],
    ["GB", /\b(united kingdom|in the uk|britain)\b/i],
    ["DE", /\bgermany\b/i],
    ["FR", /\bfrance\b/i],
  ]) {
    if (pattern.test(originalRequest)) draft.country = code;
  }
  for (const [id, pattern] of [
    ["web", /\bbrowser|\bweb app/i],
    ["macos", /\bmac(os)?\b/i],
    ["windows", /\bwindows\b/i],
    ["ios", /\biphone|\bipad/i],
    ["android", /\bandroid/i],
  ])
    if (pattern.test(originalRequest)) draft.platform = id;
  const phrases = {
    social_graphics: /social (media )?(posts|graphics)|instagram posts/i,
    presentations: /presentations|slides/i,
    templates: /templates/i,
    background_removal: /background remov/i,
    team_collaboration: /team collaboration|collaborate/i,
    psd_import_export: /\bpsd\b/i,
    offline_desktop: /offline/i,
    general_writing: /writing/i,
    coding_chat: /coding|code help/i,
    document_analysis: /documents|pdf analysis/i,
    photo_backup: /photo backup/i,
    file_sharing: /share files|file sharing/i,
  };
  for (const [id] of requirementsForProductType(draft.productType)) {
    if (phrases[id]?.test(originalRequest)) draft.tasks.push(id);
  }
  const clauses = originalRequest.split(/[.,;]|\bbut\b/i);
  for (const clause of clauses) {
    for (const [id] of requirementsForProductType(draft.productType)) {
      if (!phrases[id]?.test(clause)) continue;
      if (/don.t need|do not need|without needing|no need/i.test(clause)) {
        draft.notNeeded.push(id);
        draft.tasks = draft.tasks.filter((x) => x !== id);
      } else if (/must|need|require/i.test(clause)) draft.mustHave.push(id);
    }
  }
  if (/work alone|just me|only me|on my own|\bsolo\b/i.test(originalRequest))
    draft.audience = "solo";
  else if (/for (my |our |a )?team|with my team/i.test(originalRequest))
    draft.audience = "team";
  if (/every day|daily/i.test(originalRequest)) draft.usage = "daily";
  else if (/never use|don.t use/i.test(originalRequest)) draft.usage = "never";
  draft.budgetCurrency = draft.currency;
  return {
    draft: normalizeJourneyDraft(draft, currency),
    candidates: selected
      ? []
      : candidates.map(({ id, name }) => ({ id, name })),
    parser: "supported-service-rules-v1",
  };
}

export function changeJourneyService(draft, serviceId, productType = "") {
  const selectedType = serviceById(serviceId)?.productType || productType;
  const changed = draft.productType !== selectedType;
  return normalizeJourneyDraft(
    {
      ...draft,
      serviceId,
      productType: selectedType,
      ...(changed
        ? {
            tasks: [],
            mustHave: [],
            niceToHave: [],
            notNeeded: [],
            context: null,
            acceptAds: null,
          }
        : {}),
    },
    draft.currency,
  );
}

export function journeyFromSubscription(subscription, currency = "USD") {
  const service = supportedServiceFor(subscription);
  const review = subscription.detailedReview || {};
  return normalizeJourneyDraft(
    {
      originalRequest: `Review ${subscription.name}`,
      serviceId: service?.id,
      serviceName: subscription.name,
      productType: review.productType,
      amountMinor: subscription.amountMinor,
      currency: subscription.currency,
      currencyExplicit: true,
      cycle: subscription.cycle,
      usage: subscription.usage,
      importance: subscription.importance,
      country: review.country,
      platform: review.platform,
      mustHave: review.mustHaveRequirements,
      niceToHave: review.niceToHaveRequirements,
      notNeeded: review.notNeededRequirements,
      audience:
        review.householdUse === true
          ? "household"
          : review.householdUse === false
            ? "solo"
            : "",
      switchingTolerance: {
        easy: "easy",
        manageable: "moderate",
        difficult: "easy",
      }[review.switchingDifficulty],
      context: review,
      includeFree: review.considerFree,
      includePaid: review.considerCheaper,
      acceptAds: review.acceptAds,
      acceptFreeLimits: review.acceptFreeLimits,
    },
    currency,
  );
}

export function journeyQuery(
  value,
  marketCurrency,
  { freeOnly = false, easierOnly = false, limit = 3 } = {},
) {
  const draft = normalizeJourneyDraft(value, marketCurrency);
  const context = draft.context || {};
  const mustHave = [...draft.mustHave];
  const teamRequirement = requirementsForProductType(draft.productType)
    .map(([id]) => id)
    .find((id) => ["team_collaboration", "collaboration"].includes(id));
  if (
    draft.audience === "team" &&
    teamRequirement &&
    !mustHave.includes(teamRequirement)
  )
    mustHave.push(teamRequirement);
  return {
    serviceId: draft.serviceId,
    productType: draft.productType,
    marketCurrency,
    country: draft.country,
    platform: draft.platform,
    mustHave,
    niceToHave: [...new Set([...draft.tasks, ...draft.niceToHave])].filter(
      (id) => !mustHave.includes(id) && !draft.notNeeded.includes(id),
    ),
    notNeeded: draft.notNeeded,
    includeFree: freeOnly ? true : draft.includeFree,
    includePaid: freeOnly ? false : draft.includePaid,
    acceptAds: mustHave.includes("ad_free") ? false : draft.acceptAds,
    acceptFreeLimits: draft.acceptFreeLimits,
    budgetMinor: draft.budgetMinor,
    budgetCurrency: draft.budgetCurrency,
    switchingTolerance: draft.switchingTolerance,
    storageRequiredGb: context.storageRequiredGb,
    requiredTitle: context.requiredTitle,
    requiredGame: context.requiredGame,
    requiredServerCountry: context.requiredServerCountry,
    targetLanguage: context.targetLanguage,
    learnerLevel: context.learnerLevel,
    specificSubject: context.specificSubject,
    easierOnly,
    limit,
  };
}

export function readJourneyDraft(storage) {
  try {
    const value = JSON.parse(storage.getItem(DRAFT_KEY));
    return value?.version === 1 ? normalizeJourneyDraft(value) : null;
  } catch {
    return null;
  }
}
export function journeySubmission(value) {
  const draft = normalizeJourneyDraft(value);
  // Preserve private free-text notes in the original browser record only.
  if (draft.context) draft.context = { ...draft.context, neededFeatures: "" };
  return draft;
}
export function writeJourneyDraft(storage, draft) {
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(normalizeJourneyDraft(draft)));
    return true;
  } catch {
    return false;
  }
}
