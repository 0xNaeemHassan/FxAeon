import path from "path";
import { Bot, Context, GrammyError, HttpError, webhookCallback } from "grammy";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { I18n, type I18nFlavor } from "@grammyjs/i18n";
import { conversations, type ConversationFlavor } from "@grammyjs/conversations";
import { prisma } from "@fxbot/db";
import { ADDRESSES } from "@fxbot/shared";

import { startCommand } from "./commands/start";
import { portfolioCommand } from "./commands/portfolio";
import { tradeCommand } from "./commands/trade";
import { limitCommand } from "./commands/limit";
import { ordersCommand } from "./commands/orders";
import { mintCommand } from "./commands/mint";
import { redeemCommand } from "./commands/redeem";
import { saveCommand } from "./commands/save";
import { borrowCommand } from "./commands/borrow";
import { repayCommand } from "./commands/repay";
import { bridgeCommand } from "./commands/bridge";
import { lockCommand } from "./commands/lock";
import { voteCommand } from "./commands/vote";
import { claimCommand } from "./commands/claim";
import { referCommand } from "./commands/refer";
import { autoCommand } from "./commands/auto";
import { settingsCommand } from "./commands/settings";
import { securityCommand } from "./commands/security";
import { depositCommand } from "./commands/deposit";
import { withdrawCommand } from "./commands/withdraw";
import { helpCommand } from "./commands/help";

import { privyWebhookHandler } from "./handlers/privy-webhooks";
import { limitOrderPolling } from "./notifications/limit-order-poller";
import { healthMonitor } from "./notifications/health-monitor";
import { txNotifier } from "./notifications/tx-notifier";

// Custom Context type with all middleware flavors
type BotContext = Context & I18nFlavor & ConversationFlavor<Context>;

const bot = new Bot<BotContext>(process.env.TELEGRAM_BOT_TOKEN!);

// Rate limiting: 30 msg/s global, 1 msg/s per user
bot.api.config.use(apiThrottler({
  global: { reservoir: 30, reservoirRefreshAmount: 30, reservoirRefreshInterval: 1000 },
  group: { reservoir: 20, reservoirRefreshAmount: 20, reservoirRefreshInterval: 60_000 },
  out: { maxConcurrent: 1, minTime: 1000 },
}));

// i18n
const i18n = new I18n<BotContext>({
  defaultLocale: "en",
  directory: path.join(__dirname, "../src/i18n"),
  useSession: true,
});
bot.use(i18n);

// Conversations
bot.use(conversations());

// Commands
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

// Error handling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
});

// Start polling workers
limitOrderPolling.start();
healthMonitor.start();
txNotifier.start();

// Start bot
if (process.env.NODE_ENV === "production") {
  // Webhook mode for production
  const port = parseInt(process.env.PORT || "8080", 10);
  const express = require("express");
  const helmet = require("helmet");
  const app = express();
  app.use(helmet());
  app.use(express.json());
  app.post("/webhook", webhookCallback(bot, "express"));
  app.post("/privy-webhook", privyWebhookHandler);
  app.get("/health", (_req: any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    res.json({ ok: true });
  });
  app.listen(port, () => console.log(`Bot listening on port ${port}`));
} else {
  bot.start();
  console.log("Bot started in polling mode");
}
