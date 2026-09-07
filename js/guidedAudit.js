import { element } from "./render.js";
import { CURRENCY_OPTIONS, BILLING_CYCLES, USAGE_OPTIONS } from "./config.js";
import { toMinorUnits } from "./calculations.js";
import { requirementsForProductType, serviceById } from "./serviceCatalog.js";
import { normalizeJourneyDraft } from "./journeyModel.js";

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
  return normalizeJourneyDraft({
    ...draft,
    tasks: formData.getAll("task"),
    mustHave,
    niceToHave,
    notNeeded,
    usage: formData.get("usage"),
    audience: formData.get("audience"),
    budgetMinor: budget,
    budgetCurrency: formData.get("budgetCurrency"),
    switchingTolerance: formData.get("switchingTolerance"),
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
        select("cycle", BILLING_CYCLES, draft.cycle, "Billing period"),
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
        contents.append(
          progressiveQuestion(
            question(
              "What do you mainly use it for?",
              "task",
              requirements.filter(
                ([id]) =>
                  !["team_collaboration", "collaboration", "ad_free"].includes(
                    id,
                  ),
              ),
              draft.tasks,
              true,
            ),
            draft.tasks.length,
          ),
        );
        const priorities = element("fieldset", "guide-question");
        priorities.dataset.question = "priorities";
        priorities.append(
          element("legend", "", "Which features would you keep?"),
        );
        priorities.append(
          element(
            "p",
            "field-help",
            "Must-have features affect eligibility. Nice-to-have features help sort your options.",
          ),
        );
        for (const [id, label] of requirements.filter(
          ([id]) => !["team_collaboration", "collaboration"].includes(id),
        )) {
          const value = draft.mustHave.includes(id)
            ? "must"
            : draft.niceToHave.includes(id)
              ? "nice"
              : draft.notNeeded.includes(id)
                ? "not_needed"
                : "";
          const row = select(
            `priority_${id}`,
            [
              ["", "Unanswered"],
              ["must", "Must have"],
              ["nice", "Nice to have"],
              ["not_needed", "Not needed"],
            ],
            value,
            label,
          );
          row.classList.add("requirement-row");
          priorities.append(row);
        }
        // Collaboration is asked once in the audience question. Preserve an old
        // explicit priority until the person changes that audience answer.
        for (const id of ["team_collaboration", "collaboration"]) {
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
          'input[type="hidden"][name^="priority_"]',
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
      contents.append(progressiveQuestion(budget, draft.budgetMinor !== null));
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
    }
    title.focus();
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity() || !capture()) return;
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
