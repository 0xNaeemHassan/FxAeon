import { randomUUID } from 'node:crypto';
import { lstat, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const RELEASE_URL = 'https://fxaeon.com/release.json';
const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_ATTEMPTS = 12;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

export function validateRevision(revision) {
  if (typeof revision !== 'string' || !SHA_PATTERN.test(revision)) {
    throw new Error('revision must be a 40-character hexadecimal Git SHA');
  }
  return revision.toLowerCase();
}

function releaseDirectory(rootDir) {
  return resolve(rootDir, 'apps', 'mini-app', 'dist');
}

async function requireReleaseDirectory(rootDir) {
  const directory = releaseDirectory(rootDir);
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`production build directory does not exist: ${directory}`);
    }
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('production build path must be a real apps/mini-app/dist directory');
  }
  if (await realpath(directory) !== directory) {
    throw new Error('production build directory resolves outside apps/mini-app/dist');
  }
  return directory;
}

export async function writeReleaseRevision(revision, { rootDir = REPO_ROOT } = {}) {
  const normalizedRevision = validateRevision(revision);
  const directory = await requireReleaseDirectory(rootDir);
  const markerPath = resolve(directory, 'release.json');
  const temporaryPath = resolve(directory, `.release-${randomUUID()}.tmp`);
  const marker = `${JSON.stringify({ revision: normalizedRevision })}\n`;

  try {
    await writeFile(temporaryPath, marker, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, markerPath);
  } catch (error) {
    // The temporary path is fixed beneath the validated build directory.
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return markerPath;
}

function validateRetryOptions({ attempts, timeoutMs, retryDelayMs }) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error('release verification attempts must be between 1 and 20');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('release verification timeout must be between 1 and 30000ms');
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) {
    throw new Error('release verification retry delay must be between 0 and 30000ms');
  }
}

async function fetchReleaseRevision(fetchImpl, attempt, timeoutMs) {
  const url = new URL(RELEASE_URL);
  url.searchParams.set('release_check', `${Date.now()}-${attempt}-${randomUUID()}`);
  const controller = new AbortController();
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`release request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      (async () => {
        const result = await fetchImpl(url, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          headers: { 'cache-control': 'no-cache' },
          signal: controller.signal,
        });
        if (result.redirected) throw new Error('release endpoint followed a redirect');
        if (result.url) {
          const finalUrl = new URL(result.url);
          if (finalUrl.origin !== 'https://fxaeon.com' || finalUrl.pathname !== '/release.json') {
            throw new Error('release response came from an unexpected URL');
          }
        }
        if (result.status !== 200) throw new Error(`release endpoint returned HTTP ${result.status}`);
        const body = await result.text();
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new Error('release endpoint returned invalid JSON');
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('release endpoint returned an invalid marker');
        }
        return validateRevision(parsed.revision);
      })(),
      timedOut,
    ]);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyReleaseRevision(revision, {
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  const expectedRevision = validateRevision(revision);
  validateRetryOptions({ attempts, timeoutMs, retryDelayMs });
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const actualRevision = await fetchReleaseRevision(fetchImpl, attempt, timeoutMs);
      if (actualRevision === expectedRevision) return { revision: actualRevision, attempts: attempt };
      lastError = new Error(`live release revision is ${actualRevision}, expected ${expectedRevision}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('release verification request failed');
    }
    if (attempt < attempts && retryDelayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs));
    }
  }
  throw new Error(`live release verification failed after ${attempts} attempts: ${lastError?.message ?? 'unknown error'}`);
}

async function main() {
  const [mode, revision, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || !revision || !['write', 'verify'].includes(mode)) {
    throw new Error('usage: node scripts/release_revision.mjs <write|verify> <40-character-git-sha>');
  }
  const normalizedRevision = validateRevision(revision);
  if (mode === 'write') {
    const markerPath = await writeReleaseRevision(normalizedRevision);
    console.log(`Wrote release marker for ${normalizedRevision} to ${markerPath}`);
    return;
  }
  await verifyReleaseRevision(normalizedRevision);
  console.log(`Verified live FxAeon release revision ${normalizedRevision}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Release revision ${process.argv[2] ?? 'command'} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
