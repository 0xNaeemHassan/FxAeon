import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  validateRevision,
  verifyReleaseRevision,
  writeReleaseRevision,
} from './release_revision.mjs';

const EXPECTED = '0123456789abcdef0123456789abcdef01234567';
const STALE = 'fedcba9876543210fedcba9876543210fedcba98';

function response(body, options = {}) {
  return {
    status: options.status ?? 200,
    redirected: options.redirected ?? false,
    url: options.url ?? 'https://fxaeon.com/release.json',
    text: async () => body,
  };
}

test('revision validation requires exactly forty hexadecimal characters', () => {
  assert.equal(validateRevision(EXPECTED.toUpperCase()), EXPECTED);
  for (const invalid of ['', 'abc', `${EXPECTED}0`, `${EXPECTED.slice(0, -1)}g`, undefined]) {
    assert.throws(() => validateRevision(invalid), /40-character hexadecimal Git SHA/);
  }
});

test('write emits only the validated revision into an existing mini-app dist directory', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'fxaeon-release-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const distDir = join(rootDir, 'apps', 'mini-app', 'dist');
  await mkdir(distDir, { recursive: true });

  const markerPath = await writeReleaseRevision(EXPECTED.toUpperCase(), { rootDir });
  assert.equal(markerPath, join(distDir, 'release.json'));
  assert.deepEqual(JSON.parse(await readFile(markerPath, 'utf8')), { revision: EXPECTED });
  await assert.rejects(writeReleaseRevision('nope', { rootDir }), /40-character hexadecimal Git SHA/);
});

test('write refuses to create a missing production build directory', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'fxaeon-release-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(writeReleaseRevision(EXPECTED, { rootDir }), /production build directory does not exist/);
});

test('verify retries stale content and succeeds only on the requested revision', async () => {
  const calls = [];
  const result = await verifyReleaseRevision(EXPECTED, {
    attempts: 3,
    retryDelayMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return response(JSON.stringify({ revision: calls.length === 1 ? STALE : EXPECTED }));
    },
  });

  assert.deepEqual(result, { revision: EXPECTED, attempts: 2 });
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://fxaeon.com');
    assert.equal(url.pathname, '/release.json');
    assert.ok(url.searchParams.get('release_check'));
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
  }
  assert.notEqual(calls[0].url.search, calls[1].url.search);
});

test('verify never passes on persistent mismatch, malformed marker, redirect, or fetch failure', async (t) => {
  const cases = [
    ['stale revision', async () => response(JSON.stringify({ revision: STALE }))],
    ['malformed JSON', async () => response('{')],
    ['non-success HTTP status', async () => response(JSON.stringify({ revision: EXPECTED }), { status: 302 })],
    ['redirect response', async () => response(JSON.stringify({ revision: EXPECTED }), { redirected: true })],
    ['unexpected final URL', async () => response(JSON.stringify({ revision: EXPECTED }), { url: 'https://attacker.example/release.json' })],
    ['fetch failure', async () => { throw new Error('network down'); }],
  ];
  for (const [name, fetchImpl] of cases) {
    await t.test(name, async () => {
      await assert.rejects(verifyReleaseRevision(EXPECTED, {
        attempts: 2,
        retryDelayMs: 0,
        fetchImpl,
      }), /live release verification failed after 2 attempts/);
    });
  }
});

test('verify has a bounded timeout even when the fetch implementation ignores abort', async () => {
  await assert.rejects(verifyReleaseRevision(EXPECTED, {
    attempts: 2,
    timeoutMs: 10,
    retryDelayMs: 0,
    fetchImpl: () => new Promise(() => {}),
  }), /timed out after 10ms/);
});
