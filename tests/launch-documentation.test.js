import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('privacy publishes the confirmed operator and support contact without changing creator credit', async () => {
  const privacy = await source('privacy.html');
  assert.match(privacy, /<h2 id="operator-contact">Operator and contact<\/h2>/);
  assert.match(privacy, /FeeVeto is operated by Edward Nyarko\./);
  assert.match(privacy, /For support, privacy questions, or requests concerning your account data/);
  assert.match(privacy, /<a href="mailto:inbox_business@outlook\.com">inbox_business@outlook\.com<\/a>/);
  assert.match(privacy, /Account ownership must be verified before account data is provided or removed\./);
  assert.doesNotMatch(privacy, /contact has not yet been provided|contact method and an account-data request process must be established/);
  assert.match(privacy, /FeeVeto by asvenor/);
  const readme = await source('README.md');
  assert.match(readme, /confirmed operator is Edward Nyarko/);
  assert.match(readme, /\[inbox_business@outlook\.com\]\(mailto:inbox_business@outlook\.com\)/);
  assert.doesNotMatch(readme, /Public support\/privacy contact details are still required/);
});

test('CI retains the required quality job without publishing a second static site', async () => {
  const workflow = await source('.github/workflows/static.yml');
  assert.match(workflow, /name: Quality checks/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run check/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches: \["main"\]/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /deploy-pages|configure-pages|upload-pages-artifact|pages: write|id-token: write|wrangler deploy/);
});

test('current documentation separates the free beta from prepared payments and historical releases', async () => {
  const readme = await source('README.md');
  const privacy = await source('privacy.html');
  assert.match(readme, /New purchases are disabled for this Public Beta/);
  assert.match(readme, /BILLING_ENABLED=false/);
  assert.match(readme, /existing Owner panel/);
  assert.match(readme, /Node\.js 20 is not supported/);
  assert.doesNotMatch(readme, /no admin dashboard is included|Node\.js 20 or newer is required|These changes are a review release, not a production deployment/);
  assert.match(privacy, /New purchases are disabled for this Public Beta/);
  assert.match(privacy, /even before you choose to sign in/);
  assert.match(privacy, /Deleting a Clerk profile does not automatically delete saved assessments/);
  assert.match(privacy, /trademarks belong to their respective owners/);
  assert.doesNotMatch(privacy, /GitHub Pages preview|Nothing ever leaves your browser/);
  for (const path of ['PUBLIC-BETA-HARDENING.md', 'JOURNEY-RELEASE.md', 'JOURNEY-CHECKPOINTS.md', 'POLISH-QA.md', 'CATALOGUE-RELEASE.md', 'experience-redesign.md']) {
    const document = await source(`docs/${path}`);
    assert.match(document.split('\n').slice(0, 5).join('\n'), /Historical/);
    assert.match(document, /LAUNCH-READINESS\.md/);
  }
});
