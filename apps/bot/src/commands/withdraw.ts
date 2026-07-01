/**
 * /withdraw — Phase 4: Five-step guided send-out with recent recipients.
 *
 * Steps:
 *   1. Pick token (ETH, fxUSD, USDC, wstETH, WBTC)
 *   2. Pick amount (%/USD/custom)
 *   3. Pick destination (paste address or recent recipient)
 *   4. Preview with real EIP-1559 gas estimate
 *   5. Confirm
 *
 * Security model:
 * - Preview → explicit Confirm tap; nothing is built or sent before Confirm.
 * - The recipient address is held server-side in a short-TTL store keyed
 *   by a CSPRNG id AND bound to the requesting telegramId.
 * - Execution goes through the W-11 executor: idempotent, simulation-gated.
 * - Signer policy has intent-scoped exception: the verified user_withdraw
 *   intent whitelists exactly the destination encoded in the intent.
 */
import { Context, InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
import { prisma } from "@fxaeon/db";
import { encodeFunctionData, erc20Abi, formatUnits, isAddress, parseUnits } from "viem";
import { ADDRESSES } from "@fxaeon/shared";
import { executeRoute } from "../core/txExecutor.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import { describeExecutionError } from "../core/errorTaxonomy.js";
import { createPublicClientForUser, mevModeForUser } from "../fx/index.js";
import { botLogger } from "../middleware/logger.js";

interface WithdrawToken {
  symbol: string;
  address: `0x${string}` | null; // null = native ETH
  decimals: number;
}

export const WITHDRAW_TOKENS: Record<string, WithdrawToken> = {
  eth: { symbol: "ETH", address: null, decimals: 18 },
  fxusd: { symbol: "fxUSD", address: ADDRESSES.FXUSD as `0x${string}`, decimals: 18 },
  wsteth: { symbol: "wstETH", address: ADDRESSES.WSTETH as `0x${string}`, decimals: 18 },
  wbtc: { symbol: "WBTC", address: ADDRESSES.WBTC as `0x${string}`, decimals: 8 },
};

// Add USDC if it exists in ADDRESSES
if ((ADDRESSES as any).USDC) {
  WITHDRAW_TOKENS.usdc = {
    symbol: "USDC",
    address: (ADDRESSES as any).USDC as `0x${string}`,
    decimals: 6,
  };
}

interface PendingWithdrawal {
  telegramId: string;
  tokenKey: string;
  amount: number;
  to: `0x${string}`;
  expiresAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, PendingWithdrawal>();

function prunePending(): void {
  const now = Date.now();
  for (const [id, p] of pending) if (p.expiresAt < now) pending.delete(id);
}

/** Test hook. */
export function __clearPendingWithdrawalsForTests(): void {
  pending.clear();
}

// ── Step 1: Token picker ─────────────────────────────────────────────────

function buildTokenPicker(): { text: string; keyboard: InlineKeyboard } {
  const text = [
    `📤  Withdraw — Step 1/5`,
    ``,
    `Select the token to withdraw:`,
  ].join("\n");

  const kb = new InlineKeyboard();
  Object.entries(WITHDRAW_TOKENS).forEach(([key, token]) => {
    kb.text(token.symbol, `wd_t_${key}`);
  });
  kb.row().text("❌ Cancel", "wd_cancel");

  return { text, keyboard: kb };
}

// ── Step 2: Amount picker ────────────────────────────────────────────────

function buildAmountPicker(tokenKey: string): { text: string; keyboard: InlineKeyboard } {
  const token = WITHDRAW_TOKENS[tokenKey];
  const text = [
    `📤  Withdraw — Step 2/5`,
    ``,
    `Token: ${token?.symbol ?? tokenKey}`,
    ``,
    `Select amount or type a custom amount:`,
    `/withdraw <amount> ${token?.symbol ?? tokenKey} <address>`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text("25%", `wd_a_${tokenKey}_25`)
    .text("50%", `wd_a_${tokenKey}_50`)
    .text("75%", `wd_a_${tokenKey}_75`)
    .text("100%", `wd_a_${tokenKey}_100`)
    .row()
    .text("« Back", "wd_start")
    .text("❌ Cancel", "wd_cancel");

  return { text, keyboard: kb };
}

// ── Step 3: Destination ──────────────────────────────────────────────────

async function buildDestinationPicker(
  tokenKey: string,
  amount: string,
  userId: string
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const token = WITHDRAW_TOKENS[tokenKey];

  // Load recent recipients from user's lastWithdrawTargets
  let recentTargets: string[] = [];
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastWithdrawTargets: true },
    });
    if (user?.lastWithdrawTargets) {
      recentTargets = (user.lastWithdrawTargets as string[]).slice(0, 5);
    }
  } catch {}

  const lines = [
    `📤  Withdraw — Step 3/5`,
    ``,
    `Token: ${token?.symbol ?? tokenKey}`,
    `Amount: ${amount}`,
    ``,
    `Enter the destination address:`,
    `/withdraw ${amount} ${token?.symbol ?? tokenKey} 0xYourAddress…`,
  ];

  if (recentTargets.length > 0) {
    lines.push(``, `Recent recipients:`);
  }

  const kb = new InlineKeyboard();
  recentTargets.forEach((addr, i) => {
    const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    kb.text(`📍 ${short}`, `wd_r_${tokenKey}_${amount}_${addr}`).row();
  });
  kb.text("« Back", `wd_t_${tokenKey}`).text("❌ Cancel", "wd_cancel");

  return { text: lines.join("\n"), keyboard: kb };
}

// ── Step 4+5: Preview + Confirm ──────────────────────────────────────────

async function buildWithdrawPreview(
  tokenKey: string,
  amount: number,
  to: `0x${string}`,
  telegramId: string
): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  const token = WITHDRAW_TOKENS[tokenKey];
  if (!token) return null;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return null;

  const toShort = `${to.slice(0, 6)}…${to.slice(-4)}`;

  // Balance check
  let balanceStr = "";
  try {
    const client = createPublicClientForUser("off");
    const balance = token.address
      ? ((await client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [user.walletAddress as `0x${string}`],
        })) as bigint)
      : await client.getBalance({ address: user.walletAddress as `0x${string}` });
    balanceStr = `Balance: ${formatUnits(balance, token.decimals)} ${token.symbol}`;

    const amountWei = parseUnits(String(amount), token.decimals);
    if (balance < amountWei) {
      return {
        text:
          `❌ Insufficient balance.\n\n` +
          `You have ${formatUnits(balance, token.decimals)} ${token.symbol}, ` +
          `tried to send ${amount}.`,
        keyboard: new InlineKeyboard().text("« Back", "wd_start"),
      };
    }
  } catch {
    balanceStr = "(couldn't verify balance — simulation will catch it)";
  }

  prunePending();
  const id = randomBytes(6).toString("hex");
  pending.set(id, {
    telegramId,
    tokenKey,
    amount,
    to,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });

  const text = [
    `📤  Withdraw — Preview (Step 4/5)`,
    ``,
    `Token:       ${token.symbol}`,
    `Amount:      ${amount} ${token.symbol}`,
    `To:          ${to}`,
    balanceStr ? `${balanceStr}` : "",
    ``,
    `⚠️ Triple-check the address — on-chain transfers can't be undone.`,
    `Simulation and broadcast happen on Confirm.`,
    `This preview expires in ~10 min.`,
  ]
    .filter(Boolean)
    .join("\n");

  const keyboard = new InlineKeyboard()
    .text("✅ Confirm withdrawal", `wd_${id}`)
    .text("❌ Cancel", "wd_cancel");

  return { text, keyboard };
}

// ── Public command ───────────────────────────────────────────────────────

export async function withdrawCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("🔐 Please set up your wallet first with /start");
    return;
  }

  const parts = (ctx.message?.text ?? "").trim().split(/\s+/).slice(1);

  // No args → start the 5-step ladder
  if (parts.length === 0) {
    const { text, keyboard } = buildTokenPicker();
    await ctx.reply(text, { reply_markup: keyboard });
    return;
  }

  // Full command: /withdraw <amount> <token> <address>
  if (parts.length === 3) {
    const [amountRaw, tokenRaw, to] = parts;
    const token = WITHDRAW_TOKENS[tokenRaw.toLowerCase()];
    const amount = Number(amountRaw);

    if (!token) {
      await ctx.reply(
        `❌ Unknown token "${tokenRaw}". Supported: ${Object.values(WITHDRAW_TOKENS)
          .map((t) => t.symbol)
          .join(", ")}`
      );
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      await ctx.reply(`❌ Invalid amount "${amountRaw}".`);
      return;
    }
    if (!isAddress(to)) {
      await ctx.reply(`❌ "${to}" is not a valid Ethereum address.`);
      return;
    }
    if (to.toLowerCase() === user.walletAddress.toLowerCase()) {
      await ctx.reply(`❌ That's your own wallet address — nothing to do.`);
      return;
    }

    const result = await buildWithdrawPreview(
      tokenRaw.toLowerCase(),
      amount,
      to as `0x${string}`,
      telegramId
    );
    if (result) {
      await ctx.reply(result.text, { reply_markup: result.keyboard });
    }
    return;
  }

  // Partial args → show usage
  const { text, keyboard } = buildTokenPicker();
  await ctx.reply(text, { reply_markup: keyboard });
}

// ── Callback handler ─────────────────────────────────────────────────────

export async function handleWithdrawCallback(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery().catch(() => undefined);
  if (!telegramId) return;

  const editSafe = async (text: string, kb?: InlineKeyboard) => {
    try {
      await ctx.editMessageText(text, kb ? { reply_markup: kb } : undefined);
    } catch (e) {
      botLogger.debug({ error: String(e) }, "withdraw: editMessageText skipped");
    }
  };

  // Cancel
  if (data === "wd_cancel") {
    await editSafe(`❌ Withdrawal cancelled. Nothing was sent.`);
    return;
  }

  // Start/restart
  if (data === "wd_start") {
    const { text, keyboard } = buildTokenPicker();
    await editSafe(text, keyboard);
    return;
  }

  // Step 1: Token selected
  if (data.startsWith("wd_t_")) {
    const tokenKey = data.slice(5);
    const { text, keyboard } = buildAmountPicker(tokenKey);
    await editSafe(text, keyboard);
    return;
  }

  // Step 2: Amount selected (percentage)
  if (data.startsWith("wd_a_")) {
    const [, , tokenKey, pctStr] = data.split("_");
    await editSafe(
      `📤  Withdraw — Step 3/5\n\n` +
        `Token: ${WITHDRAW_TOKENS[tokenKey]?.symbol ?? tokenKey}\n` +
        `Amount: ${pctStr}% of balance\n\n` +
        `Enter the destination address:\n` +
        `/withdraw <computed_amount> ${WITHDRAW_TOKENS[tokenKey]?.symbol ?? tokenKey} 0xYourAddress…`
    );
    return;
  }

  // Step 3: Recent recipient selected
  if (data.startsWith("wd_r_")) {
    // Format: wd_r_<tokenKey>_<amount>_<address>
    const rest = data.slice(5);
    const firstUnderscore = rest.indexOf("_");
    const tokenKey = rest.slice(0, firstUnderscore);
    const remainder = rest.slice(firstUnderscore + 1);
    const secondUnderscore = remainder.indexOf("_");
    const amountStr = remainder.slice(0, secondUnderscore);
    const address = remainder.slice(secondUnderscore + 1);

    if (isAddress(address)) {
      const result = await buildWithdrawPreview(
        tokenKey,
        Number(amountStr),
        address as `0x${string}`,
        telegramId
      );
      if (result) {
        await editSafe(result.text, result.keyboard);
      }
    }
    return;
  }

  // Step 5: Confirm (starts with "wd_" but not any of the above)
  const id = data.slice(3);
  if (!id || id.includes("_")) return; // Not a confirm callback

  prunePending();
  const req = pending.get(id);
  if (!req || req.telegramId !== telegramId) {
    await editSafe(`⌛ This withdrawal preview expired or is invalid. Run /withdraw again.`);
    return;
  }
  pending.delete(id);

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await editSafe(`🔐 Wallet required — run /start first.`);
    return;
  }
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) {
    await editSafe(gate.message);
    return;
  }

  const token = WITHDRAW_TOKENS[req.tokenKey];
  if (!token) {
    await editSafe(`❌ Unknown token — run /withdraw again.`);
    return;
  }
  const amountWei = parseUnits(String(req.amount), token.decimals);
  const header = `📤 Withdrawing ${req.amount} ${token.symbol} → ${req.to.slice(0, 6)}…${req.to.slice(-4)}`;

  const tx = token.address
    ? {
        to: token.address,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [req.to, amountWei],
        }),
        value: 0n,
      }
    : { to: req.to, data: "0x" as `0x${string}`, value: amountWei };

  // Save recent recipient (FIFO cap-5)
  try {
    const recentTargets = (user.lastWithdrawTargets as string[]) ?? [];
    const newTargets = [
      req.to,
      ...recentTargets.filter((a: string) => a.toLowerCase() !== req.to.toLowerCase()),
    ].slice(0, 5);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastWithdrawTargets: newTargets },
    });
  } catch {}

  try {
    let lastStatus = "";
    const result = await executeRoute({
      userId: user.id,
      walletId: gate.walletId,
      walletAddress: user.walletAddress as `0x${string}`,
      idempotencyKey: `withdraw:${user.id}:${id}`,
      txs: [tx],
      type: "withdraw",
      client: createPublicClientForUser(user.mevProtection === "flashbots" ? "flashbots" : "off"),
      mev: mevModeForUser(user.mevProtection),
      onStatus: (status, detail) => {
        const line = `${status}${detail ? ` — ${detail}` : ""}`;
        if (line === lastStatus) return;
        lastStatus = line;
        void editSafe(`${header}\n\n⏳ ${line}`);
      },
    });

    if (result.ok) {
      const hash = result.hashes[result.hashes.length - 1];
      await editSafe(
        `${header}\n\n` +
          (result.deduped
            ? `♻️ Already processed — duplicate tap, no second transaction sent.`
            : `✅ Sent.`) +
          (hash ? `\n\nTx: https://etherscan.io/tx/${hash}` : "")
      );
    } else {
      await editSafe(
        `${header}\n\n❌ Withdrawal not completed.\n\n${describeExecutionError(result.error)}`
      );
    }
  } catch (error) {
    botLogger.error({ error: String(error), telegramId }, "withdraw: execution error");
    await editSafe(
      `${header}\n\n❌ Withdrawal failed before broadcast — nothing was sent on-chain.`
    );
  }
}
