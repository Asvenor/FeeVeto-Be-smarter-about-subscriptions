import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createStripeClient } from '../functions/_shared/stripe-client.js';
import { validateCheckoutPrice } from '../functions/_shared/billing-config.js';
import { BILLING_PLANS } from '../js/billingPlans.js';

// Local-only harness. Credentials are never put in command-line arguments or
// printed. The user-supplied runtime.env remains unchanged and disabled.
const directory = '.private/billing-sandbox';
const settings = parseEnv(await readFile(`${directory}/runtime.env`, 'utf8'));
const auth = parseEnv(await readFile('.env.local', 'utf8'));
const expected = JSON.parse(await readFile(`${directory}/setup.json`, 'utf8'));
if (settings.BILLING_MODE !== 'test' || !/^(sk|rk)_test_/.test(settings.STRIPE_SECRET_KEY || '')
  || !auth.CLERK_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Only sandbox Stripe and development Clerk credentials are permitted.');
const stripe = createStripeClient(settings);
try {
  if ((await stripe.accounts.retrieve()).id !== expected.accountId) throw new Error('Unexpected sandbox account.');
  for (const plan of Object.values(BILLING_PLANS)) {
    const priceId = settings[plan.id === 'monthly' ? 'STRIPE_MONTHLY_PRICE_ID' : 'STRIPE_LIFETIME_PRICE_ID'];
    validateCheckoutPrice(await stripe.prices.retrieve(priceId), { ...plan, priceId }, settings);
  }
} catch { throw new Error('Sandbox identity or approved prices could not be verified. No local checkout was started.'); }

const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required', 'customer.subscription.created',
  'customer.subscription.updated', 'customer.subscription.deleted', 'charge.refunded'];
const children = [];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(0); });
process.on('exit', stop);
function child(command, args, env = {}) {
  const processChild = spawn(command, args, { env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(processChild);
  processChild.on('error', () => { console.error('A local billing tool could not start.'); stop(); process.exitCode = 1; });
  return processChild;
}
const listener = child('npx', ['--yes', '@stripe/cli', '--config', '.private/stripe-billing-cli.toml', 'listen',
  '--live=false', '--latest', '--events', events.join(','), '--forward-to', 'http://127.0.0.1:8790/api/billing/webhook'],
  { STRIPE_API_KEY: settings.STRIPE_SECRET_KEY });
let ready;
const webhookReady = new Promise((resolve, reject) => {
  ready = resolve;
  const timeout = setTimeout(() => reject(new Error('Stripe listener did not become ready.')), 60_000);
  listener.once('exit', code => { clearTimeout(timeout); if (!stopping) reject(new Error(`Stripe listener exited (${code}).`)); });
  listener.once('billing-ready', () => clearTimeout(timeout));
});
for (const stream of [listener.stdout, listener.stderr]) createInterface({ input: stream }).on('line', line => {
  const secret = line.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (secret) { listener.emit('billing-ready'); ready(secret); }
  const result = line.match(/\[(\d{3})\].*POST/);
  if (result) console.log(JSON.stringify({ stripeWebhookStatus: Number(result[1]), eventId: line.match(/evt_[A-Za-z0-9]+/)?.[0] }));
});
try {
  const webhookSecret = await webhookReady;
  const environment = { ...settings, CLERK_SECRET_KEY: auth.CLERK_SECRET_KEY,
    CLERK_PUBLISHABLE_KEY: auth.VITE_CLERK_PUBLISHABLE_KEY, VITE_CLERK_PUBLISHABLE_KEY: auth.VITE_CLERK_PUBLISHABLE_KEY,
    CLERK_AUTHORIZED_PARTIES: 'http://127.0.0.1:8790', BILLING_ENABLED: 'true', STRIPE_WEBHOOK_SECRET: webhookSecret };
  await writeFile(`${directory}/preview.env`, Object.entries(environment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  await chmod(`${directory}/preview.env`, 0o600);
  console.log('Stripe sandbox forwarding is ready. Its signing secret was saved privately.');
  const worker = child('node_modules/.bin/wrangler', ['dev', '--local', '--config', 'wrangler.billing-test.jsonc',
    '--persist-to', '.private/billing-local-state', '--port', '8790', '--inspector-port', '9231',
    '--env-file', `${directory}/preview.env`, '--show-interactive-dev-session=false'],
    { WRANGLER_LOG_PATH: '.private/wrangler-logs', WRANGLER_SEND_METRICS: 'false' });
  for (const stream of [worker.stdout, worker.stderr]) createInterface({ input: stream }).on('line', line => {
    if (line.includes('Ready on http://127.0.0.1:8790')) console.log('Local sandbox checkout is ready at http://127.0.0.1:8790/#pricing');
    if (/\bERROR\b/.test(line)) console.error('Local Worker reported an error; inspect private local logs.');
  });
  worker.once('exit', code => { if (!stopping) { console.log(`Local Worker stopped (${code}).`); stop(); } });
  listener.once('exit', code => { if (!stopping) { console.log(`Stripe listener stopped (${code}).`); stop(); } });
} catch { console.error('Local billing setup stopped safely before verification completed.'); stop(); process.exitCode = 1; }
