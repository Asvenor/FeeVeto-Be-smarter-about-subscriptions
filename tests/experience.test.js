import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initializeExperience, openDisclosures, revealContent } from '../js/experience.js';

const fixture = `<!doctype html><html><body>
  <nav aria-label="Primary navigation">
    <a id="discover-link" href="#top" data-view-link="discover">Discover</a>
    <a id="audit-link" href="#audit" data-view-link="audit"><span>My subscriptions</span></a>
    <a id="saved-link" href="#saved-audits" data-view-link="saved">Saved audits</a>
    <a id="pricing-link" href="#pricing">Premium</a>
    <a id="help-link" href="#faq">Help</a>
  </nav>
  <main id="top">
    <section class="experience-view" data-view="discover">
      <h1 id="hero-title">Find what fits</h1>
      <form id="intent-form"><label>Request <input id="intent-input" value="Canva is expensive"></label></form>
      <section id="discover"><h2>Suggestions</h2></section>
      <section id="how-it-works"><h2>How it works</h2></section>
    </section>
    <section class="experience-view" data-view="audit" hidden>
      <section id="audit"><h2 id="audit-title">My subscriptions</h2>
        <button id="show-entry" type="button">Add subscription</button>
        <details id="subscription-editor"><summary>Add a subscription</summary>
          <form id="subscription-form">
            <label>Service <input id="name" name="name" value="Canva"></label>
            <label>Price <input id="price" name="price" value="17"></label>
            <label>Currency <select id="currency" name="currency"><option>USD</option><option selected>CHF</option></select></label>
            <input name="subscriptionId" value="saved-entry" type="hidden">
            <details id="needs-details"><summary>Optional requirements</summary>
              <details id="country-details"><summary>Country</summary>
                <label>Country <input id="country" name="country" value="CH"></label>
              </details>
            </details>
          </form>
        </details>
        <section id="results"><h2 id="results-title">Your results</h2>
          <input id="result-search" value="Canva">
          <button id="active-filter" data-filter="switch" aria-pressed="true" type="button">Switch</button>
          <article id="result-card" tabindex="-1">Canva result</article>
        </section>
      </section>
    </section>
    <section class="experience-view" data-view="saved" hidden>
      <section id="saved-audits"><h2 id="saved-audits-title">Saved audits</h2></section>
    </section>
    <section class="experience-view" data-view="review" hidden>
      <a data-review-back href="#top">Back</a>
      <section id="personal-audit" hidden><h2 id="personal-audit-title">Your personal audit</h2></section>
    </section>
    <section class="experience-view" data-view="help" hidden>
      <section id="privacy"><h2>Privacy</h2></section><section id="faq"><h2>Help</h2></section>
    </section>
    <section class="experience-view" data-view="pricing" hidden>
      <section id="pricing"><h2 id="pricing-title">Premium</h2></section>
    </section>
  </main>
</body></html>`;

function setup(hash = '', { reviewReady = false } = {}) {
  const dom = new JSDOM(fixture, { url: `https://feeveto.test/${hash}` });
  const root = dom.window.document;
  if (reviewReady) root.getElementById('personal-audit').hidden = false;
  const controller = initializeExperience(root);
  const byId = id => root.getElementById(id);
  return { dom, root, controller, byId, close: () => dom.window.close() };
}

function assertView(environment, name, primary = name) {
  const { root, controller } = environment;
  assert.equal(controller.current, name);
  assert.equal(root.body.dataset.activeView, name);
  const visible = [...root.querySelectorAll('[data-view]')].filter(panel => !panel.hidden);
  assert.equal(visible.length, 1, 'Only one experience view is visible');
  assert.equal(visible[0].dataset.view, name);
  for (const link of root.querySelectorAll('[data-view-link]')) {
    assert.equal(link.getAttribute('aria-current'), link.dataset.viewLink === primary ? 'page' : null);
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('Navigation did not settle');
}

test('experience defaults to Discover and resolves each existing deep link without initial focus theft', () => {
  for (const [hash, expected] of [
    ['', 'discover'], ['#discover', 'discover'], ['#how-it-works', 'discover'],
    ['#audit', 'audit'], ['#results', 'audit'], ['#subscription-editor', 'audit'],
    ['#saved-audits', 'saved'],
    ['#privacy', 'help'], ['#faq', 'help'], ['#pricing', 'pricing'],
    ['#results%2Dtitle', 'audit'],
  ]) {
    const environment = setup(hash);
    try {
      assertView(environment, expected, expected === 'review' ? 'discover' : expected);
      assert.equal(environment.root.activeElement, environment.root.body);
      if (hash === '#subscription-editor') assert.equal(environment.byId('subscription-editor').open, true);
    } finally { environment.close(); }
  }
});

test('an initial review deep link falls back to Discover until its assessment exists', () => {
  for (const reviewReady of [false, true]) {
    const environment = setup('#personal-audit', { reviewReady });
    try {
      assertView(environment, reviewReady ? 'review' : 'discover', 'discover');
      assert.equal(environment.byId('personal-audit').hidden, !reviewReady);
      assert.equal(environment.root.activeElement, environment.root.body);
    } finally { environment.close(); }
  }
});

test('unknown or malformed initial hashes safely fall back to Discover', () => {
  for (const hash of ['#does-not-exist', '#%E0%A4%A', '#%']) {
    const environment = setup(hash);
    try { assertView(environment, 'discover'); } finally { environment.close(); }
  }
});

test('Back and later deep links cannot reopen an invalidated review or add redirect history entries', async () => {
  const environment = setup('#audit');
  const { byId, root, dom } = environment;
  try {
    byId('personal-audit').hidden = false;
    revealContent('personal-audit', root);
    byId('saved-link').click();
    byId('personal-audit').hidden = true;
    const historyLength = dom.window.history.length;
    dom.window.history.back();
    await waitFor(() => environment.controller.current === 'discover');
    assertView(environment, 'discover');
    assert.equal(dom.window.location.hash, '#top');
    assert.equal(dom.window.history.length, historyLength, 'Unavailable Back destination is replaced, not pushed');
    assert.equal(root.activeElement, byId('hero-title'));
    dom.window.history.forward();
    await waitFor(() => environment.controller.current === 'saved');
    dom.window.location.hash = '#personal-audit-title';
    await waitFor(() => environment.controller.current === 'discover');
    assertView(environment, 'discover');
    assert.equal(dom.window.location.hash, '#top');
    assert.equal(root.activeElement, byId('hero-title'));
    assert.equal(dom.window.history.length, historyLength + 1, 'The direct hash adds one entry; fallback does not add another');
  } finally { environment.close(); }
});

test('programmatic unavailable-review fallback preserves its explicit no-focus behavior', () => {
  const environment = setup('#audit');
  try {
    environment.byId('audit-link').focus();
    revealContent('personal-audit', environment.root);
    assertView(environment, 'discover');
    assert.equal(environment.root.activeElement, environment.byId('audit-link'));
    assert.equal(environment.dom.window.location.hash, '#top');
  } finally { environment.close(); }
});

test('primary links, direct hash changes, and browser back/forward update the visible view and keyboard focus', async () => {
  const environment = setup();
  const { byId, root, dom } = environment;
  try {
    byId('audit-link').querySelector('span').click();
    assertView(environment, 'audit');
    assert.equal(dom.window.location.hash, '#audit');
    assert.equal(root.activeElement, byId('audit-title'));
    byId('saved-link').click();
    assertView(environment, 'saved');
    assert.equal(root.activeElement, byId('saved-audits-title'));
    dom.window.history.back();
    await waitFor(() => environment.controller.current === 'audit');
    assertView(environment, 'audit');
    assert.equal(root.activeElement, byId('audit-title'));
    dom.window.history.forward();
    await waitFor(() => environment.controller.current === 'saved');
    assertView(environment, 'saved');
    dom.window.location.hash = '#results';
    await waitFor(() => environment.controller.current === 'audit');
    assertView(environment, 'audit');
    assert.equal(root.activeElement, byId('results-title'));
  } finally { environment.close(); }
});

test('navigation retains the original form nodes, unfinished prices, saved-entry currency, requirements and filters', () => {
  const environment = setup('#audit');
  const { byId, root } = environment;
  try {
    const form = byId('subscription-form');
    byId('name').value = 'My edited Canva';
    byId('price').value = '19.95';
    byId('country').value = 'DE';
    byId('result-search').value = 'edited';
    const before = [...new environment.dom.window.FormData(form).entries()];
    byId('discover-link').click();
    byId('saved-link').click();
    byId('audit-link').click();
    assert.equal(byId('subscription-form'), form, 'View changes must not remount the form');
    assert.deepEqual([...new environment.dom.window.FormData(form).entries()], before);
    assert.equal(byId('currency').value, 'CHF');
    assert.equal(form.elements.subscriptionId.value, 'saved-entry');
    assert.equal(byId('result-search').value, 'edited');
    assert.equal(byId('active-filter').getAttribute('aria-pressed'), 'true');
    assert.equal(root.querySelectorAll('#subscription-form').length, 1);
  } finally { environment.close(); }
});

test('revealing content chooses its owning view and opens nested disclosures without stealing focus', () => {
  const environment = setup('#audit');
  const { byId, root } = environment;
  try {
    byId('subscription-editor').open = true;
    byId('name').focus();
    revealContent('country', root);
    assertView(environment, 'audit');
    assert.equal(root.activeElement, byId('name'));
    for (const id of ['subscription-editor', 'needs-details', 'country-details']) assert.equal(byId(id).open, true);
    assert.equal(byId('country').disabled, false);
    assert.equal(byId('country').value, 'CH');
    const revision = root.body.dataset.viewRevision;
    revealContent('missing-content', root);
    assertView(environment, 'audit');
    assert.equal(root.body.dataset.viewRevision, revision);
  } finally { environment.close(); }
});

test('invalid capture opens every disclosure without disabling or clearing structured inputs', () => {
  const environment = setup('#audit');
  const { byId, dom } = environment;
  try {
    byId('subscription-editor').open = false;
    byId('country').dispatchEvent(new dom.window.Event('invalid', { bubbles: false, cancelable: true }));
    for (const id of ['subscription-editor', 'needs-details', 'country-details']) assert.equal(byId(id).open, true);
    const values = new dom.window.FormData(byId('subscription-form'));
    assert.equal(values.get('country'), 'CH');
    assert.equal(values.get('currency'), 'CHF');
    assert.equal(byId('country').disabled, false);
    byId('needs-details').open = false;
    openDisclosures(byId('country'));
    assert.equal(byId('needs-details').open, true);
    assert.doesNotThrow(() => openDisclosures(null));
  } finally { environment.close(); }
});

test('background child updates cannot reveal an inactive wrapper; review retains the originating primary view', () => {
  const environment = setup('#saved-audits');
  const { byId, root } = environment;
  try {
    byId('personal-audit').hidden = false;
    assert.equal(byId('personal-audit').closest('[data-view]').hidden, true);
    assertView(environment, 'saved');
    revealContent('personal-audit', root);
    assertView(environment, 'review', 'saved');
    const back = root.querySelector('[data-review-back]');
    assert.equal(back.getAttribute('href'), '#saved-audits');
    assert.match(back.textContent, /Saved audits/);
    back.click();
    assertView(environment, 'saved');
    assert.equal(byId('personal-audit').hidden, false, 'Routing must not override the result controller state');
    assert.equal(byId('personal-audit').closest('[data-view]').hidden, true);
  } finally { environment.close(); }
});

test('modified and non-primary clicks preserve normal browser link handling', () => {
  const environment = setup();
  const { byId, root, dom } = environment;
  try {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      let preventedByExperience;
      root.addEventListener('click', event => {
        preventedByExperience = event.defaultPrevented;
        // Do not ask JSDOM to perform external browsing; observe before suppressing its default.
        event.preventDefault();
      }, { once: true });
      byId('audit-link').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...modifier }));
      assert.equal(preventedByExperience, false);
      assertView(environment, 'discover');
      assert.equal(dom.window.location.hash, '');
    }
  } finally { environment.close(); }
});

test('Add subscription expands its editor and focuses the service name', () => {
  const environment = setup('#audit');
  try {
    environment.byId('show-entry').click();
    assertView(environment, 'audit');
    assert.equal(environment.byId('subscription-editor').open, true);
    assert.equal(environment.root.activeElement, environment.byId('name'));
    assert.equal(environment.dom.window.location.hash, '#subscription-editor');
  } finally { environment.close(); }
});
