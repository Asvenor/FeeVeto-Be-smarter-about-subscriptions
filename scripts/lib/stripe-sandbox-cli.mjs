import { execFileSync } from 'node:child_process';

// Administrative/test tooling only. Never imported into the Worker or browser.
export function sandboxCli({ accountId, configPath = '.private/stripe-billing-cli.toml' }) {
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId || '')) throw new Error('An explicit sandbox account ID is required.');
  function execute(args) {
    let output;
    try {
      output = execFileSync('npx', ['--yes', '@stripe/cli', '--config', configPath, ...args],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    } catch (error) {
      // CLI stderr and raw response bodies may contain private account details.
      throw new Error(`Stripe command failed (exit ${error.status ?? 'timeout'}); inspect the sandbox request log.`);
    }
    const result = JSON.parse(output);
    if (result.error) throw new Error(`Stripe rejected the request (${result.error.code || result.error.type || 'unknown'}).`);
    return result;
  }
  function verify() {
    const context = execute(['whoami', '--format', 'json']);
    if (context.account_id !== accountId || context.mode !== 'test') throw new Error('Refusing to use an unexpected account or live context.');
    return { accountId: context.account_id, name: context.display_name, mode: context.mode };
  }
  function request(method, path, data = {}, idempotencyKey = '') {
    verify();
    if (!['get', 'post', 'delete'].includes(method) || !path.startsWith('/v1/')) throw new Error('Unsupported sandbox request.');
    const args = [method, path, '--live=false'];
    for (const [key, value] of Object.entries(data)) args.push('-d', `${key}=${value}`);
    if (idempotencyKey) args.push('--idempotency', idempotencyKey);
    const result = execute(args);
    const objects = result.object === 'list' ? result.data : [result];
    if (objects?.some(value => value.livemode === true)) throw new Error('Unexpected live object; stopping.');
    return result;
  }
  return { verify, request };
}
