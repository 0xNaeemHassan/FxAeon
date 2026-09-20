import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The financial workflow supplies this explicitly so a separate landing
// project check cannot accidentally authorize the financial release.
const CHECK_NAME = process.env.CLOUDFLARE_CHECK_NAME?.trim() || 'Cloudflare Pages';
const PROJECT_NAME = process.env.CLOUDFLARE_PAGES_PROJECT?.trim() || 'fxaeon';
const TARGET_CHECK_NAMES = new Set([CHECK_NAME, `${CHECK_NAME}: ${PROJECT_NAME}`]);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 1000;
const TERMINAL_FAILURES = new Set([
  'action_required',
  'cancelled',
  'failure',
  'stale',
  'timed_out',
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

async function readCheckRuns({ token, endpoint, timeoutMs, startedAt }) {
  const remainingMs = timeoutMs - (Date.now() - startedAt);
  if (remainingMs <= 0) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${CHECK_NAME}.`);
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'FxAeon-cloudflare-deployment-gate',
    },
    signal: AbortSignal.timeout(Math.min(15_000, remainingMs)),
  });
  if (!response.ok) throw new Error(`GitHub check-runs API returned HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.check_runs) ? payload.check_runs : [];
}

export function isTargetCloudflareRun(run) {
  if (!TARGET_CHECK_NAMES.has(run?.name) || typeof run?.details_url !== 'string') return false;
  try {
    const detailsUrl = new URL(run.details_url);
    if (detailsUrl.protocol !== 'https:'
      || detailsUrl.hostname !== 'dash.cloudflare.com'
      || detailsUrl.username
      || detailsUrl.password
      || detailsUrl.port
      || detailsUrl.hash) return false;

    let route;
    if (detailsUrl.search) {
      // Cloudflare's native check links use a relative dashboard route in
      // `to`. Requiring its literal, sole query parameter rejects encoded or
      // external redirect targets while accepting the native URL shape.
      if (detailsUrl.pathname !== '/') return false;
      const targets = detailsUrl.searchParams.getAll('to');
      if (targets.length !== 1 || detailsUrl.searchParams.size !== 1) return false;
      route = targets[0];
      if (detailsUrl.search !== `?to=${route}`) return false;
    } else {
      // Retain support for Cloudflare links that put the route in the path.
      route = detailsUrl.pathname;
    }

    const segments = route.split('/');
    return segments.length === 6
      && segments[0] === ''
      && /^[A-Za-z0-9_-]+$/.test(segments[1])
      && segments[2] === 'pages'
      && segments[3] === 'view'
      && segments[4] === PROJECT_NAME
      && /^[A-Za-z0-9_-]+$/.test(segments[5]);
  } catch {
    return false;
  }
}

export function newestRun(runs) {
  return [...runs].sort((left, right) => {
    const leftAt = Date.parse(left.completed_at ?? left.started_at ?? left.created_at ?? '') || 0;
    const rightAt = Date.parse(right.completed_at ?? right.started_at ?? right.created_at ?? '') || 0;
    return rightAt - leftAt;
  })[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const token = required('GITHUB_TOKEN');
  const repository = required('GITHUB_REPOSITORY');
  const sha = required('GITHUB_SHA');
  const timeoutMs = positiveNumber('CLOUDFLARE_CHECK_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const intervalMs = positiveNumber('CLOUDFLARE_CHECK_INTERVAL_MS', DEFAULT_INTERVAL_MS);
  const endpoint = `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`;
  const startedAt = Date.now();
  while (true) {
    const run = newestRun((await readCheckRuns({ token, endpoint, timeoutMs, startedAt })).filter(isTargetCloudflareRun));
    if (run?.status === 'completed') {
      if (run.conclusion === 'success') {
        console.log(`${CHECK_NAME} succeeded for ${sha}.`);
        break;
      }
      const conclusion = run.conclusion ?? 'unknown';
      if (TERMINAL_FAILURES.has(conclusion)) throw new Error(`${CHECK_NAME} finished with conclusion ${conclusion}.`);
      throw new Error(`${CHECK_NAME} finished without success (conclusion ${conclusion}).`);
    }
    if (run) console.log(`${CHECK_NAME} is ${run.status}; waiting for the native deployment.`);
    else console.log(`Waiting for ${CHECK_NAME} to appear for ${sha}.`);
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${CHECK_NAME}.`);
    await sleep(Math.min(intervalMs, timeoutMs - (Date.now() - startedAt)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
