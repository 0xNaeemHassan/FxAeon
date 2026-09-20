import { pathToFileURL } from 'node:url';

/**
 * Synchronize the Telegram bot's public metadata and default Mini App menu.
 *
 * This runs only in the protected deployment job. The bot token is read from
 * the CI secret, never exposed as NEXT_PUBLIC configuration, and is excluded
 * from all diagnostics.
 */

const PRODUCTION_WEB_APP_URL = 'https://fxaeon.com/';
const ALLOWED_WEB_APP_HOSTS = new Set(['fxaeon.com', 'fxaeon.pages.dev']);
const TELEGRAM_API_ROOT = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;

export function validatedWebAppUrl(value = process.env.TELEGRAM_WEB_APP_URL ?? PRODUCTION_WEB_APP_URL) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Telegram Mini App URL must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || !ALLOWED_WEB_APP_HOSTS.has(url.hostname)) {
    throw new Error('Telegram Mini App URL must use https://fxaeon.com (or the fxaeon.pages.dev Pages preview origin)');
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Telegram Mini App URL cannot include credentials, a port, query, or fragment');
  }
  return url.toString().replace(/\/$/, '');
}

function requiredToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required for the deployment sync');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error('TELEGRAM_BOT_TOKEN has an invalid format');
  }
  return token;
}

async function callBotApi(token, method, payload, {
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Telegram Bot API fetch is unavailable');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Telegram Bot API timeout must be positive');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let result;
  try {
    response = await fetchImpl(`${TELEGRAM_API_ROOT}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    result = await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Telegram Bot API ${method} request timed out`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Telegram Bot API ${method} returned an invalid response`);
    }
    throw new Error(`Telegram Bot API ${method} request failed`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok || result?.ok !== true) {
    throw new Error(`Telegram Bot API ${method} failed with HTTP ${response?.status ?? 'unknown'}`);
  }
  return result.result;
}

function matches(expected, actual) {
  if (Object.is(expected, actual)) return true;
  if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object') return false;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    return Array.isArray(expected) && Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((value, index) => matches(value, actual[index]));
  }
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  return expectedKeys.length === actualKeys.length
    && expectedKeys.every((key) => Object.hasOwn(actual, key) && matches(expected[key], actual[key]));
}

export async function syncTelegramBot({
  token = requiredToken(),
  webAppUrl = validatedWebAppUrl(),
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const validatedMenuUrl = validatedWebAppUrl(webAppUrl);
  const metadata = {
    name: 'FxAeon',
    shortDescription: 'Positions, fxSAVE, and fxUSD on Ethereum.',
    description: 'Open long or short positions, earn with fxSAVE, and borrow fxUSD on Ethereum. Move assets between Ethereum and Base. Built with f(x) SDK. Review every transaction and sign with your own wallet. FxAeon never receives your private keys. Open: https://fxaeon.com/ Docs: https://fxaeon.com/docs',
  };
  const requestOptions = { fetchImpl, timeoutMs };
  const request = (method, payload) => callBotApi(token, method, payload, requestOptions);
  const verify = async (writeMethod, writePayload, readMethod, expected) => {
    await request(writeMethod, writePayload);
    const actual = await request(readMethod, {});
    if (!matches(expected, actual)) {
      throw new Error(`Telegram Bot API ${readMethod} readback mismatch`);
    }
  };

  await verify('setMyName', { name: metadata.name }, 'getMyName', { name: metadata.name });
  await verify('setMyShortDescription', { short_description: metadata.shortDescription }, 'getMyShortDescription', { short_description: metadata.shortDescription });
  await verify('setMyDescription', { description: metadata.description }, 'getMyDescription', { description: metadata.description });

  // FxAeon has no Telegram command handler. An empty default list removes
  // stale command suggestions instead of advertising commands that do nothing.
  await verify('setMyCommands', { commands: [] }, 'getMyCommands', []);

  const menuButton = {
    type: 'web_app',
    text: 'Open FxAeon',
    web_app: { url: validatedMenuUrl },
  };
  await verify('setChatMenuButton', { menu_button: menuButton }, 'getChatMenuButton', menuButton);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const webAppUrl = validatedWebAppUrl();
    await syncTelegramBot({ token: requiredToken(), webAppUrl });
    console.log(`Telegram bot metadata and Mini App menu synchronized for ${webAppUrl}.`);
  } catch (error) {
    // Never print the token or the Bot API URL. The generic message is useful
    // in CI while keeping the secret out of logs and failure annotations.
    console.error(`Telegram bot synchronization failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}
