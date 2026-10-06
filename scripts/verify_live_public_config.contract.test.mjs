import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const verifier = readFileSync(new URL('./verify_live_public_config.mjs', import.meta.url), 'utf8');

test('live public configuration verification probes the wallet app route', () => {
  assert.match(verifier, /WALLET_CONFIG_PROBE_PATH\s*=\s*['"]\/portfolio['"]/);
  assert.match(verifier, /new URL\(WALLET_CONFIG_PROBE_PATH, parsedUrl\)/);
  assert.match(verifier, /deploymentContains\(walletConfigUrl, expectedPrivyAppId, revision\)/);
});
