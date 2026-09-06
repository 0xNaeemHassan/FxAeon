import { pathToFileURL } from 'node:url';

/**
 * Synchronize the Telegram bot's public metadata and default Mini App menu.
 *
 * This runs only in the protected deployment job. The bot token is read from
 * the CI secret, never exposed as NEXT_PUBLIC configuration, and is excluded
 * from all diagnostics.
 */

const PRODUCTION_WEB_APP_URL = 'https://fxaeon.pages.dev';

export function validatedWebAppUrl(value = process.env.TELEGRAM_WEB_APP_URL ?? PRODUCTION_WEB_APP_URL) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Telegram Mini App URL must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'fxaeon.pages.dev') {
    throw new Error('Telegram Mini App URL must use https://fxaeon.pages.dev');
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

async function callBotApi(token, method, payload) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`Telegram Bot API ${method} request failed`);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Telegram Bot API ${method} returned an invalid response`);
  }
  if (!response.ok || result?.ok !== true) {
    throw new Error(`Telegram Bot API ${method} failed with HTTP ${response.status}`);
  }
}

export async function syncTelegramBot({ token = requiredToken(), webAppUrl = validatedWebAppUrl() } = {}) {
  const metadata = {
    name: 'FxAeon',
    shortDescription: 'Non-custodial f(x) markets in a Telegram Mini App.',
    description: 'Explore official f(x) markets, review every transaction, and keep signing in your own wallet. FxAeon never receives your private keys.',
  };
  await callBotApi(token, 'setMyName', { name: metadata.name });
  await callBotApi(token, 'setMyShortDescription', { short_description: metadata.shortDescription });
  await callBotApi(token, 'setMyDescription', { description: metadata.description });
  await callBotApi(token, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Open FxAeon' },
      { command: 'app', description: 'Open the FxAeon Mini App' },
      { command: 'help', description: 'Show FxAeon help' },
    ],
  });
  await callBotApi(token, 'setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Open FxAeon',
      web_app: { url: webAppUrl },
    },
  });
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
