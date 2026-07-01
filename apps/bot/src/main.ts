

import express from "express";
import { Bot, Context, GrammyError, HttpError, webhookCallback } from "grammy";
import { getTelegramWebhookSecret } from "./utils/webhookAuth.js";
import type { RequestWithRawBody } from "./utils/webhookAuth.js";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { conversations, type ConversationFlavor } from "@grammyjs/conversations";
import type { I18nFlavor } from "@grammyjs/i18n";
import { getBotState, setBotState, BS_WEBHOOK_URL } from "./core/botState.js";

import {
  startCommand, portfolioCommand, tradeCommand, limitCommand,
  ordersCommand, mintCommand, redeemCommand, saveCommand,
  borrowCommand, repayCommand, bridgeCommand, lockCommand,
  voteCommand, claimCommand, referCommand, autoCommand,
  settingsCommand, securityCommand, depositCommand, withdrawCommand,
  helpCommand,
  gasCommand,
  priceCommand,
  historyCommand,
  alertCommand,
  alertsCommand,
  handleAlertDeleteCallback,
  handleSecurityCallback,
  handleDepositCallback,
  handleWithdrawCallback,
  handleSaveCallback,
  registerAutoActions,
  speedUpCommand,
  cancelTxCommand,
  handleTxControlCallback,
  arbCommand,
  balanceCommand,
  closeCommand,
  positionCommand,
  longShortCommand,
  closeAssetCommand,
  registerLongShortActions,
  registerSettingsActions,
} from "./commands/index.js";

import { handleWebAppData } from "./handlers/walletConnect.js";
import { registerTradeActions } from "./handlers/tradeActions.js";
import { registerPositionActions } from "./handlers/positionActions.js";
import { registerPositionCardActions } from "./handlers/positionCardActions.js";
import { handleActionCallback } from "./handlers/earnActions.js";
// handleWithdrawCallback now imported from commands/index.js
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
import { priceAlertPoller } from "./notifications/price-alert-poller.js";
import { automationPoller } from "./notifications/automation-poller.js";
import { arbPoller } from "./notifications/arb-poller.js";
import { initNotify } from "./notifications/notify.js";
import { i18n } from "./i18n/index.js";
import { prisma } from "@fxaeon/db";
import { looksLikeNaturalIntent, parseIntent, intentToTradeParams } from "./agent/index.js";
import { createTradeIntent } from "./core/tradeIntent.js";
import { buildPreview } from "./handlers/tradeActions.js";

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
bot.command("balance", balanceCommand);
bot.command("close", closeCommand);
bot.command("position", positionCommand);
bot.command("trade", tradeCommand);
bot.command("limit", limitCommand);
bot.command("orders", ordersCommand);
bot.command("mint", mintCommand);
bot.command("redeem", redeemCommand);
bot.command("save", saveCommand);
bot.command("arb", arbCommand);
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
bot.command("gas", gasCommand);
bot.command("speedup", speedUpCommand);
bot.command("cancel", cancelTxCommand);
bot.command("price", priceCommand);
bot.command("history", historyCommand);
bot.command("alert", alertCommand);
bot.command("alerts", alertsCommand);

// Phase 2: Asset-locked trading shortcuts
bot.command("longbtc", longShortCommand);
bot.command("longeth", longShortCommand);
bot.command("shortbtc", longShortCommand);
bot.command("shorteth", longShortCommand);
bot.command("closebtc", closeAssetCommand);
bot.command("closeeth", closeAssetCommand);

// Mini App → bot data channel (W-16): wallet-connect onboarding completes here.
bot.on("message:web_app_data", handleWebAppData);

// Trade UX callbacks (W-17): ladder navigation, signed confirm, cancel.
registerTradeActions(bot);

// Portfolio position actions (W-18): close prompt/confirm, TP/SL hint.
registerPositionActions(bot);
registerAutoActions(bot);

// Phase 2: Long/Short 6-step ladder callbacks + settings toggle callbacks.
registerLongShortActions(bot);
registerSettingsActions(bot);

// Phase 2: Position card action buttons (increase/reduce/adjust/refresh).
registerPositionCardActions(bot);

// Earn & borrow callbacks: signed action-intent confirms (a1_…) + cancel (a1c).
bot.callbackQuery(/^a1(_|c$)/, handleActionCallback);
bot.callbackQuery(/^wd_/, handleWithdrawCallback);
bot.callbackQuery(/^tx_/, handleTxControlCallback);

// Price-alert delete buttons (/alerts list).
bot.callbackQuery(/^aldel_/, handleAlertDeleteCallback);

// Phase 4: Security, deposit, earn callbacks.
bot.callbackQuery(/^sec_/, handleSecurityCallback);
bot.callbackQuery(/^dep_/, handleDepositCallback);
bot.callbackQuery(/^sv_/, handleSaveCallback);

// Phase 4: Portfolio aliases.
bot.command("positions", portfolioCommand);
bot.command("pnl", portfolioCommand);
bot.command("history", portfolioCommand);
bot.command("balance", portfolioCommand);
bot.command("wallet", portfolioCommand);
bot.command("earn", saveCommand);

// Phase 5: Natural-language intent handler.
// When a user has AI input enabled, free-text messages are parsed and
// routed to the same Step 5 preview that button taps produce.
bot.on("message:text", async (ctx, next) => {
  const text = ctx.message?.text ?? "";
  // Skip commands (they're handled above)
  if (text.startsWith("/")) return next();

  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return next();

  // Check if user has AI input enabled
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, slippageBps: true, mevProtection: true, aiInputEnabled: true } as any,
  }).catch(() => null);

  if (!user || !(user as any).aiInputEnabled) return next();

  // Only process if the text looks like a trade intent
  if (!looksLikeNaturalIntent(text)) return next();

  const intent = parseIntent(text);

  if (intent.confidence === "low" || intent.action === "unknown") return next();

  // Route known non-trade intents
  if (intent.action === "check_positions" || intent.action === "check_portfolio") {
    return portfolioCommand(ctx as any);
  }
  if (intent.action === "check_price") {
    return priceCommand(ctx as any);
  }
  if (intent.action === "help") {
    return helpCommand(ctx as any);
  }

  // Trade intents → build preview
  const tradeParams = intentToTradeParams(intent);
  if (tradeParams) {
    const { text: previewText, keyboard } = buildPreview(
      tradeParams,
      user,
      ctx.me?.username ?? "FxAeonBot"
    );
    await ctx.reply(
      `🤖 I understood: *${intent.action.replace(/_/g, " ")}* ${tradeParams.market} at ${tradeParams.leverage}×\n\n${previewText}`,
      { reply_markup: keyboard, parse_mode: "Markdown" }
    );
    return;
  }

  // For other recognized intents, show confirmation
  if (intent.action !== "unknown") {
    await ctx.reply(
      `🤖 I understood: *${intent.action.replace(/_/g, " ")}*\n\nPlease use the corresponding command for now. Full NL routing coming soon.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  return next();
});

// Smart callback fallback with 24-hour hard cutoff + stale detection.
// Buttons older than 24h get a "stale" notice; newer ones get the honest
// "not wired yet" message. Telegram stores callback_query messages for 48h;
// after that they disappear, but users sometimes press cached buttons from
// earlier sessions.
const CALLBACK_STALE_CUTOFF_MS = 24 * 60 * 60 * 1000;

bot.on("callback_query:data", async (ctx) => {
  const messageDate = ctx.callbackQuery.message?.date;
  if (messageDate) {
    const ageMs = Date.now() - messageDate * 1000;
    if (ageMs > CALLBACK_STALE_CUTOFF_MS) {
      await ctx
        .answerCallbackQuery({
          text: "⏰ This button has expired. Please run the command again for a fresh session.",
          show_alert: true,
        })
        .catch(() => undefined);
      return;
    }
  }
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
  // Top-8 command menu visible to the user (Telegram limits visibility at 8).
  // Every other command still works — they just don't clutter the menu.
  await bot.api.setMyCommands([
    { command: "start", description: "Start / connect wallet" },
    { command: "portfolio", description: "View portfolio & positions" },
    { command: "trade", description: "Open a leveraged trade" },
    { command: "deposit", description: "Deposit funds" },
    { command: "withdraw", description: "Withdraw funds" },
    { command: "save", description: "Earn yield on fxUSD" },
    { command: "settings", description: "Bot settings" },
    { command: "help", description: "Help & commands" },
  ]);
  logger.info("Bot command menu registered (top 8)");

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
    try { priceAlertPoller.start(); } catch (e) { logger.error(e, "Failed to start price-alert poller"); }
    try { automationPoller.start(); } catch (e) { logger.error(e, "Failed to start automation poller"); }
  try { arbPoller.start(); } catch (e) { logger.error(e, "Failed to start arb poller"); }
  }, 5000);
}

// ---------------------------------------------------------------------------
// Webhook retry with exponential backoff + BotState skip-noop
// ---------------------------------------------------------------------------
const WEBHOOK_MAX_RETRIES = 4;
const WEBHOOK_BASE_DELAY_MS = 1_000;

async function registerWebhookWithRetry(
  webhookUrl: string,
  telegramWebhookSecret: string
): Promise<void> {
  // Skip-noop: avoid redundant setWebhook calls on every cold start.
  try {
    const storedUrl = await getBotState(BS_WEBHOOK_URL);
    if (storedUrl === webhookUrl) {
      logger.info(
        { webhookUrl },
        "Webhook URL unchanged in BotState — skipping setWebhook"
      );
      return;
    }
  } catch {
    // BotState table might not exist yet (first deploy before migration).
    // Proceed to register.
  }

  for (let attempt = 0; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
    try {
      await bot.api.setWebhook(webhookUrl, {
        allowed_updates: ["message", "callback_query", "inline_query"],
        drop_pending_updates: true,
        secret_token: telegramWebhookSecret,
      });
      logger.info(
        { webhookUrl, attempt },
        "Telegram webhook registered"
      );
      // Persist so the next cold start skips.
      try {
        await setBotState(BS_WEBHOOK_URL, webhookUrl);
      } catch {
        // Non-fatal: skip-noop just won't work until the table exists.
      }
      return;
    } catch (e) {
      const isLast = attempt === WEBHOOK_MAX_RETRIES;
      if (isLast) {
        logger.error(
          e,
          `Failed to register webhook after ${WEBHOOK_MAX_RETRIES + 1} attempts — continuing without re-registration`
        );
        return;
      }
      const delay = WEBHOOK_BASE_DELAY_MS * Math.pow(2, attempt);
      logger.warn(
        { attempt, delay },
        "Webhook registration failed — retrying"
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
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

      // Start background workers FIRST so nothing in the webhook/menu
      // registration path (which makes external Telegram API calls that can
      // hang or rate-limit) can ever block limit-order/price-alert/automation/
      // health worker startup. Worker start is internally delayed 5s anyway.
      startBackgroundWorkers();

      // Register webhook with Telegram — skip-noop + exponential retry.
      // Render provides RENDER_EXTERNAL_URL; fall back to WEBHOOK_URL env var.
      const webhookDomain = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
      if (webhookDomain) {
        const webhookUrl = `${webhookDomain}/webhook`;
        await registerWebhookWithRetry(webhookUrl, telegramWebhookSecret);
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
