import assert from 'node:assert/strict';
import { test } from 'node:test';
import { secretKinds } from './verify_frontend_secrets.mjs';

test('recognizes credential shapes without returning their values', () => {
  const fake = `privy_app_secret_${'A'.repeat(32)}`;
  assert.deepEqual(secretKinds(fake), ['Privy app secret']);
  assert.deepEqual(secretKinds(`123456789:${'B'.repeat(35)}`), ['Telegram bot token']);
  assert.deepEqual(secretKinds('-----BEGIN PRIVATE KEY-----'), ['private key block']);
  assert.deepEqual(secretKinds(`ETHERSCAN_API_KEY = "${'C'.repeat(32)}"`), ['server credential literal']);
});

test('public identifiers and environment references are not credentials', () => {
  assert.deepEqual(secretKinds('NEXT_PUBLIC_PRIVY_APP_ID="cmu5tz4f000lp0cl5qtd87sro"; process.env.TELEGRAM_BOT_TOKEN'), []);
  assert.deepEqual(secretKinds('0x' + '1'.repeat(64)), []);
});
