import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { isTargetCloudflareRun, newestRun } from './wait_for_cloudflare_check.mjs';

const details = 'https://dash.cloudflare.com/account/pages/view/fxaeon/dep-123';
const nativeDetails = 'https://dash.cloudflare.com/?to=/ACCOUNT/pages/view/fxaeon/DEPLOYMENT';

test('only the financial Pages project can satisfy the deployment gate', () => {
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages', details_url: details }), true);
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages', details_url: nativeDetails }), true);
  assert.equal(isTargetCloudflareRun({
    name: 'Cloudflare Pages',
    details_url: details.replace('/fxaeon/', '/fxaeon-landing/'),
  }), false);
  assert.equal(isTargetCloudflareRun({
    name: 'Cloudflare Pages',
    details_url: nativeDetails.replace('/fxaeon/', '/fxaeon-landing/'),
  }), false);
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages', status: 'completed' }), false);
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages', details_url: 'https://evil.example/pages/view/fxaeon/dep-1' }), false);
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages', details_url: 'https://dash.cloudflare.com/?next=/pages/view/fxaeon/dep-1' }), false);
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages', details_url: 'https://dash.cloudflare.com/?to=https%3A%2F%2Fevil.example%2Fpages%2Fview%2Ffxaeon%2Fdep-1' }), false);
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages', details_url: 'https://dash.cloudflare.com/?to=%2FACCOUNT%2Fpages%2Fview%2Ffxaeon%2FDEPLOYMENT' }), false);
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages', details_url: 'https://dash.cloudflare.com/?to=/ACCOUNT/pages/view/fxaeon/DEPLOYMENT&next=https://evil.example' }), false);
  assert.equal(isTargetCloudflareRun({ name: 'Cloudflare Pages: fxaeon', details_url: details }), false);
});

test('direct CLI execution fails clearly when required environment is absent', () => {
  assert.throws(
    () => execFileSync(process.execPath, [resolve('scripts/wait_for_cloudflare_check.mjs')], {
      cwd: resolve('.'),
      env: { PATH: process.env.PATH },
      stdio: 'pipe',
    }),
    /GITHUB_TOKEN is required/,
  );
});

test('a landing success cannot mask a financial failure', () => {
  const landingSuccess = {
    name: 'Cloudflare Pages',
    details_url: details.replace('/fxaeon/', '/fxaeon-landing/'),
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-09-15T00:00:00Z',
  };
  const financeFailure = {
    name: 'Cloudflare Pages', details_url: details,
    status: 'completed', conclusion: 'failure',
    completed_at: '2026-09-16T00:00:00Z',
  };
  assert.equal(isTargetCloudflareRun(landingSuccess), false);
  assert.equal(isTargetCloudflareRun(financeFailure), true);
  assert.equal(newestRun([landingSuccess, financeFailure].filter(isTargetCloudflareRun)), financeFailure);
});

test('newest target run remains the one evaluated', () => {
  const runs = [
    { name: 'Cloudflare Pages', details_url: details, completed_at: '2026-09-15T00:00:00Z' },
    { name: 'Cloudflare Pages', details_url: details, completed_at: '2026-09-16T00:00:00Z' },
  ];
  assert.equal(newestRun(runs), runs[1]);
});
