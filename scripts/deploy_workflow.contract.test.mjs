import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Git may materialize checked-in YAML with CRLF on Windows. Keep the
// contract's structural substring checks independent of checkout settings.
const workflow = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const productionEnvValidator = readFileSync(new URL('./validate_production_env.mjs', import.meta.url), 'utf8');

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `workflow step is missing: ${name}`);
  const next = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, next >= 0 ? next : workflow.length);
}

test('production validation, deterministic verification, and deployment build are ordered', () => {
  const validation = workflow.indexOf('run: pnpm verify:production-env');
  const verification = workflow.indexOf('run: pnpm verify\n');
  const productionBuild = workflow.indexOf('run: pnpm build\n');
  const wait = workflow.indexOf('Wait for Cloudflare Pages deployment');
  const sync = workflow.indexOf('Sync Telegram bot metadata and menu');
  assert.ok(validation >= 0 && validation < verification);
  assert.ok(verification < productionBuild && productionBuild < wait && wait < sync);
});

test('complete verification has no production public variables in scope', () => {
  const verification = step('Run complete repository verification');
  assert.match(verification, /run: pnpm verify/);
  assert.doesNotMatch(verification, /NEXT_PUBLIC_(?:PRIVY|ALCHEMY|TELEGRAM)/);
});

test('the deployed artifact is rebuilt with every required production public variable', () => {
  const productionBuild = step('Build production deployment artifact');
  assert.match(productionBuild, /run: pnpm build/);
  for (const name of [
    'NEXT_PUBLIC_PRIVY_APP_ID',
    'NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY_DATA_API_KEY',
    'NEXT_PUBLIC_TELEGRAM_APP_URL',
  ]) {
    assert.match(productionBuild, new RegExp(`${name}:`));
  }
});

test('native Cloudflare deployment is gated without Wrangler credentials', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+checks: read/);
  assert.doesNotMatch(workflow, /wrangler pages deploy/);
  const wait = step('Wait for Cloudflare Pages deployment');
  assert.match(wait, /run: node scripts\/wait_for_cloudflare_check\.mjs/);
  assert.match(wait, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.match(wait, /GITHUB_REPOSITORY:\s*\$\{\{\s*github\.repository\s*\}\}/);
  assert.match(wait, /GITHUB_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/);
  assert.doesNotMatch(productionEnvValidator, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/);
});
