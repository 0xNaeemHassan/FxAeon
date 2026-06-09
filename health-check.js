#!/usr/bin/env node
/**
 * fxBot Health Check - Node.js version
 * Usage: node health-check.js [BASE_URL]
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.argv[2] || process.env.BOT_URL || 'http://localhost:8080';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'process.env.TELEGRAM_BOT_TOKEN || "YOUR_BOT_TOKEN"';

const CREDENTIALS = {
  alchemy: 'process.env.ALCHEMY_API_KEY || "YOUR_ALCHEMY_KEY"',
  privyAppId: 'process.env.PRIVY_APP_ID || "YOUR_PRIVY_APP_ID"',
  supabaseUrl: 'https://process.env.SUPABASE_PROJECT || "YOUR_SUPABASE_PROJECT".supabase.co',
  upstashUrl: 'https://allowed-honeybee-114181.upstash.io',
  upstashToken: 'process.env.UPSTASH_TOKEN || "YOUR_UPSTASH_TOKEN"',
};

let pass = 0;
let fail = 0;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const blue = (s) => `\x1b[34m${s}\x1b[0m`;

function logPass(msg) { console.log(green('[PASS]'), msg); pass++; }
function logFail(msg) { console.log(red('[FAIL]'), msg); fail++; }
function logInfo(msg) { console.log(blue('[INFO]'), msg); }
function logWarn(msg) { console.log(yellow('[WARN]'), msg); }

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, { timeout: 10000, ...options }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function checkHealth() {
  console.log('=== fxBot Health Check ===');
  console.log('Base URL:', BASE_URL);
  console.log('Time:', new Date().toISOString());
  console.log('');

  // 1. Bot health
  console.log('--- Bot Health ---');
  try {
    const res = await request(`${BASE_URL}/api/v1/health`);
    if (res.status === 200) {
      logPass('Health endpoint responds (200)');
      logInfo('Response: ' + res.data.slice(0, 200));
    } else {
      logFail(`Health endpoint failed (HTTP ${res.status})`);
    }
  } catch (e) {
    logFail('Health endpoint unreachable: ' + e.message);
  }

  // 2. Bot info
  console.log('');
  console.log('--- Bot Info ---');
  try {
    const res = await request(`${BASE_URL}/api/v1/info`);
    if (res.status === 200) {
      logPass('Info endpoint responds (200)');
    } else {
      logFail(`Info endpoint failed (HTTP ${res.status})`);
    }
  } catch (e) {
    logFail('Info endpoint unreachable: ' + e.message);
  }

  // 3. Telegram webhook
  console.log('');
  console.log('--- Telegram Webhook ---');
  try {
    const res = await request(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo`);
    const body = JSON.parse(res.data);
    if (body.ok) {
      logPass('Telegram webhook is set');
      logInfo(`URL: ${body.result.url}`);
      logInfo(`Pending updates: ${body.result.pending_update_count}`);
      if (body.result.pending_update_count > 100) {
        logWarn(`High pending count: ${body.result.pending_update_count}`);
      }
    } else {
      logFail('Telegram webhook not configured');
    }
  } catch (e) {
    logFail('Telegram API check failed: ' + e.message);
  }

  // 4. Alchemy RPC
  console.log('');
  console.log('--- Ethereum RPC ---');
  try {
    const res = await request(
      `https://eth-mainnet.g.alchemy.com/v2/${CREDENTIALS.alchemy}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    // Note: POST without body will fail, but connection test passes if we get any response
    if (res.status === 400 || res.status === 200) {
      logPass('Alchemy RPC endpoint reachable');
    } else {
      logFail(`Alchemy RPC unexpected status: ${res.status}`);
    }
  } catch (e) {
    logFail('Alchemy RPC unreachable: ' + e.message);
  }

  // 5. Mini App
  console.log('');
  console.log('--- Mini App ---');
  try {
    const miniUrl = process.env.MINI_APP_URL || 'https://fxbot-mini-app.pages.dev';
    const res = await request(miniUrl);
    if (res.status === 200 || res.status === 304) {
      logPass(`Mini App responds (HTTP ${res.status})`);
    } else {
      logFail(`Mini App not responding (HTTP ${res.status})`);
    }
  } catch (e) {
    logFail('Mini App unreachable: ' + e.message);
  }

  // 6. Privy JWKS
  console.log('');
  console.log('--- Privy Auth ---');
  try {
    const res = await request(`https://auth.privy.io/api/v1/apps/${CREDENTIALS.privyAppId}/jwks.json`);
    if (res.status === 200) {
      logPass('Privy JWKS endpoint responds (200)');
    } else {
      logFail(`Privy JWKS failed (HTTP ${res.status})`);
    }
  } catch (e) {
    logFail('Privy JWKS unreachable: ' + e.message);
  }

  // 7. Supabase
  console.log('');
  console.log('--- Supabase ---');
  try {
    const res = await request(`${CREDENTIALS.supabaseUrl}/rest/v1/`, {
      headers: { apikey: 'test' },
    });
    if (res.status === 200 || res.status === 401) {
      logPass(`Supabase API responds (HTTP ${res.status})`);
    } else {
      logFail(`Supabase API not responding (HTTP ${res.status})`);
    }
  } catch (e) {
    logFail('Supabase unreachable: ' + e.message);
  }

  // 8. Upstash
  console.log('');
  console.log('--- Upstash Redis ---');
  try {
    const res = await request(CREDENTIALS.upstashUrl, {
      headers: { Authorization: `Bearer ${CREDENTIALS.upstashToken}` },
    });
    if (res.status === 200 || res.status === 401) {
      logPass(`Upstash Redis responds (HTTP ${res.status})`);
    } else {
      logFail(`Upstash Redis not responding (HTTP ${res.status})`);
    }
  } catch (e) {
    logFail('Upstash Redis unreachable: ' + e.message);
  }

  // Summary
  console.log('');
  console.log('========================================');
  console.log(green(`Passed: ${pass}`));
  console.log(red(`Failed: ${fail}`));
  console.log('========================================');

  if (fail === 0) {
    console.log(green('All checks passed! System is healthy.'));
    process.exit(0);
  } else {
    console.log(red('Some checks failed. Review issues above.'));
    process.exit(1);
  }
}

checkHealth();
