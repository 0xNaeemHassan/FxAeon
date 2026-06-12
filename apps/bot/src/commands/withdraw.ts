/**
 * /withdraw — live withdrawals to any address. Unlocked by the move to
 * user-owned wallets: the old default-deny policy could not express "ERC-20
 * transfer to an address the user chose", so withdrawals were disabled.
 * Now the wallet is genuinely the user's (created/imported in the Mini App,
 * exportable key) and the bot signs only via their revocable session-signer
 * grant — so sending YOUR funds to YOUR address is just… a feature.
 *
 * Security model:
 * - Preview → explicit Confirm tap; nothing is built or sent before Confirm.
 * - The recipient address cannot fit in Telegram's 64-byte callback_data, so
 *   the full request is held server-side in a short-TTL pending store keyed
 *   by a CSPRNG id AND bound to the requesting telegramId — another user's
 *   tap on a forged/guessed id is rejected.
 * - Execution goes through the W-11 executor: idempotent, simulation-gated
 *   (fail-closed), EIP-1559 fees, receipt watch.
 * - Privy enforces the session-signer grant server-side; /withdraw fails
 *   closed with actionable copy when bot trading is off.
 */
import { Context, InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
import { prisma } from "@fxbot/db";
import { encodeFunctionData, erc20Abi, formatUnits, isAddress, parseUnits } from "viem";
import { ADDRESSES } from "@fxbot/shared";
import { executeRoute } from "../core/txExecutor.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import { describeExecutionError } from "../core/errorTaxonomy.js";
import { createPublicClientForUser } from "../fx/index.js";
import { botLogger } from "../middleware/logger.js";

interface WithdrawToken {
  symbol: string;
  address: `0x${string}` | null; // null = native ETH
  decimals: number;
}

export const WITHDRAW_TOKENS: Record<string, WithdrawToken> = {
  eth: { symbol: "ETH", address: null, decimals: 18 },
  fxusd: { symbol: "fxUSD", address: ADDRESSES.FXUSD as `0x${string}`, decimals: 18 },
  usdc: { symbol: "USDC", address: ADDRESSES.USDC as `0x${string}`, decimals: 6 },
  wsteth: { symbol: "wstETH", address: ADDRESSES.WSTETH as `0x${string}`, decimals: 18 },
  wbtc: { symbol: "WBTC", address: ADDRESSES.WBTC as `0x${string}`, decimals: 8 },
};

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

const USAGE =
  `📤 Withdraw\n\n` +
  `Send funds from your wallet to any address:\n` +
  `/withdraw <amount> <token> <address>\n\n` +
  `Tokens: ${Object.values(WITHDRAW_TOKENS).map((t) => t.symbol).join(", ")}\n` +
  `Example: /withdraw 0.5 ETH 0xAbC…1234\n\n` +
  `Preview first, then Confirm — nothing moves without your tap. ` +
  `Withdrawals are possible because the wallet is YOURS: the bot only signs ` +
  `while bot trading is enabled (revocable in the Mini App).`;

export async function withdrawCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please set up your wallet first with /start");
    return;
  }

  const parts = (ctx.message?.text ?? "").trim().split(/\s+/).slice(1);
  if (parts.length !== 3) {
    await ctx.reply(USAGE);
    return;
  }

  const [amountRaw, tokenRaw, to] = parts;
  const token = WITHDRAW_TOKENS[tokenRaw.toLowerCase()];
  const amount = Number(amountRaw);

  if (!token) {
    await ctx.reply(`❌ Unknown token "${tokenRaw}". Supported: ${Object.values(WITHDRAW_TOKENS).map((t) => t.symbol).join(", ")}`);
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply(`❌ Invalid amount "${amountRaw}".`);
    return;
  }
  if (!isAddress(to)) {
    await ctx.reply(`❌ "${to}" is not a valid Ethereum address. Double-check and try again.`);
    return;
  }
  if (to.toLowerCase() === user.walletAddress.toLowerCase()) {
    await ctx.reply(`❌ That's your own wallet address — nothing to do.`);
    return;
  }

  // Balance check up-front for honest copy (execution re-verifies via simulation).
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
    const amountWei = parseUnits(String(amount), token.decimals);
    if (balance < amountWei) {
      await ctx.reply(
        `❌ Insufficient balance.\n\nYou have ${formatUnits(balance, token.decimals)} ${token.symbol}` +
          (token.address ? "" : " (gas comes out of this too)") +
          `, tried to send ${amount}.`
      );
      return;
    }
  } catch {
    // Fail-soft: simulation at Confirm is the real gate.
  }

  prunePending();
  const id = randomBytes(6).toString("hex"); // 12 chars, CSPRNG
  pending.set(id, {
    telegramId,
    tokenKey: tokenRaw.toLowerCase(),
    amount,
    to: to as `0x${string}`,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });

  const keyboard = new InlineKeyboard()
    .text("✅ Confirm withdrawal", `wd_${id}`)
    .text("❌ Cancel", "wd_cancel");

  await ctx.reply(
    `📤 Withdrawal preview\n\n` +
      `Amount: ${amount} ${token.symbol}\n` +
      `To: ${to}\n\n` +
      `⚠️ Triple-check the address — on-chain transfers can't be undone.\n` +
      `Simulation and broadcast happen on Confirm. This preview expires in ~10 min.`,
    { reply_markup: keyboard }
  );
}

export async function handleWithdrawCallback(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery().catch(() => undefined);
  if (!telegramId) return;

  const editSafe = async (text: string) => {
    try {
      await ctx.editMessageText(text);
    } catch (e) {
      botLogger.debug({ error: String(e) }, "withdraw: editMessageText skipped");
    }
  };

  if (data === "wd_cancel") {
    await editSafe(`❌ Withdrawal cancelled. Nothing was sent.`);
    return;
  }

  const id = data.slice(3);
  prunePending();
  const req = pending.get(id);
  // Bind to the requester: a guessed/forged id from another chat is rejected.
  if (!req || req.telegramId !== telegramId) {
    await editSafe(`⌛ This withdrawal preview expired or is invalid. Run /withdraw again.`);
    return;
  }
  pending.delete(id); // single-use

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
      await editSafe(`${header}\n\n❌ Withdrawal not completed.\n\n${describeExecutionError(result.error)}`);
    }
  } catch (error) {
    botLogger.error({ error: String(error), telegramId }, "withdraw: execution error");
    await editSafe(`${header}\n\n❌ Withdrawal failed before broadcast — nothing was sent on-chain.`);
  }
}
