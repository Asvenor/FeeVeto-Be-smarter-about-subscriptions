import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initializeJourney } from '../js/journey.js';
import { initializeExperience } from '../js/experience.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 2));
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('The saved-audit navigation did not settle');
}
const assessment = () => ({ title: 'Private test account assessment', fitLabel: 'Review before renewal',
  reasons: ['A test account reason'], currentAnnualMinor: 20400, currency: 'CHF',
  alternatives: { state: 'no_matches', items: [], message: 'No test comparisons' },
  nextStep: 'Check the current plan', assessedAt: '2026-09-01T12:00:00Z',
  version: 'test-only', rankingVersion: 'test-only', assumptions: [], missing: [] });

async function setup({ unknownService = false, holdOpen = false, holdSave = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://feeveto.test/#saved-audits' });
  const root = dom.window.document, originals = new Map(), calls = [], errors = [];
  const clerk = { user: { id: 'alice' }, session: { getToken: async () => 'test-session' }, openSignIn() {} };
  let currency = 'USD', releaseOpen, releaseSave, versions = 1;
  const saved = { auditId: 'audit-one', version: 1, createdAt: '2026-09-01T12:00:00Z',
    draft: { serviceId: unknownService ? '' : 'canva', serviceName: unknownService ? 'Custom subscription' : 'Canva',
      originalRequest: unknownService ? 'My custom subscription' : 'Canva is expensive', amountMinor: 1700, currency: 'CHF',
      mustHave: unknownService ? [] : ['templates'] }, assessment: assessment() };
  const fetchImplementation = async (url, options = {}) => {
    const request = new URL(url, dom.window.location.href);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: request.pathname, query: request.search, body });
    if (request.pathname === '/api/audits' && options.method === 'POST') {
      if (holdSave) await new Promise(resolve => { releaseSave = resolve; });
      versions++;
      return Response.json({ saved: { ...saved, version: versions, draft: body.draft } });
    }
    if (request.pathname === '/api/audits' && request.searchParams.has('id')) {
      if (holdOpen) await new Promise(resolve => { releaseOpen = resolve; });
      return Response.json({ versions: [saved], nextBefore: null });
    }
    if (request.pathname === '/api/audits') return Response.json({ audits: [{ audit_id: 'audit-one', title: 'Test saved audit', versions, updated_at: saved.createdAt }], nextOffset: null });
    if (request.pathname === '/api/alternatives/recommendations') return Response.json({ state: 'no_matches', accessScope: 'public', items: [], message: 'No test suggestions' });
    if (request.pathname === '/api/assessment') return Response.json({ assessment: assessment() });
    throw new Error(`Unexpected request in journey navigation test: ${request.pathname}`);
  };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.addEventListener('error', event => errors.push(event.error));
  const context = { window: dom.window, document: root, Option: dom.window.Option,
    FormData: dom.window.FormData, CustomEvent: dom.window.CustomEvent, fetch: fetchImplementation };
  for (const [name, value] of Object.entries(context)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  initializeExperience(root);
  const journey = initializeJourney({ getClerk: async () => clerk, getCurrency: () => currency, storage: dom.window.localStorage });
  const byId = id => root.getElementById(id);
  await waitFor(() => byId('saved-audit-list').querySelector('button'));
  return { dom, root, byId, journey, calls, clerk, errors,
    setCurrency(value) { currency = value; root.dispatchEvent(new dom.window.CustomEvent('feeveto:currency-change')); },
    get openHeld() { return Boolean(releaseOpen); },
    get saveHeld() { return Boolean(releaseSave); },
    releaseOpen() { releaseOpen?.(); }, releaseSave() { releaseSave?.(); },
    async open() {
      byId('saved-audit-list').querySelector('button').click();
      await waitFor(() => !byId('personal-audit').hidden && root.body.dataset.activeView === 'review');
    },
    async close() {
      releaseOpen?.(); releaseSave?.();
      await tick();
      dom.window.close();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test('currency invalidation keeps an active review meaningful without retaining stale results or stealing focus', async () => {
  const environment = await setup();
  try {
    await environment.open();
    const heading = environment.byId('personal-audit-title');
    heading.focus();
    environment.setCurrency('EUR');
    assert.equal(environment.byId('personal-audit-content').textContent, '');
    assert.equal(environment.byId('personal-audit').hidden, false, 'Active review must not become a blank wrapper');
    assert.equal(environment.root.body.dataset.activeView, 'review');
    assert.equal(environment.root.activeElement, heading);
    assert.equal(environment.byId('retry-assessment').hidden, false);
    assert.match(environment.byId('assessment-status').textContent, /review|refresh/i);
    assert.equal(environment.journey.getDraft().amountMinor, 1700);
    assert.equal(environment.journey.getDraft().currency, 'CHF');
  } finally { await environment.close(); }
});

test('changing then closing the guide retains answers and a meaningful review, not an empty page', async () => {
  const environment = await setup();
  try {
    await environment.open();
    environment.byId('edit-assessment').click();
    const price = environment.byId('guided-form').elements.price;
    price.value = '25';
    price.dispatchEvent(new environment.dom.window.Event('change', { bubbles: true }));
    environment.byId('guide-close').click();
    assert.equal(environment.byId('guided-audit').open, false);
    assert.equal(environment.journey.getDraft().amountMinor, 2500);
    assert.equal(environment.byId('personal-audit').hidden, false);
    assert.equal(environment.byId('personal-audit-content').textContent, '');
    assert.equal(environment.byId('retry-assessment').hidden, false);
  } finally { await environment.close(); }
});

test('opening saved history clears an obsolete retry action from an invalidated review', async () => {
  const environment = await setup();
  try {
    await environment.open();
    environment.setCurrency('EUR');
    assert.equal(environment.byId('retry-assessment').hidden, false);
    environment.root.querySelector('[data-view-link="saved"]').click();
    await environment.open();
    assert.equal(environment.byId('retry-assessment').hidden, true);
    assert.match(environment.byId('personal-audit-content').textContent, /Private test account assessment/);
  } finally { await environment.close(); }
});

test('a new guided assessment reveals its loading review before applying unavailable-review routing', async () => {
  const environment = await setup();
  try {
    environment.root.querySelector('[data-view-link="discover"]').click();
    environment.journey.setDraft({ serviceId: 'canva', originalRequest: 'A new Canva review' });
    assert.equal(environment.byId('personal-audit').hidden, true);
    environment.journey.openGuide();
    environment.byId('guided-form').requestSubmit();
    environment.byId('guided-form').requestSubmit();
    await waitFor(() => !environment.byId('save-assessment').hidden);
    assert.equal(environment.root.body.dataset.activeView, 'review');
    assert.equal(environment.byId('personal-audit').hidden, false);
    assert.match(environment.byId('personal-audit-content').textContent, /Private test account assessment/);
    assert.deepEqual(environment.errors, []);
  } finally { await environment.close(); }
});

test('sign-out clears account assessment data immediately even for an unknown product type', async () => {
  for (const unknownService of [false, true]) {
    const environment = await setup({ unknownService });
    try {
      await environment.open();
      assert.match(environment.byId('personal-audit-content').textContent, /Private test account assessment/);
      environment.clerk.user = null;
      environment.clerk.session = null;
      environment.root.dispatchEvent(new environment.dom.window.CustomEvent('feeveto:access-change'));
      assert.equal(environment.byId('personal-audit-content').textContent, '', 'No previous account assessment can remain after sign-out');
      assert.equal(environment.byId('personal-audit').hidden, false, 'A cleared active review must still explain what happened');
      assert.equal(environment.byId('saved-audit-history').textContent, '');
      assert.equal(environment.byId('saved-audit-list').textContent, '');
    } finally { await environment.close(); }
  }
});

test('a slow saved-audit open cannot drag the user back after navigation or overwrite a newer draft', async () => {
  for (const change of ['navigation', 'draft']) {
    const environment = await setup({ holdOpen: true });
    try {
      environment.byId('saved-audit-list').querySelector('button').click();
      await waitFor(() => environment.openHeld);
      if (change === 'navigation') environment.root.querySelector('[data-view-link="audit"]').click();
      else environment.journey.setDraft({ serviceId: 'dropbox', originalRequest: 'My newer Dropbox request' });
      const active = environment.root.body.dataset.activeView;
      const focused = environment.root.activeElement;
      const draft = structuredClone(environment.journey.getDraft());
      environment.releaseOpen();
      await tick(); await tick();
      assert.equal(environment.root.body.dataset.activeView, active, 'A late read must not navigate the user');
      assert.equal(environment.root.activeElement, focused, 'A late read must not steal focus');
      assert.deepEqual(environment.journey.getDraft(), draft);
      assert.equal(environment.byId('personal-audit-content').textContent, '');
    } finally { await environment.close(); }
  }
});

test('a completed save refreshes Saved audits but does not overwrite a newer draft or navigate back', async () => {
  for (const changeDraft of [false, true]) {
    const environment = await setup({ holdSave: true });
    try {
      await environment.open();
      environment.byId('reevaluate-assessment').click();
      await waitFor(() => environment.saveHeld);
      if (changeDraft) environment.journey.setDraft({ serviceId: 'dropbox', originalRequest: 'A different audit now' });
      environment.root.querySelector('[data-view-link="audit"]').click();
      const focused = environment.root.activeElement;
      environment.releaseSave();
      await waitFor(() => environment.byId('saved-audit-list').textContent.includes('2 dated assessments'));
      assert.equal(environment.journey.getDraft().serviceId, changeDraft ? 'dropbox' : 'canva');
      assert.equal(environment.root.body.dataset.activeView, 'audit');
      assert.equal(environment.root.activeElement, focused);
      assert.equal(environment.calls.filter(call => call.path === '/api/audits' && call.body).length, 1);
      assert.deepEqual(environment.errors, []);
    } finally { await environment.close(); }
  }
});

test('a save completing while the guide was opened does not close it or steal its focus', async () => {
  const environment = await setup({ holdSave: true });
  try {
    await environment.open();
    environment.byId('reevaluate-assessment').click();
    await waitFor(() => environment.saveHeld);
    environment.byId('edit-assessment').click();
    const focused = environment.root.activeElement;
    environment.releaseSave();
    await waitFor(() => environment.byId('saved-audit-list').textContent.includes('2 dated assessments'));
    assert.equal(environment.byId('guided-audit').open, true);
    assert.equal(environment.root.activeElement, focused);
    assert.deepEqual(environment.errors, []);
  } finally { await environment.close(); }
});
