import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { Bot, Context, GrammyError, HttpError, webhookCallback } from "grammy";
import { getTelegramWebhookSecret } from "./utils/webhookAuth.js";
import type { RequestWithRawBody } from "./utils/webhookAuth.js";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { conversations, type ConversationFlavor } from "@grammyjs/conversations";
import { prisma } from "@fxbot/db";

import {
  startCommand, portfolioCommand, tradeCommand, limitCommand,
  ordersCommand, mintCommand, redeemCommand, saveCommand,
  borrowCommand, repayCommand, bridgeCommand, lockCommand,
  voteCommand, claimCommand, referCommand, autoCommand,
  settingsCommand, securityCommand, depositCommand, withdrawCommand,
  helpCommand,
} from "./commands/index.js";

import { apiRouter } from "./api/index.js";
import { applySecurityMiddleware, errorHandler } from "./middleware/index.js";
import { validateConfig } from "./middleware/config.js";
import { logger } from "./middleware/logger.js";
import { privyWebhookHandler } from "./handlers/privy-webhooks.js";
import { limitOrderPolling } from "./notifications/limit-order-poller.js";
import { healthMonitor } from "./notifications/health-monitor.js";
import { txNotifier } from "./notifications/tx-notifier.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const env = validateConfig();

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------
type BotContext = Context & ConversationFlavor<Context>;

const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Rate limiting: 30 msg/s global, 1 msg/s per user
bot.api.config.use(apiThrottler({
  global: { reservoir: 30, reservoirRefreshAmount: 30, reservoirRefreshInterval: 1000 },
  group: { reservoir: 20, reservoirRefreshAmount: 20, reservoirRefreshInterval: 60_000 },
  out: { maxConcurrent: 1, minTime: 1000 },
}));

// Conversations
bot.use(conversations());

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
bot.command("start", startCommand);
bot.command("portfolio", portfolioCommand);
bot.command("trade", tradeCommand);
bot.command("limit", limitCommand);
bot.command("orders", ordersCommand);
bot.command("mint", mintCommand);
bot.command("redeem", redeemCommand);
bot.command("save", saveCommand);
bot.command("borrow", borrowCommand);
bot.command("repay", repayCommand);
bot.command("bridge", bridgeCommand);
bot.command("lock", lockCommand);
bot.command("vote", voteCommand);
bot.command("claim", claimCommand);
bot.command("refer", referCommand);
bot.command("auto", autoCommand);
bot.command("settings", settingsCommand);
bot.command("security", securityCommand);
bot.command("deposit", depositCommand);
bot.command("withdraw", withdrawCommand);
bot.command("help", helpCommand);

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
bot.catch((err) => {
  const ctx = err.ctx;
  logger.error({ updateId: ctx.update.update_id }, "Error handling update");
  const e = err.error;
  if (e instanceof GrammyError) {
    logger.error({ description: e.description }, "Grammy error");
  } else if (e instanceof HttpError) {
    logger.error({ error: e }, "Could not contact Telegram");
  } else {
    logger.error({ error: e }, "Unknown error");
  }
});

// ---------------------------------------------------------------------------
// Telegram bot menu & commands list
// ---------------------------------------------------------------------------
async function configureTelegramBot() {
  // Register command list with Telegram so users see a menu
  await bot.api.setMyCommands([
    { command: "start", description: "Start / connect wallet" },
    { command: "portfolio", description: "View portfolio & positions" },
    { command: "trade", description: "Open a leveraged trade" },
    { command: "limit", description: "Set a limit order" },
    { command: "orders", description: "View active orders" },
    { command: "mint", description: "Mint fxUSD" },
    { command: "redeem", description: "Redeem fxUSD" },
    { command: "save", description: "Earn yield on fxUSD" },
    { command: "borrow", description: "Borrow against collateral" },
    { command: "repay", description: "Repay a loan" },
    { command: "deposit", description: "Deposit funds" },
    { command: "withdraw", description: "Withdraw funds" },
    { command: "bridge", description: "Bridge assets cross-chain" },
    { command: "lock", description: "Lock governance tokens" },
    { command: "vote", description: "Vote on proposals" },
    { command: "claim", description: "Claim rewards" },
    { command: "refer", description: "Referral program" },
    { command: "auto", description: "Automation settings" },
    { command: "settings", description: "Bot settings" },
    { command: "security", description: "Security settings" },
    { command: "help", description: "Help & commands" },
  ]);
  logger.info("Bot command menu registered");

  // Set mini-app menu button (opens the mini-app inside Telegram)
  const miniAppUrl = env.MINI_APP_URL;
  if (miniAppUrl) {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Open App",
        web_app: { url: miniAppUrl },
      },
    });
    logger.info({ url: miniAppUrl }, "Mini-app menu button set");
  }
}

// ---------------------------------------------------------------------------
// Background workers (with graceful error handling)
// ---------------------------------------------------------------------------
function startBackgroundWorkers() {
  // Delay worker start to let connections settle
  setTimeout(() => {
    try { limitOrderPolling.start(); } catch (e) { logger.error(e, "Failed to start limit order polling"); }
    try { healthMonitor.start(); } catch (e) { logger.error(e, "Failed to start health monitor"); }
    try { txNotifier.start(); } catch (e) { logger.error(e, "Failed to start tx notifier"); }
  }, 5000);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  if (env.NODE_ENV === "production") {
    // ------ Webhook mode (production) ------
    const port = parseInt(env.PORT, 10);

    const app = express();

    // Apply full security middleware (helmet, cors, rate limiter, request logging)
    applySecurityMiddleware(app);

    // Parse JSON bodies (needed for webhook + API routes).
    // Capture the raw body so webhook signatures can be verified over the
    // exact bytes received (AUDIT.md P0-5).
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as RequestWithRawBody).rawBody = buf;
        },
      })
    );

    // Telegram webhook endpoint — must be BEFORE apiRouter.
    // secretToken: grammY rejects updates whose
    // X-Telegram-Bot-Api-Secret-Token header does not match (AUDIT.md P0-5).
    const telegramWebhookSecret = getTelegramWebhookSecret();
    app.post("/webhook", webhookCallback(bot, "express", { secretToken: telegramWebhookSecret }));

    // Privy webhook
    app.post("/privy-webhook", privyWebhookHandler);

    // API routes (health, simulate, webhook verification, etc.)
    app.use("/api", apiRouter);

    // Simple health check at root /health (fallback for quick pings)
    app.get("/health", (_req, res) => {
      res.json({ ok: true, timestamp: new Date().toISOString() });
    });

    // Render expects /api/v1/health — add a direct alias
    app.get("/api/v1/health", (_req, res) => {
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "1.1.0",
        uptime: process.uptime(),
      });
    });

    // Error handler (must be last)
    app.use(errorHandler);

    app.listen(port, async () => {
      logger.info({ port }, "Express server listening");

      // Register webhook with Telegram
      // Render provides RENDER_EXTERNAL_URL; fall back to WEBHOOK_URL env var
      const webhookDomain = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
      if (webhookDomain) {
        const webhookUrl = `${webhookDomain}/webhook`;
        await bot.api.setWebhook(webhookUrl, {
          allowed_updates: ["message", "callback_query", "inline_query"],
          drop_pending_updates: true,
          secret_token: telegramWebhookSecret,
        });
        logger.info({ webhookUrl }, "Telegram webhook registered");
      } else {
        logger.warn(
          "No RENDER_EXTERNAL_URL or WEBHOOK_URL set — Telegram webhook NOT registered! " +
          "The bot will not receive messages."
        );
      }

      // Configure bot menu & mini-app button
      await configureTelegramBot().catch((e) =>
        logger.error(e, "Failed to configure Telegram bot menu")
      );

      // Start background workers (delayed)
      startBackgroundWorkers();
    });
  } else {
    // ------ Polling mode (development) ------
    await configureTelegramBot().catch((e) =>
      logger.error(e, "Failed to configure Telegram bot menu")
    );

    bot.start();
    logger.info("Bot started in polling mode");

    startBackgroundWorkers();
  }
}

main().catch((err) => {
  logger.fatal(err, "Fatal startup error");
  process.exit(1);
});
