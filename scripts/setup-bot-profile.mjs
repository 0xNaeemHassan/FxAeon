#!/usr/bin/env node
/**
 * Set the bot's public identity on Telegram — name, bio (short description),
 * description, command list and the Mini App menu button — via the Bot API so
 * it is reproducible and reviewable (no manual BotFather clicking for the text).
 *
 * The bot profile PHOTO is the one thing the Bot API cannot set; upload
 * brand/fxaeon-avatar.png to @BotFather → /setuserpic (one-time, by the owner).
 *
 * Usage:
 *   BOT_TOKEN=123:abc node scripts/setup-bot-profile.mjs           # apply
 *   BOT_TOKEN=123:abc node scripts/setup-bot-profile.mjs --dry     # print only
 *
 * MINI_APP_URL overrides the menu-button target (default: the prod Pages URL).
 */
const TOKEN = process.env.BOT_TOKEN;
const DRY = process.argv.includes("--dry");
const MINI_APP_URL = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev/";

if (!TOKEN) {
  console.error("BOT_TOKEN env var is required");
  process.exit(1);
}

// Telegram limits: name<=64, short_description<=120, description<=512.
const NAME = "FxAeon";

const SHORT_DESCRIPTION =
  "Trade f(x) Protocol from Telegram — leverage, fxUSD mint & fxSAVE yield. Non-custodial: your keys, your wallet (Privy).";

const DESCRIPTION =
  "FxAeon brings f(x) Protocol to Telegram.\n\n" +
  "• Open leveraged long/short positions on ETH & BTC\n" +
  "• Mint fxUSD and earn yield with fxSAVE\n" +
  "• Limit orders, stop-loss / take-profit automation & price alerts\n" +
  "• Live gas, prices and your full on-chain history\n\n" +
  "Your wallet is yours: keys live in Privy's secure enclave — FxAeon never " +
  "holds your funds and bot trading is a revocable, simulate-before-send grant.\n\n" +
  "Tap Start to set up your wallet.";

const COMMANDS = [
  ["start", "Set up your wallet & get started"],
  ["portfolio", "View portfolio, positions & PnL"],
  ["trade", "Open a leveraged long/short"],
  ["limit", "Place a limit order"],
  ["orders", "View & manage active orders"],
  ["auto", "Stop-loss / take-profit automation"],
  ["mint", "Mint fxUSD"],
  ["save", "Earn yield with fxSAVE"],
  ["redeem", "Redeem fxSAVE to fxUSD"],
  ["claim", "Claim a matured fxSAVE redemption"],
  ["borrow", "Borrow against collateral"],
  ["repay", "Repay a loan"],
  ["deposit", "Deposit funds"],
  ["withdraw", "Withdraw funds"],
  ["bridge", "Bridge assets to Base"],
  ["price", "Market overview (live prices)"],
  ["gas", "Live gas prices"],
  ["alert", "Set a one-shot price alert"],
  ["alerts", "Manage your price alerts"],
  ["history", "Your on-chain history"],
  ["lock", "Lock governance tokens"],
  ["vote", "Vote on proposals"],
  ["refer", "Referral program"],
  ["settings", "Bot settings"],
  ["security", "Security settings"],
  ["help", "Help & full command list"],
];

async function call(method, body) {
  if (DRY) {
    console.log(`DRY ${method}`, JSON.stringify(body).slice(0, 200));
    return { ok: true };
  }
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method} failed: ${JSON.stringify(json)}`);
  console.log(`✓ ${method}`);
  return json;
}

async function main() {
  if (NAME.length > 64) throw new Error("name too long");
  if (SHORT_DESCRIPTION.length > 120)
    throw new Error(`short_description too long (${SHORT_DESCRIPTION.length})`);
  if (DESCRIPTION.length > 512) throw new Error(`description too long (${DESCRIPTION.length})`);

  await call("setMyName", { name: NAME });
  await call("setMyShortDescription", { short_description: SHORT_DESCRIPTION });
  await call("setMyDescription", { description: DESCRIPTION });
  await call("setMyCommands", {
    commands: COMMANDS.map(([command, description]) => ({ command, description })),
  });
  await call("setChatMenuButton", {
    menu_button: { type: "web_app", text: "Open FxAeon", web_app: { url: MINI_APP_URL } },
  });
  console.log("\nDone. Bot profile updated.");
  console.log("Remaining manual step (Bot API can't set a profile photo):");
  console.log("  @BotFather → /setuserpic → @FxAeonBot → upload brand/fxaeon-avatar.png");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
