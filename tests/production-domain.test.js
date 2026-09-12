import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('production canonical and social URLs use the exact HTTPS apex domain and asset paths', async () => {
  const index = new JSDOM(await source('index.html')).window.document;
  const privacy = new JSDOM(await source('privacy.html')).window.document;
  assert.equal(index.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(index.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://feeveto.com/');
  assert.equal(privacy.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(privacy.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://feeveto.com/privacy.html');
  assert.equal(index.querySelector('meta[property="og:url"]').content, 'https://feeveto.com/');
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    assert.equal(index.querySelector(selector).content, 'https://feeveto.com/social-preview.png');
  }
});

test('crawler discovery lists only the public production pages on feeveto.com', async () => {
  const robots = await source('robots.txt');
  assert.match(robots, /^Sitemap: https:\/\/feeveto\.com\/sitemap\.xml$/m);
  assert.equal(robots.match(/^Sitemap:/gm)?.length, 1);
  const sitemap = new JSDOM(await source('sitemap.xml'), { contentType: 'text/xml' }).window.document;
  assert.deepEqual([...sitemap.querySelectorAll('loc')].map(element => element.textContent), [
    'https://feeveto.com/',
    'https://feeveto.com/privacy.html',
  ]);
});
