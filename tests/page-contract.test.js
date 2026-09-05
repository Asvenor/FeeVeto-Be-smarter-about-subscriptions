import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('main page contains launch metadata and application landmarks', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const required of [
    'name="description"',
    'rel="canonical"',
    'rel="icon"',
    'id="subscription-form"',
    'id="subscription-list"',
    'id="renewal-list"',
    'id="announcer"',
    'type="module"',
    'href="./privacy.html"',
  ]) assert.ok(html.includes(required), `Missing ${required}`);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Page must not contain duplicate IDs');
  assert.doesNotMatch(html, /\son(?:click|change|submit)=/i);
});

test('hero elements have complete visual styles', async () => {
  const css = await readFile(new URL('style.css', root), 'utf8');
  for (const selector of ['.hero-visual', '.mock-card', '.orb-one', '.spend-card', '.savings-card']) {
    assert.ok(css.includes(selector), `Missing ${selector} styles`);
  }
});

test('privacy page documents local storage and external services', async () => {
  const html = await readFile(new URL('privacy.html', root), 'utf8');
  assert.match(html, /local storage/i);
  assert.match(html, /GitHub Pages/);
  assert.match(html, /Google Forms/);
});
