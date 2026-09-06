const CHECK_NAME = 'Cloudflare Pages: fxaeon';
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

const token = required('GITHUB_TOKEN');
const repository = required('GITHUB_REPOSITORY');
const sha = required('GITHUB_SHA');
const timeoutMs = positiveNumber('CLOUDFLARE_CHECK_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
const intervalMs = positiveNumber('CLOUDFLARE_CHECK_INTERVAL_MS', DEFAULT_INTERVAL_MS);
const endpoint = `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`;
const startedAt = Date.now();

async function readCheckRuns() {
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

function newestRun(runs) {
  return [...runs].sort((left, right) => {
    const leftAt = Date.parse(left.completed_at ?? left.started_at ?? left.created_at ?? '') || 0;
    const rightAt = Date.parse(right.completed_at ?? right.started_at ?? right.created_at ?? '') || 0;
    return rightAt - leftAt;
  })[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

while (true) {
  const run = newestRun((await readCheckRuns()).filter((candidate) => candidate.name === CHECK_NAME));
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
