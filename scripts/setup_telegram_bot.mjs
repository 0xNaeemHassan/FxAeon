/**
 * Automated Telegram Bot Configuration Script
 *
 * Configures commands, persistent WebApp launch menu button, and marketing copy
 * directly with the Telegram Bot API.
 *
 * Usage: node scripts/setup_telegram_bot.mjs [BOT_TOKEN] [MINI_APP_URL]
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, '..', '.env') });
loadEnv({ path: path.join(__dirname, '..', 'apps', 'bot', '.env') });

const BOT_TOKEN = process.argv[2] || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const MINI_APP_URL = process.argv[3] || process.env.NEXT_PUBLIC_MINI_APP_URL || 'https://fxaeon.app';

if (!BOT_TOKEN) {
  console.log('ℹ No BOT_TOKEN provided. Run with: node scripts/setup_telegram_bot.mjs <BOT_TOKEN> <MINI_APP_URL>');
  process.exit(0);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tgPost(method, body) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`✖ Telegram API error for ${method}:`, data.description);
    return false;
  }
  console.log(`✔ Success: ${method}`);
  return true;
}

async function setup() {
  console.log('🤖 Configuring Telegram Bot for FxAeon...\n');

  // 1. Configure Persistent WebApp Menu Button
  console.log(`Setting WebApp Menu Button to: ${MINI_APP_URL}`);
  await tgPost('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: '🚀 Launch FxAeon',
      web_app: { url: MINI_APP_URL },
    },
  });

  // 2. Register Bot Commands
  console.log('Registering Bot Slash Commands...');
  await tgPost('setMyCommands', {
    commands: [
      { command: 'start', description: 'Launch FxAeon and view trading dashboard' },
      { command: 'trade', description: 'Open or build a leveraged position' },
      { command: 'portfolio', description: 'View real-time balances and position health' },
      { command: 'radar', description: 'Scan fxUSD peg discount & arbitrage opportunities' },
      { command: 'whales', description: 'Live smart-money $50k+ transaction stream' },
      { command: 'leaderboard', description: 'View community top PnL traders' },
      { command: 'quests', description: 'Season 1 Pilot achievements and XP rewards' },
      { command: 'save', description: 'Deposit fxUSD in stability pool for real yield' },
      { command: 'borrow', description: 'Mint fxUSD against crypto collateral' },
      { command: 'help', description: 'Full documentation and security guidelines' },
    ],
  });

  // 3. Set Short Description
  await tgPost('setMyShortDescription', {
    short_description: 'Next-gen mobile gateway for f(x) Protocol on Ethereum & Base. Self-custodial trading, borrowing, stability vaults, and instant peg arbitrage.',
  });

  // 4. Set Full Description
  await tgPost('setMyDescription', {
    description: `⚡ Welcome to FxAeon — the next-generation gateway to f(x) Protocol.\n\n` +
      `📈 Trade up to 10× leverage on wstETH & WBTC\n` +
      `🪙 Earn real yield in fxSAVE Stability Pools\n` +
      `🛡️ Automated Liquidation Guardian & Biometrics\n` +
      `🌉 Zero-friction bridging between Ethereum & Base\n\n` +
      `Self-custodial via Privy embedded wallets. Tap the button below to start trading!`,
  });

  console.log('\n🎉 Telegram Bot configuration complete!');
}

setup().catch(console.error);
