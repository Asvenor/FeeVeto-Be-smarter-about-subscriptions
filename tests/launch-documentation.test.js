import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

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
