import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const script = readFileSync(new URL('./sync_telegram_bot.mjs', import.meta.url), 'utf8');
// Git may materialize checked-in YAML with CRLF on Windows. Keep workflow
// structure assertions independent of checkout line endings.
const workflow = readFileSync(new URL('../.github/workflows/deploy-mini-app.yml', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const provider = readFileSync(new URL('../apps/mini-app/src/components/PrivyClientProvider.tsx', import.meta.url), 'utf8');

test('Telegram sync is constrained to the production static origin', () => {
  assert.match(script, /https:\/\/fxaeon\.pages\.dev/);
  assert.match(script, /hostname !== 'fxaeon\.pages\.dev'/);
  assert.match(script, /setChatMenuButton/);
  assert.match(script, /setMyCommands/);
  assert.match(script, /setMy(?:Name|ShortDescription|Description)/);
});

test('deployment sync uses only the CI secret after Pages deploy', () => {
  const deployIndex = workflow.indexOf('Wait for Cloudflare Pages deployment');
  const syncIndex = workflow.indexOf('Sync Telegram bot metadata and menu');
  assert.ok(deployIndex >= 0 && syncIndex > deployIndex);
  assert.match(workflow.slice(syncIndex), /TELEGRAM_BOT_TOKEN:\s*\$\{\{\s*secrets\.TELEGRAM_BOT_TOKEN\s*\}\}/);
  assert.doesNotMatch(workflow, /NEXT_PUBLIC_TELEGRAM_BOT_TOKEN/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(script, /Never print the token|token out of logs/i);
});

test('configured Telegram auth waits for a delayed bridge before mounting Privy', () => {
  assert.match(provider, /waitForTelegramWebApp/);
  assert.match(provider, /restoreTelegramLaunchHash\(\)/);
  assert.match(provider, /telegramBridgeSettled/);
});
