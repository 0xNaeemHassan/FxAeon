import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'https://fxaeon.com/api/gas';
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 10_000;

export function inspectGasOracleResponse(status, bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`gas oracle returned invalid JSON (HTTP ${status})`);
  }

  // The Pages Function uses 503 for a missing binding or an optional upstream
  // failure. Keep accepting the legacy 502 shape while older deployments drain;
  // `requireConfigured` still rejects `configured: false` when production
  // explicitly expects Etherscan-backed gas data.
  if ((status === 502 || status === 503)
    && body && typeof body === 'object' && body.error === 'gas oracle unavailable') {
    return { configured: false };
  }
  if (status !== 200 || !body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`gas oracle returned an unexpected response (HTTP ${status})`);
  }
  if (body.source !== 'etherscan'
    || body.chainId !== 1
    || typeof body.gasPriceWei !== 'string'
    || !/^[1-9]\d{0,18}$/.test(body.gasPriceWei)
    || !Number.isSafeInteger(body.fetchedAt)
    || body.fetchedAt < 0
    || typeof body.stale !== 'boolean'
    || (body.blockNumber !== undefined && (typeof body.blockNumber !== 'string' || !/^\d{1,16}$/.test(body.blockNumber)))) {
    throw new Error('gas oracle response failed its public schema check');
  }
  return { configured: true };
}

export async function checkLiveGasOracle({
  url = DEFAULT_URL,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bodyText = await response.text();
  return inspectGasOracleResponse(response.status, bodyText);
}

export async function checkLiveGasOracleWithRetry({
  requireConfigured = false,
  attempts = DEFAULT_RETRY_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  ...checkOptions
} = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error('gas-oracle retry attempts must be between 1 and 10');
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) {
    throw new Error('gas-oracle retry delay must be between 0 and 30000ms');
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await checkLiveGasOracle(checkOptions);
      if (result.configured || !requireConfigured) return result;
      lastError = new Error('live gas oracle is not configured after deployment');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('gas oracle probe failed');
    }
    if (attempt < attempts && retryDelayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs));
    }
  }
  throw lastError ?? new Error('live gas oracle did not become ready');
}

async function writeGitHubOutput(configured) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(outputPath, `configured=${configured ? 'true' : 'false'}\n`, 'utf8');
}

async function main() {
  const requireConfigured = process.argv.includes('--require-configured');
  const result = await checkLiveGasOracleWithRetry({
    url: process.env.LIVE_GAS_ORACLE_URL ?? DEFAULT_URL,
    requireConfigured,
  });
  await writeGitHubOutput(result.configured);
  console.log(result.configured
    ? 'PASS: live gas-oracle endpoint returned a valid public snapshot.'
    : 'The Pages Function reports a missing gas-oracle binding; the verified-artifact redeploy step will run.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Live gas-oracle check failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
