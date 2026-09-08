import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWorkerRequest } from '../worker.js';

test('worker routes API requests through the protected backend', async () => {
  const request = new Request('https://feeveto.example/api/example');
  const response = await handleWorkerRequest(request, { marker: 'environment' }, null, {
    '/api/example': ({ request: routedRequest, env }) => new Response(`${new URL(routedRequest.url).pathname}:${env.marker}`),
  });

  assert.equal(await response.text(), '/api/example:environment');
});

test('worker delegates non-API requests to static assets', async () => {
  const request = new Request('https://feeveto.example/privacy.html');
  const response = await handleWorkerRequest(request, {
    ASSETS: { fetch: (assetRequest) => new Response(`asset:${new URL(assetRequest.url).pathname}`) },
  }, null, {});

  assert.equal(await response.text(), 'asset:/privacy.html');
});

test('worker fails closed when static assets are not configured', async () => {
  const response = await handleWorkerRequest(new Request('https://feeveto.example/'), {}, null, {});

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Static assets are not configured.' });
});

test('worker exposes checkout and webhook only as POST API routes', async () => {
  for (const pathname of ['/api/billing/checkout', '/api/billing/webhook']) {
    const response = await handleWorkerRequest(new Request(`https://feeveto.example${pathname}`), {}, null);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
});
