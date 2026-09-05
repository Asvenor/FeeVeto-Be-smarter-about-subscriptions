import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('one-page audit contains the required sections and controls', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const value of ['FeeVeto', 'Keep, switch, or cancel with confidence.', 'id="audit"', 'id="how-it-works"', 'id="privacy"', 'id="faq"', 'id="subscription-form"', 'id="detail-dialog"', 'id="subscription-list"', 'id="announcer"']) {
    assert.ok(html.includes(value), `Missing ${value}`);
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Page must not contain duplicate IDs');
  assert.doesNotMatch(html, /\son(?:click|change|submit)=/i);
});

test('old product name is not visible in page copy or metadata', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const withoutUrls = html.replace(/(?:href|src|content)="[^"]*SubKiller[^"]*"/g, '');
  assert.doesNotMatch(withoutUrls, /SubKiller/i);
});

test('privacy page uses precise local storage wording', async () => {
  const html = await readFile(new URL('privacy.html', root), 'utf8');
  assert.match(html, /stored locally in this browser/i);
  assert.match(html, /not sent to FeeVeto/i);
  assert.match(html, /private-browsing mode/i);
});

test('visual system is light and respects reduced motion', async () => {
  const css = await readFile(new URL('style.css', root), 'utf8');
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /#f5f7f2/i);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /glassmorphism/i);
});
