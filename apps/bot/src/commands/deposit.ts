/**
 * /deposit — Phase 4: QR + address + first-deposit watcher.
 *
 * Fully self-custodial — no fiat on-ramp, no second account.
 * The "Notify on first deposit" button creates a DepositWatcher row;
 * a 30-second poller batches all active watchers and fires a DM
 * when the first deposit lands.
 */
import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxaeon/db";
import { botLogger } from "../middleware/logger.js";

const SUPPORTED_TOKENS = [
  "ETH", "WETH", "wstETH", "WBTC",
  "USDC", "USDT", "fxUSD",
];

export async function depositCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("🔐 Please connect your wallet first with /start");
    return;
  }

  const walletShort = `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`;
  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";

  const lines = [
    `📥  Deposit to your FxAeon wallet`,
    ``,
    `Address:   \`${user.walletAddress}\``,
    `Network:   Ethereum mainnet`,
    `           ⚠ Do NOT send from a different chain — funds will be lost.`,
    ``,
    `Supported tokens (auto-detected when received):`,
    ...SUPPORTED_TOKENS.map((t) => `  • ${t}`),
    ``,
    `This is YOUR wallet — we never hold, convert, or move your funds.`,
    `Send from any wallet, exchange, or bridge.`,
  ];

  const keyboard = new InlineKeyboard()
    .text("🔳 Show QR", `dep_qr`)
    .text("📋 Copy Address", `dep_copy`)
    .row()
    .text("🔔 Notify on first deposit", `dep_watch`)
    .row()
    .url("📱 Open in Mini App", `${miniAppUrl}/deposit?address=${user.walletAddress}`);

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

/**
 * Handle deposit-related callback queries.
 */
export async function handleDepositCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data ?? "";
  const telegramId = ctx.from?.id.toString();
  await ctx.answerCallbackQuery().catch(() => {});
  if (!telegramId) return;

  if (data === "dep_copy") {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return;
    await ctx.reply(`\`${user.walletAddress}\``, { parse_mode: "Markdown" });
    return;
  }

  if (data === "dep_qr") {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return;
    // Generate a QR code URL using a public API
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(user.walletAddress)}`;
    await ctx.replyWithPhoto(qrUrl, {
      caption: `📥 Scan to get your deposit address\n\n\`${user.walletAddress}\``,
      parse_mode: "Markdown",
    });
    return;
  }

  if (data === "dep_watch") {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return;

    // Check for existing active watcher
    const existing = await prisma.depositWatcher.findFirst({
      where: {
        userId: user.id,
        firedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (existing) {
      await ctx.reply(
        `🔔 You already have a deposit watcher active — ` +
          `it will notify you within 30 seconds of your first deposit.`
      );
      return;
    }

    try {
      // Get current block number for the watcher start point
      const fromBlock = BigInt(0); // The poller will use latest-N approach

      await prisma.depositWatcher.create({
        data: {
          userId: user.id,
          fromBlock,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        },
      });

      await ctx.reply(
        `🔔 Deposit watcher activated!\n\n` +
          `I'll DM you within ~30 seconds of your first deposit landing.\n` +
          `The watcher auto-expires in 24 hours.`
      );
    } catch (error) {
      botLogger.error({ error: String(error) }, "deposit watcher creation failed");
      await ctx.reply(`❌ Couldn't set up the watcher — please try again.`);
    }
    return;
  }
}
