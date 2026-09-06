const JSON_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
});

export function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}
export function methodNotAllowed(allowedMethods = ['GET']) {
  return json({ error: 'Method not allowed.' }, { status: 405, headers: { Allow: allowedMethods.join(', ') } });
}
