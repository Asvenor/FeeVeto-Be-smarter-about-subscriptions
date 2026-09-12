import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleWorkerRequest } from '../worker.js';
import { protectApiRequest, secureResponse } from '../functions/_shared/request-safety.js';

const request = (path = '/api/assessment', method = 'POST', headers = {}) => new Request(`https://feeveto.example${path}`, {
  method, headers: { Origin: 'https://feeveto.example', 'CF-Connecting-IP': '192.0.2.10', ...headers },
});
function limits({ api = 120, write = 20 } = {}) {
  const calls = [];
  function binding(name, maximum) {
    const counts = new Map();
    return { async limit({ key }) {
      calls.push({ name, key });
      counts.set(key, (counts.get(key) || 0) + 1);
      return { success: counts.get(key) <= maximum };
    } };
  }
  return { calls, env: { FEEVETO_API_LIMIT: binding('api', api), FEEVETO_WRITE_LIMIT: binding('write', write) } };
}

test('baseline response security preserves content, cookies, status and caching without blocking Clerk resources', async () => {
  const response = secureResponse(new Response('<main>FeeVeto</main>', { status: 202, headers: {
    'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=300', 'Set-Cookie': 'test=value; Secure; HttpOnly',
  } }));
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '<main>FeeVeto</main>');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(response.headers.get('set-cookie'), 'test=value; Secure; HttpOnly');
  assert.equal(response.headers.get('content-security-policy'), "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.doesNotMatch(response.headers.get('content-security-policy'), /script-src|default-src|connect-src|frame-src/);
  assert.match(secureResponse(new Response('', { headers: { 'Content-Security-Policy': "script-src 'self'" } })).headers.get('content-security-policy'), /script-src 'self'/);
});

test('public search and assessment share a budget without login and cannot reset it with query text or auth flags', async () => {
  const { env, calls } = limits({ api: 2 });
  assert.equal(await protectApiRequest(request(), env), null);
  assert.equal(await protectApiRequest(request('/api/alternatives/recommendations?role=admin'), env), null);
  const blocked = await protectApiRequest(request('/api/assessment?different=1', 'POST', { Authorization: 'Bearer forged' }), env);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal((await blocked.json()).code, 'rate_limited');
  assert.deepEqual(new Set(calls.map(call => call.name)), new Set(['api']));
  assert.deepEqual(new Set(calls.map(call => call.key)), new Set(['192.0.2.10']));
  assert.equal(await protectApiRequest(request('/api/assessment', 'POST', { 'CF-Connecting-IP': '192.0.2.11' }), env), null);
});

test('account, admin and billing mutations share a smaller budget before identity, storage or Stripe work', async () => {
  const { env } = limits({ write: 2 });
  assert.equal(await protectApiRequest(request('/api/audits'), env), null);
  assert.equal(await protectApiRequest(request('/api/admin/settings', 'PUT'), env), null);
  let touched = false;
  const routes = { '/api/billing/checkout': () => { touched = true; return new Response('should not run'); } };
  const response = await handleWorkerRequest(request('/api/billing/checkout?plan=monthly'), env, null, routes);
  assert.equal(response.status, 429);
  assert.equal(touched, false);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(await protectApiRequest(request('/api/audits', 'GET'), env), null, 'history reads do not consume the write budget');
});

test('missing, throwing or malformed limiter fails closed with a recoverable error and leaves static audit available', async () => {
  for (const env of [{}, { FEEVETO_API_LIMIT: { limit: async () => { throw new Error('secret backend detail'); } } },
    { FEEVETO_API_LIMIT: { limit: async () => ({ success: 'true' }) } },
    { FEEVETO_API_LIMIT: { limit: async () => ({ success: true }) } }]) {
    let touched = false;
    const response = await handleWorkerRequest(request('/api/audits'), env, null, {
      '/api/audits': () => { touched = true; return new Response('should not run'); },
    });
    assert.equal(response.status, 503);
    assert.equal(touched, false);
    const body = await response.json();
    assert.equal(body.code, 'request_protection_unavailable');
    assert.match(body.error, /answers are kept/);
    assert.doesNotMatch(JSON.stringify(body), /secret backend detail/);
  }
  const staticResponse = await handleWorkerRequest(request('/', 'GET'), { ASSETS: { fetch: async () => new Response('Free audit') } });
  assert.equal(staticResponse.status, 200);
  assert.equal(await staticResponse.text(), 'Free audit');
});

test('cross-origin requests are denied before backend work, but same-origin and bearer CLI requests remain usable', async () => {
  const { env, calls } = limits();
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await protectApiRequest(request('/api/billing/portal', 'POST', headers), env)).status, 403);
  }
  assert.equal(calls.length, 0);
  assert.equal(await protectApiRequest(request('/api/billing/portal'), env), null);
  assert.equal(await protectApiRequest(new Request('https://feeveto.example/api/audits', { headers: { Authorization: 'Bearer session' } }), env), null);
  assert.equal(calls.at(-1).key, 'unknown-client');
});

test('Stripe webhooks and privacy-checked events retain their independent authentication and limits', async () => {
  for (const path of ['/api/billing/webhook', '/api/events']) assert.equal(await protectApiRequest(request(path), {}), null);
  const response = await handleWorkerRequest(request('/api/billing/webhook'), {}, null);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Webhook signature is required.');
  const event = await handleWorkerRequest(request('/api/events', 'POST', { Origin: 'https://evil.example' }), {}, null);
  assert.equal(event.status, 403);
});

test('unexpected API and asset failures return safe support references, not raw exceptions', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', value => logs.push(value));
  const { env } = limits();
  for (const operation of ['api', 'static']) {
    const fail = () => { throw new Error('sensitive-key user_email@example.invalid raw request'); };
    const response = await handleWorkerRequest(request(operation === 'api' ? '/api/assessment' : '/', operation === 'api' ? 'POST' : 'GET'),
      { ...env, ASSETS: { fetch: fail } }, null, { '/api/assessment': fail });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.parse(logs.at(-1)).operation, operation);
    assert.doesNotMatch(JSON.stringify(body) + logs.at(-1), /sensitive-key|user_email|raw request/);
  }
});

test('production and sandbox declare separate matching API and write limiter configurations', async () => {
  const allNamespaces = new Set();
  for (const file of ['wrangler.jsonc', 'wrangler.billing-test.jsonc']) {
    const config = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
    for (const [name, maximum] of [['FEEVETO_API_LIMIT', 120], ['FEEVETO_WRITE_LIMIT', 20]]) {
      const binding = config.ratelimits.find(item => item.name === name);
      assert.deepEqual(binding.simple, { limit: maximum, period: 60 });
      assert.equal(allNamespaces.has(binding.namespace_id), false);
      allNamespaces.add(binding.namespace_id);
    }
  }
});
