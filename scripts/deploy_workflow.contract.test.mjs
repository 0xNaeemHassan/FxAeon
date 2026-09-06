import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Git may materialize checked-in YAML with CRLF on Windows. Keep the
// contract's structural substring checks independent of checkout settings.
const workflow = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

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
  const deploy = workflow.indexOf('Deploy to Cloudflare Pages');
  assert.ok(validation >= 0 && validation < verification);
  assert.ok(verification < productionBuild && productionBuild < deploy);
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
