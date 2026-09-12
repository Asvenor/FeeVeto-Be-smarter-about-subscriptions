import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleWorkerRequest } from '../worker.js';

test('production config attaches only the two exact custom domains and retains workers.dev', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.routes, [
    { pattern: 'feeveto.com', custom_domain: true },
    { pattern: 'www.feeveto.com', custom_domain: true },
  ]);
});

test('www and HTTP apex redirect to HTTPS apex with the original path and query', async () => {
  for (const origin of ['http://feeveto.com', 'http://www.feeveto.com', 'https://www.feeveto.com']) {
    const response = await handleWorkerRequest(new Request(`${origin}/privacy.html?source=a%20b&x=%2F`), {}, null);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), 'https://feeveto.com/privacy.html?source=a%20b&x=%2F');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  }
});

test('canonical redirects preserve non-GET methods and do not consume or process request bodies', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const request = new Request('https://www.feeveto.com/api/example?returnTo=%2Faudit', {
      method,
      body: JSON.stringify({ saved: 'unchanged' }),
    });
    let processed = false;
    const response = await handleWorkerRequest(request, {}, null, {
      '/api/example': () => { processed = true; return new Response('must not run'); },
    });
    // 308 instructs the client to retain its method and body when following.
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), 'https://feeveto.com/api/example?returnTo=%2Faudit');
    assert.equal(request.method, method);
    assert.equal(request.bodyUsed, false);
    assert.equal(processed, false);
  }
});

test('canonical HTTPS, legacy host, local previews, and lookalike domains are not redirected', async () => {
  for (const origin of [
    'https://feeveto.com',
    'https://feeveto.edward-nyarko.workers.dev',
    'http://127.0.0.1:8792',
    'http://localhost:8787',
    'https://www.feeveto.com.evil.example',
    'https://preview.feeveto.com',
  ]) {
    const response = await handleWorkerRequest(new Request(`${origin}/`), {
      ASSETS: { fetch: () => new Response('original origin remains available') },
    }, null);
    assert.equal(response.status, 200, origin);
    assert.equal(response.headers.get('location'), null, origin);
  }
});

test('forwarding headers cannot trigger or change the canonical redirect target', async () => {
  const headers = {
    host: 'www.feeveto.com',
    'x-forwarded-host': 'www.feeveto.com',
    'x-forwarded-proto': 'http',
    forwarded: 'host=www.feeveto.com;proto=http',
    referer: 'http://www.feeveto.com/',
  };
  const ordinary = await handleWorkerRequest(new Request('https://feeveto.com/', { headers }), {
    ASSETS: { fetch: () => new Response('no redirect') },
  }, null);
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.headers.get('location'), null);

  const redirected = await handleWorkerRequest(new Request('https://www.feeveto.com//evil.example/%2Fpath?next=https://evil.example', {
    headers: { ...headers, 'x-forwarded-host': 'evil.example', referer: 'https://evil.example' },
  }), {}, null);
  assert.equal(redirected.status, 308);
  assert.equal(redirected.headers.get('location'), 'https://feeveto.com//evil.example/%2Fpath?next=https://evil.example');
  assert.equal(new URL(redirected.headers.get('location')).origin, 'https://feeveto.com');
});

test('canonical production API requests still pass through the existing protection', async () => {
  let processed = false;
  const response = await handleWorkerRequest(new Request('https://feeveto.com/api/example'), {}, null, {
    '/api/example': () => { processed = true; return new Response('must not run'); },
  });
  assert.equal(response.status, 503);
  assert.equal(processed, false);
  assert.equal(response.headers.get('location'), null);
});
