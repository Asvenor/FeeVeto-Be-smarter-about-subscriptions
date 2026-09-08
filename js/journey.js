import {
  SUPPORTED_SERVICES,
  PRODUCT_TYPES,
  serviceById,
} from "./serviceCatalog.js";
import { element, alternativeCard } from "./render.js";
import {
  parseIntent,
  normalizeJourneyDraft,
  changeJourneyService,
  journeyQuery,
  readJourneyDraft,
  writeJourneyDraft,
  MOTIVATIONS,
} from "./journeyModel.js";
import {
  requestJourneyAlternatives,
  journeyRequest,
  journeySession,
} from "./journeyApi.js";
import { AlternativeRequestTracker } from "./alternativeProvider.js";
import { initializeGuidedAudit } from "./guidedAudit.js";
import { renderAssessment } from "./assessmentView.js";
import { initializeSavedAudits } from "./savedAudits.js";
import { initializeSubscriptionAccountSave } from "./subscriptionAccountSave.js";
import { openDisclosures, revealContent } from "./experience.js";

export function initializeJourney({ getClerk, getCurrency, storage }) {
  const byId = (id) => document.getElementById(id);
  const searchForm = byId("intent-form");
  if (!searchForm) return null;
  let draft =
    readJourneyDraft(storage) || normalizeJourneyDraft({}, getCurrency());
  let result = null;
  let lastCurrency = getCurrency();
  let busy = false;
  let filter = "all";
  let limit = 3;
  let abort;
  let assessment = null;
  let assessmentRevision = 0;
  let account;
  const requests = new AlternativeRequestTracker();
  const correction = byId("intent-correction");
  const results = byId("instant-results");
  const status = byId("intent-status");
  const serviceSelect = byId("intent-service");
  const typeSelect = byId("intent-type");
  const motivation = byId("intent-motivation");
  serviceSelect.replaceChildren(new Option("Choose a service", ""));
  for (const service of SUPPORTED_SERVICES)
    serviceSelect.append(new Option(service.name, service.id));
  typeSelect.replaceChildren(new Option("Choose a product type", ""));
  for (const [id, label] of PRODUCT_TYPES)
    typeSelect.append(new Option(label, id));
  for (const [id, label] of MOTIVATIONS)
    motivation.append(new Option(label, id));
  byId("intent-input").value = draft.originalRequest;
  const guide = initializeGuidedAudit({
    getDraft: () => draft,
    onChange(value) {
      if (JSON.stringify(value) !== JSON.stringify(draft)) {
        invalidateAssessment();
        account?.draftChanged();
      }
      draft = value;
      persist();
    },
    onComplete: () => runAssessment(),
  });
  byId("personalize-results").addEventListener("click", () => guide.open());
  byId("edit-assessment").addEventListener("click", () => guide.open());
  byId("retry-assessment").addEventListener(
    "click",
    () => void runAssessment(),
  );
  let tabStorage;
  try {
    tabStorage = window.sessionStorage;
  } catch {}
  account = initializeSavedAudits({
    getClerk,
    getValue: () => ({ draft, assessment, marketCurrency: getCurrency() }),
    sessionStorage: tabStorage,
    onPending() {
      byId("personal-audit").hidden = false;
      byId("assessment-status").textContent =
        "Your save request and completed answers are kept.";
    },
    onOpen(value) {
      guide.close();
      draft = normalizeJourneyDraft(value.draft);
      persist();
      showUnderstood();
      byId("intent-input").value = draft.originalRequest;
      assessmentRevision++;
      assessment = value.assessment;
      byId("personal-audit").hidden = false;
      if (assessment)
        renderAssessment(byId("personal-audit-content"), assessment);
      else
        byId("personal-audit-content").replaceChildren(
          element("p", "", value.message),
        );
      byId("assessment-status").textContent =
        "Historical assessment. Use Reevaluate to check current information and save a new dated result.";
      byId("retry-assessment").hidden = true;
      account.hideSave();
      revealContent("personal-audit");
      byId("personal-audit-title").focus();
    },
  });

  const subscriptionAccount = initializeSubscriptionAccountSave({
    getClerk, getCurrency, storage: tabStorage, onSaved: () => account.loadList(),
  });

  function invalidateAssessment(message = 'Your answers changed. Refresh this review when you are ready; your answers are kept.') {
    assessmentRevision++;
    assessment = null;
    account?.invalidatePresentation();
    // Clear previous account data immediately, but leave an active review with a
    // useful next action. Hiding only its child would strand the user in a blank view.
    const activeReview = document.body.dataset.activeView === 'review';
    byId("personal-audit").hidden = !activeReview;
    byId("personal-audit-content").replaceChildren();
    account?.hideSave();
    byId("retry-assessment").hidden = !activeReview;
    if (activeReview) byId("assessment-status").textContent = message;
  }
  async function runAssessment() {
    persist();
    const revision = ++assessmentRevision;
    const input = {
      draft: normalizeJourneyDraft(draft),
      marketCurrency: getCurrency(),
    };
    byId("personal-audit").hidden = false;
    byId("personal-audit-content").replaceChildren();
    byId("assessment-status").textContent =
      "Reviewing your answers and checked options…";
    byId("retry-assessment").hidden = true;
    revealContent("personal-audit");
    const navigationRevision = document.body.dataset.viewRevision;
    try {
      const { token } = await journeySession(getClerk);
      const value = await journeyRequest("assessment", { token, body: input });
      if (revision !== assessmentRevision) return;
      assessment = value.assessment;
      renderAssessment(byId("personal-audit-content"), assessment);
      account.assessmentReady();
      byId("assessment-status").textContent =
        "Your personal assessment is ready. It has not been saved to an account yet.";
      byId("retry-assessment").hidden = ![
        "catalogue_unavailable",
        "request_failed",
      ].includes(assessment.alternatives.state);
    } catch (error) {
      if (revision !== assessmentRevision) return;
      byId("assessment-status").textContent = error.message;
      byId("retry-assessment").hidden = false;
    }
    if (revision === assessmentRevision && navigationRevision === document.body.dataset.viewRevision) {
      byId("personal-audit").scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      byId("personal-audit-title").focus({ preventScroll: true });
    }
  }

  function persist() {
    if (!writeJourneyDraft(storage, draft))
      byId("journey-storage-status").textContent =
        "Your answers are available in this tab, but could not be saved on this device.";
  }
  function showUnderstood() {
    byId("discover").hidden = false;
    correction.hidden = false;
    serviceSelect.value = draft.serviceId;
    typeSelect.value = draft.productType;
    motivation.value = draft.motivation;
    byId("intent-country").value = draft.country;
    byId("intent-platform").value = draft.platform;
    byId("intent-original").textContent = draft.originalRequest
      ? `Your request: “${draft.originalRequest}”`
      : "Choose the service or type you want to review.";
    byId("personalize-results").hidden = !draft.productType;
    byId("intent-market").textContent = draft.country
      ? `Availability uses your country: ${draft.country}. Prices keep their original currency.`
      : `No country selected. ${getCurrency()} supplies a starting market; enter your country for a more precise check.`;
  }
  function renderResult() {
    results.replaceChildren();
    results.setAttribute("aria-busy", String(busy));
    byId("intent-retry").hidden = busy || !result?.error;
    byId("intent-more").hidden = busy || !result?.hasMore;
    byId("intent-filters").hidden = !draft.productType;
    for (const button of byId("intent-filters").querySelectorAll("button"))
      button.setAttribute(
        "aria-pressed",
        String(filter === button.dataset.intentFilter),
      );
    if (busy) {
      status.textContent = "Checking the curated catalogue…";
      return;
    }
    if (!result) return;
    if (result.error) {
      status.textContent = result.message;
      return;
    }
    status.textContent = result.items.length
      ? `${result.items.length} ${result.items.length === 1 ? "suggestion" : "suggestions"} to explore. Based on limited information; confirm the trade-offs before switching.`
      : result.message;
    if (result.state === "access_restricted") {
      const link = element(
        "a",
        "button button-secondary",
        "See Premium access",
      );
      link.href = "#pricing";
      results.append(link);
      status.textContent =
        "The selected filter has no results in your current access level. Free-plan comparisons require Premium; try All options to see public suggestions.";
    }
    for (const item of result.items) {
      const card = alternativeCard(item, draft.serviceId);
      card.classList.add("instant-card");
      results.append(card);
    }
    if (result.items.length && result.items.length < 3 && !result.hasMore) {
      results.append(
        element(
          "p",
          "coverage-note",
          "This is the checked coverage available for your service, market, and access. More questions can refine it, but may not add more products.",
        ),
      );
    }
  }
  async function runSearch({ focus = false, invalidationMessage } = {}) {
    if (focus) revealContent("discover");
    const navigationRevision = document.body.dataset.viewRevision;
    invalidateAssessment(invalidationMessage);
    showUnderstood();
    persist();
    requests.invalidateAll();
    abort?.abort();
    const request = requests.begin("search");
    if (!draft.productType) {
      result = {
        items: [],
        state: "unsupported",
        message:
          "Choose the service or a product type above. We cannot identify a reliable match from this request yet.",
      };
      busy = false;
      renderResult();
      if (focus) { openDisclosures(serviceSelect); serviceSelect.focus(); }
      return;
    }
    busy = true;
    result = null;
    renderResult();
    const controller = new AbortController();
    abort = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    const query = journeyQuery(draft, getCurrency(), {
      freeOnly: filter === "free",
      easierOnly: filter === "easy",
      limit,
    });
    try {
      const { token } = await journeySession(getClerk);
      const next = await requestJourneyAlternatives(query, token, {
        signal: controller.signal,
      });
      if (!requests.isCurrent("search", request)) return;
      result = next;
    } catch (error) {
      if (!requests.isCurrent("search", request)) return;
      result = {
        error: true,
        state: error.resultState || "request_failed",
        items: [],
        message:
          error.name === "AbortError"
            ? "This search took too long. Your request and answers are kept; try again."
            : error.message ||
              "Suggestions could not be loaded. Your answers are kept; try again.",
      };
    } finally {
      clearTimeout(timer);
      if (requests.isCurrent("search", request)) {
        busy = false;
        renderResult();
      }
    }
    if (focus && navigationRevision === document.body.dataset.viewRevision) {
      byId("discover").scrollIntoView({ behavior: "smooth", block: "start" });
      status.focus({ preventScroll: true });
    }
  }
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId("intent-input");
    if (!input.value.trim()) {
      input.setCustomValidity("Describe what you would like to change.");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    const parsed = parseIntent(input.value, getCurrency());
    account.draftChanged({ newAudit: true });
    draft = parsed.draft;
    limit = 3;
    filter = "all";
    if (parsed.candidates.length > 1) {
      requests.invalidateAll();
      abort?.abort();
      busy = false;
      result = null;
      showUnderstood();
      persist();
      renderResult();
      status.textContent = `Which subscription are you replacing: ${parsed.candidates.map((x) => x.name).join(" or ")}? Choose it above.`;
      revealContent("discover");
      openDisclosures(serviceSelect);
      serviceSelect.focus();
      return;
    }
    void runSearch({ focus: true });
  });
  byId("intent-input").addEventListener("input", (event) =>
    event.target.setCustomValidity(""),
  );
  for (const button of document.querySelectorAll("[data-example-intent]"))
    button.addEventListener("click", () => {
      byId("intent-input").value = button.dataset.exampleIntent;
      searchForm.requestSubmit();
    });
  serviceSelect.addEventListener("change", () => {
    account.draftChanged();
    draft = changeJourneyService(draft, serviceSelect.value, typeSelect.value);
    limit = 3;
    void runSearch();
  });
  typeSelect.addEventListener("change", () => {
    account.draftChanged();
    draft = changeJourneyService(draft, "", typeSelect.value);
    limit = 3;
    void runSearch();
  });
  correction.addEventListener("submit", (event) => {
    event.preventDefault();
    const country = byId("intent-country");
    country.value = country.value.trim().toUpperCase();
    if (!country.checkValidity()) {
      country.reportValidity();
      return;
    }
    draft = normalizeJourneyDraft(
      {
        ...draft,
        motivation: motivation.value,
        country: country.value,
        platform: byId("intent-platform").value,
      },
      getCurrency(),
    );
    account.draftChanged();
    limit = 3;
    void runSearch();
  });
  byId("intent-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-intent-filter]");
    if (!button) return;
    filter = button.dataset.intentFilter;
    limit = 3;
    void runSearch();
  });
  byId("intent-retry").addEventListener("click", () => void runSearch());
  byId("intent-more").addEventListener("click", () => {
    limit = 12;
    void runSearch();
  });
  document.addEventListener("feeveto:currency-change", () => {
    if (lastCurrency === getCurrency()) return;
    lastCurrency = getCurrency();
    if (draft.amountMinor === null && !draft.currencyExplicit)
      draft.currency = lastCurrency;
    if (draft.budgetMinor === null) draft.budgetCurrency = lastCurrency;
    const invalidationMessage = 'Display currency changed. Refresh this review for the new starting market. Your answers and original billing currency are kept.';
    if (draft.originalRequest || draft.productType) void runSearch({ invalidationMessage });
    else invalidateAssessment(invalidationMessage);
  });
  document.addEventListener("feeveto:access-change", () => {
    requests.invalidateAll();
    abort?.abort();
    busy = false;
    result = null;
    results.replaceChildren();
    const invalidationMessage = 'Account access changed. Earlier results were cleared. Refresh this review to check the information available to this account.';
    if (draft.productType) void runSearch({ invalidationMessage });
    else invalidateAssessment(invalidationMessage);
  });
  if (draft.originalRequest || draft.productType) showUnderstood();
  return {
    saveSubscription: (item) => subscriptionAccount.save(item),
    getDraft: () => draft,
    setDraft(value) {
      guide.close();
      account.draftChanged({ newAudit: true });
      invalidateAssessment();
      draft = normalizeJourneyDraft(value, getCurrency());
      byId("intent-input").value = draft.originalRequest;
      showUnderstood();
      persist();
    },
    runSearch,
    openGuide: () => guide.open(),
  };
}
