import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { initializeJourney } from "../js/journey.js";
import { handleRecommendationsRequest } from "../functions/api/alternatives/recommendations.js";
import { handleAssessmentRequest } from "../functions/api/assessment.js";
import { handleAuditsRequest } from "../functions/api/audits.js";
import { curatedRecommendations } from "../functions/_shared/catalogue-provider.js";
import { testDatabase } from "./helpers/sqlite-d1.js";
import { PENDING_SAVE_KEY } from "../js/savedAudits.js";
import { SUBSCRIPTION_SAVE_KEY } from "../js/subscriptionAccountSave.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/catalogue.example.json", import.meta.url),
  ),
).offers[0];
const waitFor = async (predicate) => {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("Timed out waiting for DOM state");
};
async function setup({ pending = null, user = null, subscriptionPending = null, clerkGate = null } = {}) {
  const dom = new JSDOM(html, { url: "https://app.test/" }),
    database = await testDatabase(),
    original = {};
  for (const name of [
    "window",
    "document",
    "Option",
    "FormData",
    "CustomEvent",
  ]) {
    original[name] = globalThis[name];
    globalThis[name] = dom.window[name];
  }
  original.fetch = globalThis.fetch;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  // DOM tests exercise handlers and focus; these shims are not a visual browser test.
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const errors = [];
  dom.window.addEventListener("error", (event) => errors.push(event.error));
  const clerk = {
    user: user ? { id: user } : null,
    session: user ? { getToken: async () => "verified-test-session" } : null,
    openSignIn() {
      this.signIns = (this.signIns || 0) + 1;
    },
  };
  const offers = [
    {
      ...fixture,
      priceMinor: 1000,
      priceCurrency: "USD",
      billingInterval: "monthly",
      priceVerifiedAt: "2026-09-06",
      switchingDifficulty: "easy",
    },
  ];
  const options = {
    identityResolver: async () =>
      clerk.user
        ? { userId: clerk.user.id, user: { privateMetadata: {} } }
        : null,
    paidAccessResolver: async () => false,
    provider: (context, query, access) =>
      curatedRecommendations(context, query, access, {
        load: async () => offers,
      }),
  };
  const calls = [];
  let failSave = false,
    failAlternatives = false;
  globalThis.fetch = async (url, init) => {
    const request = new Request(new URL(url, "https://app.test/"), init);
    calls.push({
      path: new URL(request.url).pathname,
      body: init?.body ? JSON.parse(init.body) : null,
    });
    const context = { request, env: { FEEVETO_BILLING: database } };
    if (request.url.includes("/api/alternatives/")) {
      if (failAlternatives)
        return Response.json(
          {
            state: "catalogue_unavailable",
            error: "Catalogue unavailable. Retry.",
          },
          { status: 503 },
        );
      return handleRecommendationsRequest(context, {
        catalogueLoader: async () => offers,
        accessResolver: async () => ({
          authenticated: !!clerk.user,
          premiumAccess: false,
        }),
      });
    }
    if (request.url.includes("/api/assessment"))
      return handleAssessmentRequest(context, options);
    if (failSave && request.method === "POST")
      return Response.json({ error: "Storage unavailable" }, { status: 503 });
    return handleAuditsRequest(context, options);
  };
  dom.window.localStorage.setItem(
    "feeveto_state_v2",
    "legacy-data-do-not-touch",
  );
  if (pending)
    dom.window.sessionStorage.setItem(
      PENDING_SAVE_KEY,
      JSON.stringify(pending),
    );
  if (subscriptionPending) dom.window.sessionStorage.setItem(SUBSCRIPTION_SAVE_KEY, JSON.stringify(subscriptionPending));
  const journey = initializeJourney({
    getClerk: async () => clerkGate || clerk,
    ...(clerkGate ? {getSearchClerk:()=>null} : {}),
    getCurrency: () => "USD",
    storage: dom.window.localStorage,
  });
  const byId = (id) => dom.window.document.getElementById(id);
  const change = (selector, value) => {
    let input = dom.window.document.querySelector(
      selector.startsWith("[name=") ? `#guided-form ${selector}` : selector,
    );
    if (input.type === 'radio') {
      input = [...dom.window.document.querySelectorAll(`#guided-form input[name="${input.name}"]`)].find(item => item.value === value);
      input.checked = true;
    } else if (input.type === "checkbox") input.checked = value;
    else input.value = value;
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  return {
    dom,
    database,
    clerk,
    calls,
    journey,
    byId,
    change,
    errors,
    setFailSave: (value) => (failSave = value),
    setFailAlternatives: (value) => (failAlternatives = value),
    async cleanup() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      database.close();
      dom.window.close();
      for (const [name, value] of Object.entries(original))
        globalThis[name] = value;
    },
  };
}

const browserEntry = () => ({
  id: 'browser-canva-12345678', name: 'Canva', amountMinor: 1700,
  currency: 'CHF', cycle: 'monthly', usage: 'weekly', importance: 'useful',
  detailedReview: { serviceId: 'canva', productType: 'graphic_design',
    country: 'CH', mustHaveRequirements: ['templates'], acceptAds: false,
    acceptFreeLimits: null, activeContract: true, neededFeatures: 'PRIVATE NOTE STAYS LOCAL' },
});

test('subscription save enters account list immediately; edits append to one audit and reload lists it', async () => {
  const env = await setup({ user: 'alice' });
  try {
    await waitFor(() => env.byId('saved-audits-status').textContent.includes('Nothing saved to your account yet'));
    const item = browserEntry();
    await env.journey.saveSubscription(item);
    assert.match(env.byId('subscription-save-status').textContent, /Saved to your account and this browser/);
    assert.equal(env.byId('saved-audit-list').children.length, 1);
    const first = env.calls.find((call) => call.path === '/api/audits' && call.body);
    assert.equal(first.body.sourceSubscriptionId, item.id);
    assert.equal(first.body.draft.currency, 'CHF');
    assert.equal(first.body.draft.country, 'CH');
    assert.equal(first.body.draft.acceptAds, false);
    assert.equal(first.body.draft.acceptFreeLimits, null);
    assert.equal(first.body.draft.context.neededFeatures, '');
    assert.equal(item.detailedReview.neededFeatures, 'PRIVATE NOTE STAYS LOCAL');
    await env.journey.saveSubscription({ ...item, amountMinor: 1900 });
    assert.equal(env.byId('saved-audit-list').children.length, 1);
    assert.match(env.byId('saved-audit-list').textContent, /2 dated assessments/);
    document.dispatchEvent(new CustomEvent('feeveto:access-change'));
    await waitFor(() => env.byId('saved-audit-list').children.length === 1);
    env.byId('saved-audit-list').querySelector('button').click();
    await waitFor(() => env.byId('saved-audit-history').children.length === 2);
    assert.equal(env.journey.getDraft().amountMinor, 1900);
    assert.deepEqual(env.journey.getDraft().mustHave, ['templates']);
    assert.equal(env.dom.window.localStorage.getItem('feeveto_state_v2'), 'legacy-data-do-not-touch');
    assert.equal(env.dom.window.sessionStorage.getItem(SUBSCRIPTION_SAVE_KEY), null);
    assert.deepEqual(env.errors, []);
  } finally { await env.cleanup(); }
});

test('guest form save stays local; signing in never bulk uploads old entries', async () => {
  const env = await setup();
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await env.journey.saveSubscription(browserEntry());
    assert.match(env.byId('subscription-save-status').textContent, /this browser only/);
    assert.equal(env.calls.filter((call) => call.path === '/api/audits' && call.body).length, 0);
    assert.equal(env.clerk.signIns, undefined);
    env.clerk.user = { id: 'alice' };
    env.clerk.session = { getToken: async () => 'verified-test-session' };
    document.dispatchEvent(new CustomEvent('feeveto:access-change'));
    await waitFor(() => env.byId('saved-audits-status').textContent.includes('Nothing saved to your account yet'));
    assert.equal(env.calls.filter((call) => call.path === '/api/audits' && call.body).length, 0);
  } finally { await env.cleanup(); }
});

test('failed subscription save survives refresh and retries once without leaking into another account', async () => {
  let env = await setup({ user: 'alice' });
  let pending;
  try {
    await waitFor(() => env.byId('saved-audits-status').textContent.includes('Nothing saved to your account yet'));
    env.setFailSave(true);
    await env.journey.saveSubscription(browserEntry());
    assert.match(env.byId('subscription-save-status').textContent, /account save did not finish/);
    assert.equal(env.byId('retry-subscription-save').hidden, false);
    pending = JSON.parse(env.dom.window.sessionStorage.getItem(SUBSCRIPTION_SAVE_KEY));
    assert.equal(pending.length, 1);
    assert.equal(pending[0].draft.context.neededFeatures, '');
  } finally { await env.cleanup(); }
  env = await setup({ user: 'bob', subscriptionPending: pending });
  try {
    await waitFor(() => env.byId('saved-audits-status').textContent.includes('Nothing saved to your account yet'));
    assert.equal(env.byId('retry-subscription-save').hidden, true);
    assert.equal(env.calls.filter((call) => call.body).length, 0);
    env.clerk.user = { id: 'alice' };
    document.dispatchEvent(new CustomEvent('feeveto:access-change'));
    await waitFor(() => !env.byId('retry-subscription-save').hidden);
    env.byId('retry-subscription-save').click();
    env.byId('retry-subscription-save').click();
    await waitFor(() => env.byId('subscription-save-status').textContent.includes('Saved to your account'));
    await waitFor(() => env.byId('saved-audit-list').children.length === 1);
    const calls = env.calls.filter((call) => call.path === '/api/audits' && call.body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.requestKey, pending[0].requestKey);
    assert.match(env.byId('saved-audit-list').textContent, /1 dated assessment/);
  } finally { await env.cleanup(); }
});

test("connected DOM journey: guest discovery, guide, sign-in continuity, retry, reopen, append-only reevaluation", async () => {
  const env = await setup();
  const { byId, change, clerk, dom } = env;
  try {
    byId("intent-input").value = "Canva is too expensive";
    byId("intent-form").requestSubmit();
    await waitFor(() =>
      byId("instant-results").querySelector(".alternative-card"),
    );
    assert.equal(
      clerk.signIns,
      undefined,
      "Guest sees alternatives before sign-in",
    );
    change("#intent-country", "US");
    change("#intent-platform", "web");
    byId("intent-correction").requestSubmit();
    await waitFor(
      () => !byId("intent-status").textContent.includes("Checking"),
    );
    byId("personalize-results").click();
    assert.equal(byId("guided-audit").open, true);
    change("[name=unknownPrice]", false);
    change("[name=price]", "20");
    byId("guided-form").requestSubmit();
    assert.match(byId("guide-progress").textContent, /Step 2/);
    assert.equal(
      byId("guide-content").querySelectorAll(":scope > [data-question], :scope > .prefilled-question > [data-question]").length,
      6,
    );
    change("[name=priority_templates]", "must");
    change("[name=usage][value=weekly]", "weekly");
    const usage = dom.window.document.querySelector(
      "[name=usage][value=weekly]",
    );
    usage.checked = true;
    usage.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const audience = dom.window.document.querySelector(
      "[name=audience][value=solo]",
    );
    audience.checked = true;
    audience.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    byId("guide-back").click();
    assert.match(byId("guide-progress").textContent, /Step 1/);
    assert.equal(
      Number(
        dom.window.document.querySelector("#guided-form [name=price]").value,
      ),
      20,
    );
    byId("guide-close").click();
    byId("personalize-results").click();
    byId("guided-form").requestSubmit();
    assert.equal(
      dom.window.document.querySelector("[name=priority_templates]:checked").value,
      "must",
    );
    byId("guided-form").requestSubmit();
    await waitFor(() => !byId("save-assessment").hidden);
    assert.match(byId("personal-audit-content").textContent, /annual savings/);
    byId("save-assessment").click();
    await waitFor(() => clerk.signIns === 1);
    assert.ok(dom.window.sessionStorage.getItem(PENDING_SAVE_KEY));
    env.setFailSave(true);
    clerk.user = { id: "alice" };
    clerk.session = { getToken: async () => "verified-test-session" };
    document.dispatchEvent(new CustomEvent("feeveto:access-change"));
    await waitFor(() =>
      byId("save-status").textContent.includes("Storage unavailable"),
    );
    assert.equal(
      byId("personal-audit").hidden,
      false,
      "Save failures stay visible after the auth refresh",
    );
    assert.equal(
      byId("save-assessment").hidden,
      false,
      "Retry must be visible, not only programmatically clickable",
    );
    env.setFailSave(false);
    byId("save-assessment").click();
    await waitFor(() => byId("saved-audit-list").querySelector("button"));
    const saves = env.calls.filter(
      (call) => call.path === "/api/audits" && call.body,
    );
    assert.equal(
      saves[0].body.requestKey,
      saves[1].body.requestKey,
      "Retry keeps the idempotency key",
    );
    assert.equal(dom.window.sessionStorage.getItem(PENDING_SAVE_KEY), null);
    byId("saved-audit-list").querySelector("button").click();
    await waitFor(() => byId("saved-audit-history").children.length === 1);
    byId("reevaluate-assessment").click();
    await waitFor(() =>
      byId("saved-audit-list").textContent.includes("2 dated assessments"),
    );
    assert.equal(
      dom.window.localStorage.getItem("feeveto_state_v2"),
      "legacy-data-do-not-touch",
    );
    assert.doesNotMatch(
      dom.window.localStorage.getItem("feeveto_journey_draft_v1"),
      /sourceUrls|assessment_json|selectedOfferId/,
    );
    clerk.user = null;
    clerk.session = null;
    document.dispatchEvent(new CustomEvent("feeveto:access-change"));
    assert.equal(
      byId("personal-audit-content").textContent,
      "",
      "Account results are removed immediately on access change",
    );
    assert.equal(byId("saved-audit-list").textContent, "");
    assert.deepEqual(env.errors, []);
  } finally {
    await env.cleanup();
  }
});

test("a completed pending save resumes after a page reload without reopening the questionnaire", async () => {
  const env = await setup({
    user: "alice",
    pending: {
      draft: {
        serviceId: "canva",
        amountMinor: 2000,
        currency: "EUR",
        mustHave: ["templates"],
      },
      marketCurrency: "EUR",
      requestKey: crypto.randomUUID(),
      auditId: "",
      expectedOwner: "",
    },
  });
  try {
    await waitFor(() => env.byId("saved-audit-list").querySelector("button"));
    assert.equal(env.journey.getDraft().amountMinor, 2000);
    assert.equal(env.journey.getDraft().currency, "EUR");
    assert.equal(env.byId("guided-audit").open, false);
    assert.equal(env.dom.window.sessionStorage.getItem(PENDING_SAVE_KEY), null);
    assert.deepEqual(env.errors, []);
  } finally {
    await env.cleanup();
  }
});

test("an earlier slow search cannot overwrite a later intent", async () => {
  const env = await setup();
  try {
    let requests = 0, resolveFirst,
      started = false;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.serviceId === "canva") {
        requests++;
        started = true;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Response.json({
        state: "no_matches",
        items: [],
        message: "Latest Dropbox result",
      });
    };
    env.byId("intent-input").value = "Canva is expensive";
    env.byId("intent-form").requestSubmit();
    await waitFor(() => started);
    env.byId("intent-form").requestSubmit();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(requests,1,'Repeated pending submit does not duplicate the search');
    env.byId("intent-input").value = "Dropbox is expensive";
    env.byId("intent-form").requestSubmit();
    await waitFor(
      () => env.byId("intent-status").textContent === "Latest Dropbox result",
    );
    resolveFirst(
      Response.json({
        state: "no_matches",
        items: [],
        message: "Old Canva result",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      env.byId("intent-status").textContent,
      "Latest Dropbox result",
    );
    assert.equal(env.journey.getDraft().serviceId, "dropbox");
  } finally {
    await env.cleanup();
  }
});

test('guest discovery does not wait for account initialization', async () => {
  let release;
  const clerkGate = new Promise(resolve => {release=resolve});
  const env=await setup({clerkGate});
  try {
    env.byId('intent-input').value='Canva costs too much'; env.byId('intent-form').requestSubmit();
    await waitFor(()=>env.byId('instant-results').querySelector('.alternative-card'));
    assert.ok(env.calls.some(call=>call.path==='/api/alternatives/recommendations'));
    assert.equal(env.byId('guided-audit').open,false);
  } finally {release(env.clerk);await new Promise(resolve=>setImmediate(resolve));await env.cleanup();}
});

test('correcting free intent synchronizes price filters without clearing country-only preferences', async () => {
  const env = await setup();
  try {
    env.byId('intent-input').value = 'A free alternative to Canva';
    env.byId('intent-form').requestSubmit();
    await waitFor(() => env.byId('intent-form').getAttribute('aria-busy') === 'false');
    const latestQuery = () => env.calls.filter(call => call.path === '/api/alternatives/recommendations').at(-1).body;
    assert.equal(latestQuery().includePaid, false);
    env.byId('intent-motivation').value = 'cost';
    env.byId('intent-correction').requestSubmit();
    await waitFor(() => env.byId('instant-results').querySelector('.alternative-card'));
    assert.equal(latestQuery().includePaid, null);
    assert.equal(env.byId('intent-filters').querySelector('[data-intent-filter="all"]').getAttribute('aria-pressed'), 'true');
    env.byId('intent-motivation').value = 'free';
    env.byId('intent-correction').requestSubmit();
    await waitFor(() => env.byId('intent-form').getAttribute('aria-busy') === 'false');
    assert.equal(latestQuery().includePaid, false);
    assert.equal(latestQuery().includeFree, true);
    assert.equal(env.byId('intent-filters').querySelector('[data-intent-filter="free"]').getAttribute('aria-pressed'), 'true');
    env.byId('intent-country').value = 'CH';
    env.byId('intent-correction').requestSubmit();
    await waitFor(() => env.byId('intent-form').getAttribute('aria-busy') === 'false');
    assert.equal(latestQuery().country, 'CH');
    assert.equal(latestQuery().includePaid, false);
    assert.equal(env.journey.getDraft().originalRequest, 'A free alternative to Canva');
    assert.deepEqual(env.errors, []);
  } finally { await env.cleanup(); }
});

test("failed alternatives preserve intent; retry and service correction work without a questionnaire", async () => {
  const env = await setup();
  try {
    env.setFailAlternatives(true);
    env.byId("intent-input").value = "Canva is expensive";
    env.byId("intent-form").requestSubmit();
    await waitFor(() => !env.byId("intent-retry").hidden);
    assert.equal(env.journey.getDraft().originalRequest, "Canva is expensive");
    env.setFailAlternatives(false);
    env.byId("intent-retry").click();
    await waitFor(() =>
      env.byId("instant-results").querySelector(".alternative-card"),
    );
    env.journey.setDraft({
      ...env.journey.getDraft(),
      mustHave: ["templates"],
    });
    env.change("#intent-service", "dropbox");
    assert.equal(env.journey.getDraft().productType, "cloud_storage");
    assert.deepEqual(env.journey.getDraft().mustHave, []);
    await waitFor(
      () =>
        env.byId("intent-status").textContent.includes("No") ||
        !env.byId("intent-status").textContent.includes("Checking"),
    );
    assert.deepEqual(env.errors, []);
  } finally {
    await env.cleanup();
  }
});
