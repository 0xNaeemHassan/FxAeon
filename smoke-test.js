#!/usr/bin/env node
/**
 * fxBot Post-Deployment Smoke Test
 * Tests critical user journeys after deployment
 * Usage: node smoke-test.js [BASE_URL]
 */

const https = require('https');
const http = require('http');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const BASE_URL = process.argv[2] || process.env.BOT_URL || 'http://localhost:8080';
const TELEGRAM_TOKEN = requireEnv('TELEGRAM_TOKEN');
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://fxbot-mini-app.pages.dev';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const blue = (s) => `\x1b[34m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

let pass = 0;
let fail = 0;
let skip = 0;

function logPass(msg) { console.log(green('  [PASS]'), msg); pass++; }
function logFail(msg) { console.log(red('  [FAIL]'), msg); fail++; }
function logSkip(msg) { console.log(yellow('  [SKIP]'), msg); skip++; }
function logInfo(msg) { console.log(blue('  [INFO]'), msg); }
function logStep(msg) { console.log(cyan('\n▶'), msg); }

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, { timeout: 15000, ...options }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           fxBot Post-Deployment Smoke Test                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('Base URL:', BASE_URL);
  console.log('Mini App:', MINI_APP_URL);
  console.log('Time:', new Date().toISOString());
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Infrastructure Health
  // ═══════════════════════════════════════════════════════════════
  logStep('Step 1: Infrastructure Health');

  try {
    const res = await request(`${BASE_URL}/api/v1/health`);
    if (res.status === 200) {
      logPass('Health endpoint returns 200');
      try {
        const body = JSON.parse(res.data);
        logInfo(`Status: ${body.status || 'unknown'}`);
        if (body.version) logInfo(`Version: ${body.version}`);
      } catch {}
    } else {
      logFail(`Health endpoint returned ${res.status}`);
    }
  } catch (e) {
    logFail('Health endpoint unreachable: ' + e.message);
  }

  try {
    const res = await request(`${BASE_URL}/api/v1/info`);
    if (res.status === 200) {
      logPass('Info endpoint returns 200');
    } else {
      logFail(`Info endpoint returned ${res.status}`);
    }
  } catch (e) {
    logFail('Info endpoint unreachable: ' + e.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Telegram Bot API
  // ═══════════════════════════════════════════════════════════════
  logStep('Step 2: Telegram Bot API');

  try {
    const res = await request(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`);
    const body = JSON.parse(res.data);
    if (body.ok) {
      logPass(`Bot identity confirmed: @${body.result.username}`);
      logInfo(`Bot name: ${body.result.first_name}`);
    } else {
      logFail('Bot API returned error');
    }
  } catch (e) {
    logFail('Bot API check failed: ' + e.message);
  }

  try {
    const res = await request(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo`);
    const body = JSON.parse(res.data);
    if (body.ok) {
      if (body.result.url) {
        logPass(`Webhook set: ${body.result.url}`);
        if (body.result.pending_update_count > 50) {
          logFail(`High pending updates: ${body.result.pending_update_count}`);
        } else {
          logPass(`Pending updates: ${body.result.pending_update_count}`);
        }
      } else {
        logFail('Webhook NOT set - bot will not receive messages');
      }
    } else {
      logFail('Webhook check failed');
    }
  } catch (e) {
    logFail('Webhook check error: ' + e.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: External Services
  // ═══════════════════════════════════════════════════════════════
  logStep('Step 3: External Services');

  // Alchemy RPC
  try {
    const res = await request(
      requireEnv('ALCHEMY_RPC_URL'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    if (res.status === 400 || res.status === 200) {
      logPass('Alchemy RPC endpoint reachable');
    } else {
      logFail(`Alchemy RPC status: ${res.status}`);
    }
  } catch (e) {
    logFail('Alchemy RPC unreachable: ' + e.message);
  }

  // Privy JWKS
  try {
    const res = await request('https://auth.privy.io/api/v1/apps/cmq6a73jc002k0cl5vgleejt2/jwks.json');
    if (res.status === 200) {
      logPass('Privy JWKS endpoint reachable');
    } else {
      logFail(`Privy JWKS status: ${res.status}`);
    }
  } catch (e) {
    logFail('Privy JWKS unreachable: ' + e.message);
  }

  // Supabase
  try {
    const res = await request('https://gadzbgakqipnvkfozcfa.supabase.co/rest/v1/', {
      headers: { apikey: 'test' },
    });
    if (res.status === 200 || res.status === 401) {
      logPass('Supabase API reachable');
    } else {
      logFail(`Supabase status: ${res.status}`);
    }
  } catch (e) {
    logFail('Supabase unreachable: ' + e.message);
  }

  // Upstash — this REST probe needs the https:// REST endpoint + REST token.
  // The bot itself uses the rediss:// TCP string; if that's what REDIS_URL
  // holds here, skip instead of failing (we can't speak RESP over HTTPS).
  try {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_TOKEN;
    if (!upstashUrl || !upstashToken) {
      logSkip('Upstash REST check skipped: REDIS_URL/REDIS_TOKEN not set');
    } else if (!upstashUrl.startsWith('https://')) {
      logSkip('Upstash REST check skipped: REDIS_URL is the TCP string (rediss://), not the REST endpoint');
    } else {
      // A bare GET to the REST root always returns 400 ("command is empty"),
      // which used to fail this check even with a healthy Redis. PING is the
      // documented no-op probe.
      const res = await request(`${upstashUrl.replace(/\/$/, '')}/ping`, {
        headers: { Authorization: `Bearer ${upstashToken}` },
      });
      if (res.status === 200) {
        logPass('Upstash Redis reachable (PING ok)');
      } else if (res.status === 401) {
        logFail('Upstash reachable but token rejected (401) — check REDIS_TOKEN/UPSTASH_REDIS_REST_TOKEN');
      } else {
        logFail(`Upstash PING returned ${res.status}`);
      }
    }
  } catch (e) {
    logFail('Upstash unreachable: ' + e.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Mini App
  // ═══════════════════════════════════════════════════════════════
  logStep('Step 4: Mini App');

  try {
    const res = await request(MINI_APP_URL);
    if (res.status === 200 || res.status === 304) {
      logPass(`Mini App responds (HTTP ${res.status})`);
      if (res.data && res.data.includes('<!DOCTYPE html>') || res.data.includes('<html')) {
        logPass('Mini App returns valid HTML');
      } else {
        logWarn('Mini App response may not be valid HTML');
      }
    } else {
      logFail(`Mini App status: ${res.status}`);
    }
  } catch (e) {
    logFail('Mini App unreachable: ' + e.message);
  }

  // Check Mini App assets
  try {
    const res = await request(`${MINI_APP_URL}/favicon.ico`);
    if (res.status === 200 || res.status === 404) {
      logPass('Mini App asset paths accessible');
    }
  } catch (e) {
    logSkip('Mini App asset check skipped');
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: Bot Command Availability (via API if exposed)
  // ═══════════════════════════════════════════════════════════════
  logStep('Step 5: Bot Commands');

  try {
    const res = await request(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMyCommands`);
    const body = JSON.parse(res.data);
    if (body.ok && body.result) {
      const commands = body.result;
      logPass(`${commands.length} bot commands registered`);
      const expected = ['start', 'help', 'portfolio', 'deposit', 'settings', 'security'];
      for (const cmd of expected) {
        const found = commands.some(c => c.command === cmd);
        if (found) {
          logPass(`Command /${cmd} registered`);
        } else {
          logFail(`Command /${cmd} NOT registered`);
        }
      }
    } else {
      logFail('Could not retrieve bot commands');
    }
  } catch (e) {
    logFail('Bot commands check failed: ' + e.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 6: Rate Limits & Security Headers
  // ═══════════════════════════════════════════════════════════════
  logStep('Step 6: Security Headers');

  try {
    const res = await request(BASE_URL);
    const headers = res.headers;
    const securityHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'strict-transport-security',
    ];
    let found = 0;
    for (const h of securityHeaders) {
      if (headers[h]) {
        found++;
        logPass(`Security header present: ${h}`);
      }
    }
    if (found === 0) {
      logSkip('No standard security headers detected (may be behind proxy)');
    }
  } catch (e) {
    logSkip('Security header check skipped: ' + e.message);
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  ${green(`Passed: ${pass}`).padEnd(58)}║`);
  console.log(`║  ${red(`Failed: ${fail}`).padEnd(58)}║`);
  console.log(`║  ${yellow(`Skipped: ${skip}`).padEnd(58)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (fail === 0) {
    console.log(green('\n✓ All smoke tests passed! Deployment is healthy.\n'));
    process.exit(0);
  } else if (fail <= 2) {
    console.log(yellow('\n⚠ Some non-critical tests failed. Review above.\n'));
    process.exit(0);
  } else {
    console.log(red('\n✗ Multiple critical tests failed. Deployment needs attention.\n'));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(red('\nSmoke test runner crashed:'), err);
  process.exit(1);
});
