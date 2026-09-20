import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Git may materialize checked-in YAML with CRLF on Windows. Keep the
// contract's structural substring checks independent of checkout settings.
const workflow = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const productionEnvValidator = readFileSync(new URL('./validate_production_env.mjs', import.meta.url), 'utf8');
const pagesConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const gasFunction = readFileSync(new URL('../functions/api/gas.ts', import.meta.url), 'utf8');

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `workflow step is missing: ${name}`);
  const next = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, next >= 0 ? next : workflow.length);
}

test('production validation, deterministic verification, and deployment build are ordered', () => {
  const secretSync = workflow.indexOf('Sync production Pages gas-oracle secret');
  const validation = workflow.indexOf('run: pnpm verify:production-env');
  const verification = workflow.indexOf('run: pnpm verify\n');
  const productionBuild = workflow.indexOf('run: pnpm build\n');
  const wait = workflow.indexOf('Wait for Cloudflare Pages deployment');
  const gasCheck = workflow.indexOf('Check live gas-oracle binding');
  const gasRedeploy = workflow.indexOf('Redeploy verified artifact after syncing the Pages secret');
  const gasVerify = workflow.indexOf('Verify live gas oracle');
  const liveConfig = workflow.indexOf('Verify live wallet configuration');
  const sync = workflow.indexOf('Sync Telegram bot metadata and menu');
  assert.ok(secretSync >= 0 && secretSync < validation && validation < verification);
  assert.ok(verification < productionBuild && productionBuild < wait);
  assert.ok(wait < gasCheck && gasCheck < gasRedeploy && gasRedeploy < gasVerify);
  assert.ok(gasVerify < liveConfig && liveConfig < sync);
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

test('native deployment remains SHA-gated and Pages credentials are limited to secret sync and fallback upload', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+checks: read/);
  assert.match(workflow, /jobs:\s*\n\s+deploy:\s*\n\s+name: Build and deploy Cloudflare Pages\s*\n\s+if: github\.ref == 'refs\/heads\/main'/);
  const wait = step('Wait for Cloudflare Pages deployment');
  assert.match(wait, /run: node scripts\/wait_for_cloudflare_check\.mjs/);
  assert.match(wait, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.match(wait, /GITHUB_REPOSITORY:\s*\$\{\{\s*github\.repository\s*\}\}/);
  assert.match(wait, /GITHUB_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(wait, /CLOUDFLARE_CHECK_NAME:\s*["']?Cloudflare Pages["']?/);
  assert.match(wait, /CLOUDFLARE_PAGES_PROJECT:\s*fxaeon/);

  const secretSync = step('Sync production Pages gas-oracle secret');
  assert.match(secretSync, /id: gas_secret/);
  assert.match(secretSync, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
  assert.match(secretSync, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
  assert.match(secretSync, /ETHERSCAN_API_KEY:\s*\$\{\{\s*secrets\.ETHERSCAN_API_KEY\s*\}\}/);
  assert.match(secretSync, /printf '%s' "\$ETHERSCAN_API_KEY" \| pnpm exec wrangler pages secret put ETHERSCAN_API_KEY --project-name=fxaeon --env=production/);
  assert.match(secretSync, /configured=false/);
  assert.match(secretSync, /configured=true/);
  assert.match(secretSync, /RPC gas estimate fallback/);
  assert.match(secretSync, /Pages secret sync was not authorized/);
  assert.doesNotMatch(secretSync, /wrangler pages secret put[^\n]*\$\{\{/);
  assert.match(secretSync, /WRANGLER_SEND_METRICS:\s*['"]?false/);

  const gasCheck = step('Check live gas-oracle binding');
  assert.match(gasCheck, /run: node scripts\/check_live_gas_oracle\.mjs/);
  assert.match(gasCheck, /LIVE_GAS_ORACLE_URL:\s*https:\/\/fxaeon\.com\/api\/gas/);
  const gasRedeploy = step('Redeploy verified artifact after syncing the Pages secret');
  assert.match(gasRedeploy, /if: steps\.gas_secret\.outputs\.configured == 'true' && steps\.gas_oracle\.outputs\.configured == 'false'/);
  assert.match(gasRedeploy, /wrangler pages deploy apps\/mini-app\/dist --project-name=fxaeon --branch=main --commit-hash=/);
  assert.match(gasRedeploy, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
  assert.match(gasRedeploy, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
  assert.match(gasRedeploy, /WRANGLER_SEND_METRICS:\s*['"]?false/);
  assert.doesNotMatch(gasRedeploy, /working-directory:/);
  assert.match(gasRedeploy, /apps\/mini-app\/dist/);
  assert.match(pagesConfig, /^name = "fxaeon"$/m);
  assert.match(pagesConfig, /^pages_build_output_dir = "apps\/mini-app\/dist"$/m);
  assert.match(gasFunction, /export const onRequestGet/);
  assert.match(gasFunction, /env\?\.ETHERSCAN_API_KEY/);
  const gasVerify = step('Verify live gas oracle');
  assert.match(gasVerify, /if: steps\.gas_secret\.outputs\.configured == 'true'/);
  assert.match(gasVerify, /--require-configured/);
  assert.doesNotMatch(productionEnvValidator, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/);
});

test('gas-oracle probe accepts only the explicit missing-binding response for its fallback', () => {
  const probe = readFileSync(new URL('./check_live_gas_oracle.mjs', import.meta.url), 'utf8');
  assert.match(probe, /status === 503[\s\S]*body\.error === 'gas oracle unavailable'/);
  assert.match(probe, /redirect:\s*'error'/);
  assert.match(probe, /cache:\s*'no-store'/);
  assert.match(probe, /--require-configured/);
  assert.doesNotMatch(probe, /console\.log\([^\n]*body/);
});

test('the published Cloudflare bundle is checked for the protected public wallet configuration', () => {
  const verification = step('Verify live wallet configuration');
  assert.match(verification, /run: node scripts\/verify_live_public_config\.mjs/);
  assert.match(verification, /EXPECTED_PUBLIC_PRIVY_APP_ID:\s*\$\{\{\s*secrets\.NEXT_PUBLIC_PRIVY_APP_ID\s*\}\}/);
  assert.match(verification, /GITHUB_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(verification, /LIVE_APP_URL:\s*https:\/\/fxaeon\.com/);
  assert.match(workflow, /TELEGRAM_WEB_APP_URL:\s*https:\/\/fxaeon\.com\//);
});

test('production validation keeps the local development Privy application out', () => {
  assert.match(productionEnvValidator, /cmu5tz4f000lp0cl5qtd87sro/);
  assert.match(productionEnvValidator, /local-development application/);
});
