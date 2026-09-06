import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('one-page audit contains the required sections and controls', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const value of ['FeeVeto', 'Keep, switch, or cancel with confidence.', 'id="audit"', 'id="how-it-works"', 'id="privacy"', 'id="faq"', 'id="subscription-form"', 'id="detail-dialog"', 'id="subscription-list"', 'id="announcer"', 'id="sign-in-button"', 'id="sign-up-button"', 'id="user-button"', 'id="access-badge"', 'id="service-id"', 'id="product-type"', 'id="requirement-questions"']) {
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
  assert.match(html, /not attached to your Clerk account/i);
  assert.match(html, /does not send the subscription name, entered price, private notes, calculated totals, or your full subscription list/i);
  assert.match(html, /private-browsing mode/i);
  assert.match(html, /Clerk for optional authentication/i);
});

test('restricted catalogue records are absent from public frontend sources', async () => {
  const publicCatalogue = await readFile(new URL('data/alternatives.js', root), 'utf8');
  const provider = await readFile(new URL('js/alternativeProvider.js', root), 'utf8');
  assert.match(publicCatalogue, /Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(provider, /data\/alternatives/);
  assert.match(await readFile(new URL('.gitignore', root), 'utf8'), /^\.private\/$/m);
});

test('Clerk integration uses only a Vite publishable key in browser code', async () => {
  const auth = await readFile(new URL('js/auth.js', root), 'utf8');
  const access = await readFile(new URL('js/access.js', root), 'utf8');
  const viteConfig = await readFile(new URL('vite.config.js', root), 'utf8');
  assert.match(viteConfig, /VITE_CLERK_PUBLISHABLE_KEY/);
  assert.match(viteConfig, /CLERK_PUBLISHABLE_KEY/);
  assert.match(auth, /__FEEVETO_CLERK_PUBLISHABLE_KEY__/);
  assert.match(auth, /mountUserButton/);
  assert.match(auth, /openSignIn/);
  assert.match(auth, /openSignUp/);
  assert.doesNotMatch(auth, /CLERK_SECRET_KEY/);
  assert.doesNotMatch(access, /CLERK_SECRET_KEY|privateMetadata|localStorage/);
  assert.doesNotMatch(viteConfig, /environment\.CLERK_SECRET_KEY/);
});

test('Cloudflare access control reads Clerk private metadata only on the backend', async () => {
  const clerkAccess = await readFile(new URL('functions/_shared/clerk-access.js', root), 'utf8');
  const policy = await readFile(new URL('functions/_shared/access-policy.js', root), 'utf8');
  assert.match(clerkAccess, /authenticateRequest/);
  assert.match(clerkAccess, /users\.getUser/);
  assert.match(clerkAccess, /user\.privateMetadata/);
  assert.match(clerkAccess, /acceptsToken:\s*'session_token'/);
  assert.doesNotMatch(clerkAccess, /publicMetadata|unsafeMetadata|request\.json|localStorage/);
  assert.doesNotMatch(policy, /request|localStorage/);
});

test('visual system is light and respects reduced motion', async () => {
  const css = await readFile(new URL('style.css', root), 'utf8');
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /#f5f7f2/i);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /glassmorphism/i);
});
