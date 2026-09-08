import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { emptyState, loadState, normalizeSubscription, saveState } from '../js/storage.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
let importVersion = 0;
const tick = () => new Promise(resolve => setTimeout(resolve, 2));
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('The connected subscription form did not settle');
}

const savedCanva = () => normalizeSubscription({
  id: 'existing-canva-entry', name: 'Canva', amountMinor: 1700, currency: 'CHF',
  cycle: 'monthly', category: 'software', usage: 'weekly', importance: 'useful',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
  detailedReview: { serviceId: 'canva', serviceSelectionConfirmed: true,
    productType: 'graphic_design', country: 'CH', platform: 'web',
    mustHaveRequirements: ['templates'], acceptFreeLimits: false,
    activeContract: true, neededFeatures: 'Private note for the local entry' },
});

async function setup({ subscriptions = [], alternativesFail = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://feeveto.test/#audit' });
  const root = dom.window.document, calls = [], errors = [], originals = new Map();
  let failAlternatives = alternativesFail;
  // Exercise the real application handlers, not a browser visual or external-service test.
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.addEventListener('error', event => errors.push(event.error));
  const fetchImplementation = async (url, options = {}) => {
    const path = new URL(url, dom.window.location.href).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body, options });
    if (path === '/api/billing/plans') return Response.json({ available: false, mode: 'test' });
    if (path === '/api/alternatives/recommendations') {
      if (failAlternatives) return Response.json({ state: 'catalogue_unavailable', error: 'Catalogue unavailable. Your subscription is saved; retry alternatives.' }, { status: 503 });
      return Response.json({ accessScope: 'public', state: 'general_suggestions', missingDetails: [], items: [{
        productName: 'Fictional design alternative', planName: 'Test fixture',
        pricingModel: 'paid', pricingLabel: 'Check pricing', matchStatus: 'general',
        matchLabel: 'General suggestion', whyMatches: 'A fictional response used only by this test.',
        price: { amountMinor: null, currency: null }, officialUrl: 'https://example.com/fictional-design',
      }] });
    }
    throw new Error(`Unexpected request in guest form test: ${path}`);
  };
  dom.window.fetch = fetchImplementation;
  const context = { window: dom.window, document: root, Option: dom.window.Option,
    FormData: dom.window.FormData, CustomEvent: dom.window.CustomEvent,
    CSS: dom.window.CSS || { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`) },
    fetch: fetchImplementation, __FEEVETO_CLERK_PUBLISHABLE_KEY__: '' };
  for (const [name, value] of Object.entries(context)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const state = emptyState('USD');
  state.subscriptions = subscriptions;
  saveState(dom.window.localStorage, state);
  const byId = id => root.getElementById(id);
  const change = (id, value, event = 'change') => {
    const input = byId(id) || byId('subscription-form').elements[id];
    assert.ok(input, `The requested input ${id} exists`);
    input.value = value;
    input.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  };
  async function close() {
    await tick();
    dom.window.close(); // Also clears the application's toast and announcer window timers.
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  try {
    await import(`../js/app.js?experience-entry-test=${++importVersion}`);
    await tick();
  } catch (error) { await close(); throw error; }
  return { dom, root, byId, change, calls, errors, close,
    stored: () => loadState(dom.window.localStorage).state,
    setAlternativesFail: value => { failAlternatives = value; },
    card: () => byId('subscription-list').querySelector('.subscription-card'),
  };
}

function enterCanva(environment, { price = '17', country = 'CH' } = {}) {
  const { byId, change } = environment;
  byId('show-entry').click();
  change('name', 'Canva', 'input');
  change('price', price, 'input');
  assert.equal(byId('service-id').value, 'canva');
  byId('needs-disclosure').open = true;
  change('alternative-country', country);
  change('alternative-platform', 'web');
  change('requirement_templates', 'must');
  byId('needs-disclosure').open = false;
}

async function submitAndWait(environment) {
  environment.byId('subscription-form').requestSubmit();
  await waitFor(() => environment.card() && !environment.byId('submit-button').disabled &&
    environment.card().querySelector('[data-action="alternatives"]')?.disabled === false);
}

test('one-session entry saves collapsed matching answers, focuses its result, and edits the same record without duplicates', async () => {
  const environment = await setup();
  const { byId, root } = environment;
  try {
    enterCanva(environment);
    assert.equal(byId('requirement-questions').querySelector('[name="requirement_templates"]').disabled, false);
    await submitAndWait(environment);
    const original = environment.stored().subscriptions[0];
    assert.equal(environment.stored().subscriptions.length, 1);
    assert.equal(original.name, 'Canva');
    assert.equal(original.amountMinor, 1700);
    assert.equal(original.detailedReview.country, 'CH');
    assert.deepEqual(original.detailedReview.mustHaveRequirements, ['templates']);
    assert.equal(original.detailedReview.acceptFreeLimits, null, 'Unanswered is not saved as No');
    assert.equal(root.body.dataset.activeView, 'audit');
    assert.equal(root.activeElement, environment.card());
    assert.match(byId('subscription-save-status').textContent, /this browser only/);
    assert.match(environment.card().textContent, /Fictional design alternative/);
    const request = environment.calls.find(call => call.path === '/api/alternatives/recommendations');
    assert.equal(request.body.country, 'CH');
    assert.deepEqual(request.body.mustHave, ['templates']);
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(environment.calls.some(call => call.path === '/api/audits'), false, 'Guests must not upload account audits');

    environment.card().querySelector('[data-action="edit"]').click();
    assert.equal(byId('subscription-editor').open, true);
    assert.equal(root.activeElement, byId('name'));
    assert.equal(byId('subscription-form').elements.subscriptionId.value, original.id);
    assert.equal(byId('subscription-form').elements.requirement_templates.value, 'must');
    environment.change('price', '19.50', 'input');
    byId('needs-disclosure').open = false;
    await submitAndWait(environment);
    const updated = environment.stored().subscriptions;
    assert.equal(updated.length, 1);
    assert.equal(updated[0].id, original.id);
    assert.equal(updated[0].createdAt, original.createdAt);
    assert.equal(updated[0].amountMinor, 1950);
    assert.deepEqual(updated[0].detailedReview.mustHaveRequirements, ['templates']);
    assert.deepEqual(environment.errors, []);
  } finally { await environment.close(); }
});

test('existing CHF answers survive Edit, view changes and global currency changes; Cancel does not save the draft', async () => {
  const environment = await setup({ subscriptions: [savedCanva()] });
  const { byId, root } = environment;
  try {
    const original = environment.stored().subscriptions;
    environment.card().querySelector('[data-action="edit"]').click();
    const form = byId('subscription-form');
    assert.equal(form.elements.currency.value, 'CHF');
    assert.equal(form.elements.country.value, 'CH');
    assert.equal(form.elements.requirement_templates.value, 'must');
    assert.equal(form.elements.neededFeatures.value, 'Private note for the local entry');
    assert.equal(form.querySelector('[name="acceptFreeLimits"][value="false"]').checked, true);
    environment.change('price', '23.50', 'input');
    root.querySelector('[data-view-link="discover"]').click();
    environment.change('currency-preference', 'EUR');
    root.querySelector('[data-view-link="saved"]').click();
    root.querySelector('[data-view-link="audit"]').click();
    assert.equal(byId('subscription-form'), form);
    assert.equal(form.elements.price.value, '23.50');
    assert.equal(form.elements.currency.value, 'CHF');
    assert.equal(form.elements.country.value, 'CH');
    assert.equal(form.elements.requirement_templates.value, 'must');
    assert.equal(form.elements.subscriptionId.value, original[0].id);
    assert.deepEqual(environment.stored().subscriptions, original);
    byId('cancel-edit').click();
    assert.deepEqual(environment.stored().subscriptions, original);
    assert.equal(form.elements.subscriptionId.value, '');
    assert.equal(form.elements.currency.value, 'EUR');

    enterCanva(environment, { price: '31.25', country: 'DE' });
    environment.change('currency-preference', 'GBP');
    assert.equal(form.elements.price.value, '31.25');
    assert.equal(form.elements.currency.value, 'EUR', 'An unfinished amount must not be relabelled by the global preference');
    assert.equal(form.elements.country.value, 'DE');
    assert.equal(form.elements.requirement_templates.value, 'must');
    assert.deepEqual(environment.stored().subscriptions, original);
    assert.deepEqual(environment.errors, []);
  } finally { await environment.close(); }
});

test('invalid optional country opens its collapsed section, focuses the error and preserves the unsaved answers', async () => {
  const environment = await setup();
  const { byId, root } = environment;
  try {
    enterCanva(environment, { country: 'X' });
    assert.equal(byId('needs-disclosure').open, false);
    byId('subscription-form').requestSubmit();
    await tick();
    assert.equal(byId('needs-disclosure').open, true);
    assert.equal(root.activeElement, byId('alternative-country'));
    assert.equal(byId('alternative-country').getAttribute('aria-invalid'), 'true');
    assert.match(byId('country-error').textContent, /two-letter country/);
    assert.equal(byId('price').value, '17');
    assert.equal(byId('subscription-form').elements.requirement_templates.value, 'must');
    assert.equal(environment.stored().subscriptions.length, 0);
    assert.equal(environment.calls.some(call => call.path === '/api/alternatives/recommendations'), false);
    assert.deepEqual(environment.errors, []);
  } finally { await environment.close(); }
});

test('failed alternatives retain the saved answers and Retry uses the same record and structured query', async () => {
  const environment = await setup({ alternativesFail: true });
  const { byId } = environment;
  try {
    enterCanva(environment);
    await submitAndWait(environment);
    const original = environment.stored().subscriptions;
    const retry = environment.card().querySelector('[data-action="alternatives"]');
    assert.equal(retry.textContent, 'Retry alternatives');
    assert.match(environment.card().textContent, /Catalogue unavailable/);
    assert.equal(original.length, 1);
    assert.equal(original[0].detailedReview.country, 'CH');
    assert.deepEqual(original[0].detailedReview.mustHaveRequirements, ['templates']);
    environment.setAlternativesFail(false);
    retry.click();
    await waitFor(() => environment.card()?.querySelector('.alternative-card'));
    assert.match(environment.card().textContent, /Fictional design alternative/);
    assert.deepEqual(environment.stored().subscriptions, original);
    const requests = environment.calls.filter(call => call.path === '/api/alternatives/recommendations');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].body, requests[0].body);
    assert.equal(byId('subscription-list').querySelectorAll('.subscription-card').length, 1);
    assert.equal(environment.root.body.dataset.activeView, 'audit');
    assert.deepEqual(environment.errors, []);
  } finally { await environment.close(); }
});
