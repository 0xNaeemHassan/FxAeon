import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { Bot, Context, GrammyError, HttpError, webhookCallback } from "grammy";
import { getTelegramWebhookSecret } from "./utils/webhookAuth.js";
import type { RequestWithRawBody } from "./utils/webhookAuth.js";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { conversations, type ConversationFlavor } from "@grammyjs/conversations";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxbot/db";

import {
  startCommand, portfolioCommand, tradeCommand, limitCommand,
  ordersCommand, mintCommand, redeemCommand, saveCommand,
  borrowCommand, repayCommand, bridgeCommand, lockCommand,
  voteCommand, claimCommand, referCommand, autoCommand,
  settingsCommand, securityCommand, depositCommand, withdrawCommand,
  helpCommand,
} from "./commands/index.js";

import { handleWebAppData } from "./handlers/walletConnect.js";
import { registerTradeActions } from "./handlers/tradeActions.js";
import { registerPositionActions } from "./handlers/positionActions.js";
import { apiRouter } from "./api/index.js";
import { applySecurityMiddleware, errorHandler } from "./middleware/index.js";
import { validateConfig } from "./middleware/config.js";
import { logger } from "./middleware/logger.js";
import { commandTiming } from "./middleware/timing.js";
import { healthRouter } from "./api/health.js";
import { createMiniAppRouter } from "./api/miniapp.js";
import { initSentry, captureError } from "./observability/sentry.js";
import { initAdminAlerts, reportErrorToAdmin } from "./observability/admin-alerts.js";
import { sloDigest } from "./observability/slo-digest.js";
import { installVendorLogFilter } from "./observability/quiet-vendor.js";
import { limitOrderPolling } from "./notifications/limit-order-poller.js";
import { healthMonitor } from "./notifications/health-monitor.js";
import { initNotify } from "./notifications/notify.js";
import { i18n } from "./i18n/index.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const env = validateConfig();

// Observability (W-15): Sentry only when SENTRY_DSN is set; always silence
// the fx-sdk vendor debug line that dumps pool structs to stdout.
installVendorLogFilter();
initSentry();

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------
type BotContext = Context & ConversationFlavor<Context> & I18nFlavor;

const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Rate limiting: 30 msg/s global, 1 msg/s per user
bot.api.config.use(apiThrottler({
  global: { reservoir: 30, reservoirRefreshAmount: 30, reservoirRefreshInterval: 1000 },
  group: { reservoir: 20, reservoirRefreshAmount: 20, reservoirRefreshInterval: 60_000 },
  out: { maxConcurrent: 1, minTime: 1000 },
}));

// i18n (W-21): translation context (ctx.t) keyed off User.language with a
// per-user cache — must run before any handler that replies.
bot.use(i18n.middleware());

// Conversations
bot.use(conversations());

// Command timing + per-command metrics (W-15) — before handler registration.
bot.use(commandTiming);

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

// Mini App → bot data channel (W-16): wallet-connect onboarding completes here.
bot.on("message:web_app_data", handleWebAppData);

// Trade UX callbacks (W-17): ladder navigation, signed confirm, cancel.
registerTradeActions(bot);

// Portfolio position actions (W-18): close prompt/confirm, TP/SL hint.
registerPositionActions(bot);

// Honest fallback for any other callback_data: until W-17 there was NO
// callback handler at all, so every inline button just spun forever. Buttons
// that aren't wired yet now say so instead of pretending to load.
bot.on("callback_query:data", async (ctx) => {
  await ctx
    .answerCallbackQuery({ text: "This button isn't wired up yet." })
    .catch(() => undefined);
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
bot.catch((err) => {
  const ctx = err.ctx;
  logger.error({ updateId: ctx.update.update_id }, "Error handling update");
  const e = err.error;
  captureError(e, { source: "bot.catch" });
  // Full sanitized stack to the admin chat — production debugging without
  // log access. Deduped (5 min window) and fail-soft.
  reportErrorToAdmin(e, {
    source: "bot.catch",
    telegramId: ctx.from?.id?.toString(),
    updateId: ctx.update.update_id,
  });
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
  // Single pref-aware notification gate (W-12): workers push through notify().
  initNotify((telegramId, message) => bot.api.sendMessage(telegramId, message));
  // Admin error alerts: sanitized stack traces → ADMIN_TELEGRAM_CHAT_ID.
  initAdminAlerts(
    (chatId, message) => bot.api.sendMessage(chatId, message),
    env.ADMIN_TELEGRAM_CHAT_ID
  );
  // Delay worker start to let connections settle
  setTimeout(() => {
    try { limitOrderPolling.start(); } catch (e) { logger.error(e, "Failed to start limit order polling"); }
    try { healthMonitor.start(); } catch (e) { logger.error(e, "Failed to start health monitor"); }
    try { sloDigest.start((chatId, msg) => bot.api.sendMessage(chatId, msg)); } catch (e) { logger.error(e, "Failed to start SLO digest"); }
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

    // API routes (health, simulate, webhook verification, etc.)
    app.use("/api", apiRouter);

    // Simple health check at root /health (fallback for quick pings)
    app.get("/health", (_req, res) => {
      res.json({ ok: true, timestamp: new Date().toISOString() });
    });

    // Render's healthCheckPath is /api/v1/health — serve the REAL checks
    // there (the previous alias returned a hardcoded "healthy", so Render
    // could never see a dead DB). (W-15)
    app.use("/api/v1/health", healthRouter);

    // Mini App data API (initData-authenticated): /me, /onboard, /settings.
    // This is what lets the Mini App show the user's REAL policy wallet,
    // live balances and positions instead of placeholders.
    app.use(
      "/api/v1/miniapp",
      createMiniAppRouter({
        botToken: env.TELEGRAM_BOT_TOKEN,
        sendMessage: (chatId, text, opts) =>
          bot.api.sendMessage(chatId, text, opts),
        miniAppUrl: env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev",
      })
    );

    // Lightweight build/info endpoint (no dependency checks, never blocks).
    // The post-deploy smoke test asserts this returns 200.
    app.get("/api/v1/info", (_req, res) => {
      res.json({
        name: "fxbot",
        version: process.env.npm_package_version || "1.1.0",
        env: env.NODE_ENV,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
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
