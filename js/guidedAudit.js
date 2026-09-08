import { element } from "./render.js";
import { CURRENCY_OPTIONS, BILLING_CYCLES, USAGE_OPTIONS } from "./config.js";
import { toMinorUnits } from "./calculations.js";
import { requirementsForProductType, serviceById } from "./serviceCatalog.js";
import { normalizeJourneyDraft } from "./journeyModel.js";
import { productEvent } from './analytics.js';

export function captureGuide(formData, value, stage) {
  const draft = normalizeJourneyDraft(value);
  if (stage === 1) {
    const price = String(formData.get("price") || "").trim();
    const unknown = formData.get("unknownPrice") === "on" || !price;
    const amount = unknown ? null : toMinorUnits(price);
    if (!unknown && amount === null)
      throw new Error("Enter a valid price, or choose Not sure.");
    return normalizeJourneyDraft({
      ...draft,
      amountMinor: amount,
      currency: formData.get("currency"),
      currencyExplicit: true,
      cycle: formData.get("cycle"),
    });
  }
  const rawBudget = String(formData.get("budget") || "").trim();
  const budget = rawBudget ? toMinorUnits(rawBudget) : null;
  if (rawBudget && budget === null)
    throw new Error("Enter a valid monthly budget, or leave it unanswered.");
  const mustHave = [],
    niceToHave = [],
    notNeeded = [];
  for (const [id] of requirementsForProductType(draft.productType)) {
    const value = formData.get(`priority_${id}`);
    if (value === "must") mustHave.push(id);
    if (value === "nice") niceToHave.push(id);
    if (value === "not_needed") notNeeded.push(id);
  }
  const nullableChoice = name => formData.get(name) === 'yes' ? true : formData.get(name) === 'no' ? false : null;
  const ads = formData.has('acceptAds') ? nullableChoice('acceptAds') : draft.acceptAds;
  if (ads === true) {
    const index = mustHave.indexOf('ad_free'); if (index >= 0) mustHave.splice(index, 1);
  }
  const alternatives = formData.get('alternativeTypes');
  const context = { ...draft.context, productType: draft.productType };
  if (formData.has('storageRequiredGb')) {
    const rawStorage = String(formData.get('storageRequiredGb') || '').trim();
    if (rawStorage && (!Number.isFinite(Number(rawStorage)) || Number(rawStorage) < 0 || Number(rawStorage) > 100000)) throw new Error('Enter a storage amount between 0 and 100,000 GB, or leave it unanswered.');
    context.storageRequiredGb = rawStorage ? Number(rawStorage) : null;
  }
  if (formData.has('requiredTitle')) context.requiredTitle = String(formData.get('requiredTitle') || '').trim();
  return normalizeJourneyDraft({
    ...draft,
    tasks: formData.has('unifiedPriorities') ? [] : formData.getAll("task"),
    mustHave,
    niceToHave,
    notNeeded,
    usage: formData.get("usage"),
    audience: formData.get("audience"),
    budgetMinor: budget,
    budgetCurrency: formData.get("budgetCurrency"),
    switchingTolerance: formData.get("switchingTolerance"),
    importance: formData.get('importance') ?? draft.importance,
    userType: formData.get('userType') ?? draft.userType,
    country: formData.get('country') ?? draft.country,
    platform: formData.get('platform') ?? draft.platform,
    acceptAds: ads,
    acceptFreeLimits: formData.has('acceptFreeLimits') ? nullableChoice('acceptFreeLimits') : draft.acceptFreeLimits,
    includeFree: alternatives === null || alternatives === 'previous' ? draft.includeFree : alternatives === 'paid' ? false : ['free', 'both'].includes(alternatives) ? true : null,
    includePaid: alternatives === null || alternatives === 'previous' ? draft.includePaid : alternatives === 'free' ? false : ['paid', 'both'].includes(alternatives) ? true : null,
    context,
  });
}

function select(name, options, value, labelText) {
  const label = element("label", "field", labelText);
  const input = element("select");
  input.name = name;
  for (const [id, text] of options) input.append(new Option(text, id));
  input.value = value || "";
  label.append(input);
  return label;
}
function question(title, id, choices, value, multiple = false) {
  const group = element("fieldset", "guide-question");
  group.dataset.question = id;
  group.append(element("legend", "", title));
  const options = element("div", "choice-grid");
  for (const [key, text] of choices) {
    const label = element("label", "choice-card");
    const input = element("input");
    input.type = multiple ? "checkbox" : "radio";
    input.name = id;
    input.value = key;
    input.checked = multiple ? (value || []).includes(key) : key === value;
    label.append(input, element("span", "", text));
    options.append(label);
  }
  group.append(options);
  return group;
}
function progressiveQuestion(group, answered) {
  if (!answered) return group;
  const wrapper = element("details", "prefilled-question");
  wrapper.append(
    element(
      "summary",
      "",
      `${group.querySelector("legend").textContent} · answer already added, change`,
    ),
    group,
  );
  return wrapper;
}

export function initializeGuidedAudit({ getDraft, onChange, onComplete }) {
  const dialog = document.getElementById("guided-audit");
  const form = document.getElementById("guided-form");
  const contents = document.getElementById("guide-content");
  const title = document.getElementById("guide-title");
  const progress = document.getElementById("guide-progress");
  const back = document.getElementById("guide-back");
  const next = document.getElementById("guide-next");
  const error = document.getElementById("guide-error");
  let stage = 1;
  let returnFocus;

  function capture() {
    try {
      onChange(captureGuide(new FormData(form), getDraft(), stage));
      error.textContent = "";
      return true;
    } catch (caught) {
      error.textContent = caught.message;
      error.focus();
      return false;
    }
  }
  function draw() {
    const draft = getDraft();
    contents.replaceChildren();
    error.textContent = "";
    progress.textContent = `Step ${stage} of 2 · ${serviceById(draft.serviceId)?.name || "Your subscription"}`;
    title.textContent =
      stage === 1 ? "What do you pay now?" : "What do you actually need?";
    back.hidden = stage === 1;
    next.textContent = stage === 1 ? "Continue to my needs" : "See my best fit";
    if (stage === 1) {
      contents.append(
        element(
          "p",
          "guide-intro",
          "Your own bill is the best starting point. Unsure? You can still review the fit without a savings estimate.",
        ),
      );
      const label = element(
        "label",
        "field guide-price-label",
        "Current subscription price",
      );
      const price = element("input", "guide-price");
      price.name = "price";
      price.type = "number";
      price.min = "0";
      price.max = "9999999.99";
      price.step = ".01";
      price.inputMode = "decimal";
      price.placeholder = "0.00";
      price.value =
        draft.amountMinor === null ? "" : (draft.amountMinor / 100).toFixed(2);
      label.append(price);
      contents.append(label);
      const grid = element("div", "form-section-grid");
      grid.append(
        select(
          "currency",
          CURRENCY_OPTIONS,
          draft.currency,
          "Billing currency",
        ),
        question("Billing period", "cycle", BILLING_CYCLES.filter(([id]) => ['monthly', 'yearly', draft.cycle].includes(id)), draft.cycle),
      );
      contents.append(grid);
      const unknown = element("label", "choice-card");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.name = "unknownPrice";
      checkbox.checked = draft.amountMinor === null;
      unknown.append(checkbox, element("span", "", "Not sure about the price"));
      contents.append(unknown);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) price.value = "";
      });
      price.addEventListener("input", () => {
        checkbox.checked = false;
      });
    } else {
      contents.append(
        element(
          "p",
          "guide-intro",
          "Up to six quick questions. Leave anything unanswered; you can come back and change it.",
        ),
      );
      const requirements = requirementsForProductType(draft.productType);
      if (requirements.length) {
        const priorities = element("fieldset", "guide-question");
        priorities.dataset.question = "priorities";
        priorities.append(
          element("legend", "", "What do you use it for—and need to keep?"),
        );
        priorities.append(
          element(
            "p",
            "field-help",
            "Must-have features affect eligibility. Nice-to-have features help sort your options.",
          ),
        );
        for (const [id, label] of requirements.filter(
          ([id]) => !["team_collaboration", "collaboration", "ad_free"].includes(id),
        )) {
          const value = draft.mustHave.includes(id)
            ? "must"
            : draft.niceToHave.includes(id) || draft.tasks.includes(id)
              ? "nice"
              : draft.notNeeded.includes(id)
                ? "not_needed"
                : "";
          const row = question(
            label, `priority_${id}`,
            [
              ["", "Unanswered"],
              ["must", "Must have"],
              ["nice", "Nice to have"],
              ["not_needed", "Not needed"],
            ],
            value,
          );
          row.classList.add("requirement-row");
          delete row.dataset.question;
          priorities.append(row);
        }
        // Collaboration is asked once in the audience question. Preserve an old
        // explicit priority until the person changes that audience answer.
        for (const id of ["team_collaboration", "collaboration", "ad_free"]) {
          if (!requirements.some(([key]) => key === id)) continue;
          const hidden = element("input");
          hidden.type = "hidden";
          hidden.name = `priority_${id}`;
          hidden.value = draft.mustHave.includes(id)
            ? "must"
            : draft.niceToHave.includes(id)
              ? "nice"
              : draft.notNeeded.includes(id)
                ? "not_needed"
                : "";
          priorities.append(hidden);
        }
        contents.append(
          progressiveQuestion(
            priorities,
            draft.mustHave.length +
              draft.niceToHave.length +
              draft.notNeeded.length,
          ),
        );
        const unified = element('input'); unified.type = 'hidden'; unified.name = 'unifiedPriorities'; unified.value = 'true'; contents.append(unified);
      }
      contents.append(
        progressiveQuestion(
          question(
            "How often do you use it?",
            "usage",
            [
              ["", "Not sure"],
              ...USAGE_OPTIONS.filter(([id]) =>
                ["daily", "weekly", "monthly", "never"].includes(id),
              ),
              ...USAGE_OPTIONS.filter(
                ([id]) =>
                  id === draft.usage &&
                  !["daily", "weekly", "monthly", "never"].includes(id),
              ),
            ],
            draft.usage,
          ),
          draft.usage,
        ),
      );
      contents.append(progressiveQuestion(question('How important is it to you?', 'importance', [['', 'Not sure'], ['not_important', 'Not important'], ['nice_to_have', 'Nice to have'], ['useful', 'Useful'], ['important', 'Important'], ['essential', 'Essential']], draft.importance), draft.importance));
      const audience = question(
        "Who is it for?",
        "audience",
        [
          ["", "Not sure"],
          ["solo", "Just me"],
          ["team", "A team working together"],
          ["household", "My household"],
        ],
        draft.audience,
      );
      audience.addEventListener("change", () => {
        for (const hidden of contents.querySelectorAll(
          'input[type="hidden"][name="priority_collaboration"], input[type="hidden"][name="priority_team_collaboration"]',
        ))
          hidden.value = "";
      });
      contents.append(progressiveQuestion(audience, draft.audience));
      const budget = element("fieldset", "guide-question");
      budget.dataset.question = "budget";
      budget.append(
        element("legend", "", "What would you like to spend each month?"),
      );
      const budgetLabel = element(
        "label",
        "field",
        "Monthly budget · optional",
      );
      const amount = element("input");
      amount.name = "budget";
      amount.type = "number";
      amount.min = "0";
      amount.max = "9999999.99";
      amount.step = ".01";
      amount.inputMode = "decimal";
      amount.placeholder = "No fixed budget";
      amount.value =
        draft.budgetMinor === null ? "" : (draft.budgetMinor / 100).toFixed(2);
      budgetLabel.append(amount);
      budget.append(
        budgetLabel,
        select(
          "budgetCurrency",
          CURRENCY_OPTIONS,
          draft.budgetCurrency,
          "Budget currency",
        ),
        element(
          "p",
          "field-help",
          "An annual plan is compared by its monthly equivalent, with its full commitment shown. Other currencies remain unconfirmed.",
        ),
      );
      const alternativesValue = draft.includeFree === true && draft.includePaid === false ? 'free' : draft.includePaid === true && draft.includeFree === false ? 'paid' : draft.includeFree === true && draft.includePaid === true ? 'both' : draft.includeFree === null && draft.includePaid === null ? '' : 'previous';
      const alternativeChoices = [['', 'Not sure'], ['both', 'Free or paid'], ['free', 'Only free plans'], ['paid', 'Paid options']];
      if (alternativesValue === 'previous') alternativeChoices.push(['previous', 'Keep my saved preference']);
      contents.append(question('What alternatives would you consider?', 'alternativeTypes', alternativeChoices, alternativesValue));
      contents.append(
        progressiveQuestion(
          question(
            "How much effort would you accept to switch?",
            "switchingTolerance",
            [
              ["", "Not sure"],
              ["easy", "Only a simple switch"],
              ["moderate", "Some setup is fine"],
              ["any", "I can handle a bigger change"],
            ],
            draft.switchingTolerance,
          ),
          draft.switchingTolerance,
        ),
      );
      const extra = element('details', 'guide-extra');
      extra.append(element('summary', '', 'Refine compatibility · optional'), budget);
      extra.append(select('userType', [['', 'Unanswered'], ['personal', 'Personal'], ['student', 'Student'], ['creator', 'Creator'], ['freelancer', 'Freelancer'], ['professional', 'Professional']], draft.userType, 'How do you use it?'));
      extra.append(element('p', 'field-help', 'Your role is context, not proof that an alternative supports your work. Select the features you actually need above.'));
      const platforms = [['', 'Unanswered'], ['web', 'Web browser'], ['windows', 'Windows'], ['macos', 'Mac'], ['linux', 'Linux'], ['ios', 'iPhone / iPad'], ['android', 'Android'], ['smart_tv', 'Smart TV'], ['game_console', 'Game console']].filter(([id]) => !['smart_tv', 'game_console'].includes(id) || ['streaming_video', 'music_streaming', 'home_workouts', 'game_catalogue'].includes(draft.productType) || id === draft.platform);
      extra.append(select('platform', platforms, draft.platform, 'Required platform'));
      const countryLabel = element('label', 'field', 'Country · two-letter code');
      const country = element('input'); country.name = 'country'; country.maxLength = 2; country.pattern = '[A-Za-z]{2}'; country.autocomplete = 'country'; country.value = draft.country;
      country.addEventListener('input', () => { country.value = country.value.toUpperCase(); }); countryLabel.append(country); extra.append(countryLabel);
      if (['streaming_video', 'music_streaming'].includes(draft.productType)) {
        extra.append(question('Would you accept advertisements?', 'acceptAds', [['', 'Unanswered'], ['yes', 'Yes'], ['no', 'No']], draft.mustHave.includes('ad_free') ? 'no' : draft.acceptAds === null ? '' : draft.acceptAds ? 'yes' : 'no'));
      }
      if (draft.productType === 'streaming_video') {
        const label = element('label', 'field', 'Any shows or films you must keep?');
        const input = element('input'); input.name = 'requiredTitle'; input.maxLength = 80; input.value = draft.context?.requiredTitle || ''; label.append(input); extra.append(label, element('p', 'field-help', 'Libraries differ. A specific title stays unconfirmed until its availability is verified.'));
      }
      if (draft.productType === 'cloud_storage') {
        const label = element('label', 'field', 'How much storage do you need? (GB)');
        const input = element('input'); input.name = 'storageRequiredGb'; input.type = 'number'; input.min = '0'; input.max = '100000'; input.step = 'any'; input.value = draft.context?.storageRequiredGb ?? ''; label.append(input); extra.append(label);
      }
      extra.append(question('Would you accept free-plan usage limits?', 'acceptFreeLimits', [['', 'Unanswered'], ['yes', 'Yes'], ['no', 'No']], draft.acceptFreeLimits === null ? '' : draft.acceptFreeLimits ? 'yes' : 'no'));
      contents.append(extra);
    }
    title.focus();
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      const invalid = form.querySelector('input:invalid, select:invalid, textarea:invalid');
      for (let parent = invalid?.parentElement; parent && parent !== form; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
      invalid?.reportValidity(); invalid?.focus();
      return;
    }
    if (!capture()) return;
    if (stage === 1) {
      stage = 2;
      draw();
    } else {
      dialog.close();
      returnFocus?.focus();
      void onComplete();
    }
  });
  back.addEventListener("click", () => {
    if (capture()) {
      stage = 1;
      draw();
    }
  });
  document.getElementById("guide-close").addEventListener("click", () => {
    capture();
    dialog.close();
    returnFocus?.focus();
  });
  dialog.addEventListener("cancel", () => {
    capture();
  });
  form.addEventListener("change", () => {
    capture();
  });
  return {
    open() {
      if (dialog.open) return;
      void productEvent('advanced_audit_started', { serviceId: getDraft().serviceId, intent: getDraft().motivation, surface: 'advanced' });
      returnFocus = document.activeElement;
      stage = 1;
      draw();
      dialog.showModal();
      title.focus();
    },
    close() {
      if (dialog.open) {
        capture();
        dialog.close();
      }
    },
  };
}
