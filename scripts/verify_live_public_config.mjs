const DEFAULT_APP_URL = 'https://fxaeon.pages.dev/';
const DEFAULT_ATTEMPTS = 18;
const DEFAULT_INTERVAL_MS = 10_000;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function sameOriginJavaScriptUrls(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const urls = new Set();
  const attribute = /(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/giu;
  for (const match of html.matchAll(attribute)) {
    const url = new URL(match[1], pageUrl);
    if (url.origin === origin) urls.add(url.href);
  }
  return [...urls];
}

async function fetchText(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'User-Agent': 'FxAeon-live-config-verifier' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`deployment returned HTTP ${response.status}`);
  return response.text();
}

async function deploymentContains(pageUrl, expectedValue, revision) {
  const root = new URL(pageUrl);
  root.searchParams.set('deployment', revision);
  const html = await fetchText(root);
  if (html.includes(expectedValue)) return true;

  const scripts = sameOriginJavaScriptUrls(html, root);
  if (scripts.length === 0) throw new Error('deployment HTML did not reference any same-origin JavaScript');
  const sources = await Promise.all(scripts.slice(0, 100).map(fetchText));
  return sources.some((source) => source.includes(expectedValue));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const appUrl = process.env.LIVE_APP_URL?.trim() || DEFAULT_APP_URL;
const expectedPrivyAppId = required('EXPECTED_PUBLIC_PRIVY_APP_ID');
const revision = required('GITHUB_SHA');
const attempts = positiveInteger('LIVE_CONFIG_ATTEMPTS', DEFAULT_ATTEMPTS);
const intervalMs = positiveInteger('LIVE_CONFIG_INTERVAL_MS', DEFAULT_INTERVAL_MS);

const parsedUrl = new URL(appUrl);
if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'fxaeon.pages.dev') {
  throw new Error('LIVE_APP_URL must be https://fxaeon.pages.dev');
}

let lastError;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    if (await deploymentContains(parsedUrl, expectedPrivyAppId, revision)) {
      console.log('Live FxAeon bundle contains the expected public wallet configuration.');
      process.exit(0);
    }
    lastError = new Error('live bundle does not contain the expected public wallet configuration');
  } catch (error) {
    lastError = error;
  }
  if (attempt < attempts) await sleep(intervalMs);
}

throw new Error(`Live deployment configuration check failed: ${lastError?.message ?? 'unknown error'}`);
