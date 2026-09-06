import { spawnSync } from 'node:child_process';
import { CATALOGUE_KEY } from '../functions/_shared/catalogue-store.js';
import { validateCatalogueFile } from './catalogue-validate.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const filePath = argument('--file');
  const namespaceId = argument('--namespace-id');
  const remoteConfirmed = process.argv.includes('--remote');
  if (!filePath || !namespaceId || !remoteConfirmed) {
    throw new Error('Usage: npm run catalogue:publish -- --file .private/catalogue.json --namespace-id <KV_NAMESPACE_ID> --remote');
  }
  const result = await validateCatalogueFile(filePath);
  process.stdout.write(`Publishing ${result.offerCount} validated offers to ${CATALOGUE_KEY}.\n`);
  const command = ['wrangler', 'kv', 'key', 'put', '--namespace-id', namespaceId, CATALOGUE_KEY, '--path', result.absolutePath, '--remote'];
  const published = spawnSync('npx', command, { stdio: 'inherit' });
  if (published.error) throw published.error;
  if (published.status !== 0) throw new Error(`Wrangler exited with status ${published.status}.`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
