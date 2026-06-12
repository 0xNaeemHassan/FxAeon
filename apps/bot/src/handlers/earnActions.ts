/**
 * Earn & borrow UX: fxSAVE deposit/withdraw/claim, deposit-and-mint, repay.
 *
 * Mirrors the W-17 trade UX exactly: signed short-TTL intents
 * (core/actionIntent.ts) in Confirm buttons, server-side verification, then
 * the W-11 executor (simulate → broadcast → receipt) with status edits on the
 * same message. No tx is ever built or sent before Confirm.
 *
 * Callback data: the action-intent token itself (`a1_…`), plus `a1c` = cancel.
 */
import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxbot/db";
import { parseUnits } from "viem";
import { MARKETS, type Market } from "@fxbot/shared";
import {
  collateralDecimals,
  createFxSdk,
  createPublicClientForUser,
  getPositions,
} from "../fx/index.js";
import {
  getSaveClaimable,
  quoteDepositAndMint,
  quoteRepay,
  quoteSaveClaim,
  quoteSaveDeposit,
  quoteSaveWithdraw,
  type SaveToken,
} from "../fx/earn.js";
import { executeRoute } from "../core/txExecutor.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import type { TxState } from "../core/txState.js";
import {
  createActionIntent,
  packAmount,
  unpackAmount,
  verifyActionIntent,
  type ActionIntent,
} from "../core/actionIntent.js";
import { describeExecutionError } from "../core/errorTaxonomy.js";
import { botLogger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

async function editSafe(ctx: Context, text: string, keyboard?: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, keyboard ? { reply_markup: keyboard } : undefined);
  } catch (error) {
    botLogger.debug({ error: String(error) }, "earn-ux: editMessageText skipped");
  }
}

function statusLine(state: TxState, detail?: string): string {
  switch (state) {
    case "prepared":
      return "⏳ Preparing…";
    case "simulated":
      return "🧪 Simulation passed — broadcasting…";
    case "broadcasting":
      return "📤 Broadcasting…";
    case "broadcast":
      return `📤 Broadcast${detail ? ` — ${detail}` : ""}\n⏳ Waiting for confirmation…`;
    case "confirmed":
      return "✅ Confirmed on-chain.";
    case "reverted":
      return `❌ Reverted on-chain${detail ? ` — ${detail}` : ""}.`;
    case "failed":
      return `❌ Failed${detail ? ` — ${detail}` : ""}.`;
  }
}

export function confirmKeyboard(token: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confirm", token).text("❌ Cancel", "a1c");
}

const PREVIEW_FOOTER =
  `\nQuote, simulation and broadcast all happen on Confirm — nothing is sent before that.` +
  `\nThis preview expires in ~10 min.`;

type DbUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;

async function requireWalletUser(ctx: Context, header: string): Promise<DbUser | null> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return null;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await editSafe(ctx, `${header}\n\n🔐 Wallet Required\n\nConnect your wallet first with /start`);
    return null;
  }
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) {
    await editSafe(ctx, `${header}\n\n${gate.message}`);
    return null;
  }
  return { ...user, privyWalletId: gate.walletId };
}

interface RunRouteParams {
  ctx: Context;
  user: DbUser;
  header: string;
  txType: string;
  idempotencyKey: string;
  quote: () => Promise<{ txs: { to: `0x${string}`; data: `0x${string}`; value: bigint }[] }>;
  successText: string;
}

async function runRoute(params: RunRouteParams): Promise<void> {
  const { ctx, user, header, txType, idempotencyKey, quote, successText } = params;
  await editSafe(ctx, `${header}\n\n🔎 Building transaction…`);
  try {
    const { txs } = await quote();
    const client = createPublicClientForUser(
      user.mevProtection === "flashbots" ? "flashbots" : "off"
    );
    let lastStatus = "";
    const result = await executeRoute({
      userId: user.id,
      walletId: user.privyWalletId as string,
      walletAddress: user.walletAddress as `0x${string}`,
      idempotencyKey,
      txs,
      type: txType,
      client,
      onStatus: (status, detail) => {
        const line = statusLine(status, detail);
        if (line === lastStatus) return;
        lastStatus = line;
        void editSafe(ctx, `${header}\n\n${line}`);
      },
    });
    if (result.ok) {
      const hash = result.hashes[result.hashes.length - 1];
      await editSafe(
        ctx,
        `${header}\n\n` +
          (result.deduped
            ? `♻️ Already processed — this confirm was a duplicate tap. No second transaction was sent.\n`
            : `${successText}\n`) +
          (hash ? `\nTx: https://etherscan.io/tx/${hash}` : "")
      );
    } else {
      await editSafe(ctx, `${header}\n\n❌ Not completed.\n\n${describeExecutionError(result.error)}`);
    }
  } catch (error) {
    botLogger.error({ error: String(error), txType }, "earn-ux: execution error");
    const msg = error instanceof Error ? error.message : "unexpected error";
    await editSafe(
      ctx,
      `${header}\n\n❌ Failed before broadcast — nothing was sent on-chain.\n\n${msg}`
    );
  }
}

// ---------------------------------------------------------------------------
// Preview builders (used by commands)
// ---------------------------------------------------------------------------

export function buildSaveDepositPreview(
  token: SaveToken,
  amount: number
): { text: string; keyboard: InlineKeyboard } {
  const intent = createActionIntent("sd", {
    p1: token === "usdc" ? "u" : "f",
    p2: packAmount(amount),
  });
  const text =
    `🏦 fxSAVE Deposit Preview\n\n` +
    `Deposit: ${amount} ${token === "usdc" ? "USDC" : "fxUSD"} → fxSAVE\n` +
    `You receive yield-bearing fxSAVE shares.\n` +
    PREVIEW_FOOTER;
  return { text, keyboard: confirmKeyboard(intent) };
}

export function buildSaveWithdrawPreview(
  shares: number | "all",
  instant: boolean
): { text: string; keyboard: InlineKeyboard } {
  const intent = createActionIntent("sw", {
    p1: instant ? "i" : "c",
    p2: shares === "all" ? "0" : packAmount(shares),
  });
  const text =
    `🔓 fxSAVE Withdraw Preview\n\n` +
    `Shares: ${shares === "all" ? "ALL" : shares} fxSAVE → fxUSD\n` +
    `Mode: ${instant ? "Instant (small fee + slippage)" : "2-step (no fee — request now, /claim after the cooldown)"}\n` +
    PREVIEW_FOOTER;
  return { text, keyboard: confirmKeyboard(intent) };
}

export function buildClaimPreview(preview: {
  pendingShares: string;
  previewFxUsd: string | null;
  previewUsdc: string | null;
}): { text: string; keyboard: InlineKeyboard } {
  const intent = createActionIntent("sc", {});
  const receives = [
    preview.previewFxUsd ? `≈ ${Number(preview.previewFxUsd).toFixed(2)} fxUSD` : null,
    preview.previewUsdc && Number(preview.previewUsdc) > 0
      ? `≈ ${Number(preview.previewUsdc).toFixed(2)} USDC`
      : null,
  ].filter(Boolean);
  const text =
    `💎 Claim Matured Redemption\n\n` +
    `Pending: ${Number(preview.pendingShares).toFixed(4)} fxSAVE shares\n` +
    (receives.length ? `You receive: ${receives.join(" + ")}\n` : "") +
    PREVIEW_FOOTER;
  return { text, keyboard: confirmKeyboard(intent) };
}

export function buildMintPreview(
  market: Market,
  collateral: number,
  fxUsd: number
): { text: string; keyboard: InlineKeyboard } {
  const marketIdx = (MARKETS as readonly string[]).indexOf(market);
  const intent = createActionIntent("mt", {
    p1: String(marketIdx),
    p2: packAmount(collateral),
    p3: packAmount(fxUsd),
  });
  const text =
    `🏛 Mint fxUSD Preview\n\n` +
    `Deposit: ${collateral} ${market} collateral\n` +
    `Mint: ${fxUsd} fxUSD (borrow against your collateral)\n` +
    `This opens a new borrowing position — track it with /portfolio, repay with /repay.\n` +
    `\n⚠️ Borrowing carries liquidation risk if your collateral value falls.` +
    PREVIEW_FOOTER;
  return { text, keyboard: confirmKeyboard(intent) };
}

export function buildRepayPreview(
  market: Market,
  positionId: number,
  amount: number | "all"
): { text: string; keyboard: InlineKeyboard } {
  const marketIdx = (MARKETS as readonly string[]).indexOf(market);
  const intent = createActionIntent("rp", {
    p1: String(marketIdx),
    p2: positionId.toString(36),
    p3: amount === "all" ? "0" : packAmount(amount),
  });
  const text =
    `💸 Repay Preview\n\n` +
    `Position: ${market} #${positionId}\n` +
    `Repay: ${amount === "all" ? "ALL outstanding debt" : `${amount} fxUSD`}\n` +
    PREVIEW_FOOTER;
  return { text, keyboard: confirmKeyboard(intent) };
}

// ---------------------------------------------------------------------------
// Execution per intent kind
// ---------------------------------------------------------------------------

async function executeSaveDeposit(ctx: Context, intent: ActionIntent): Promise<void> {
  const token: SaveToken = intent.p1 === "u" ? "usdc" : "fxUSD";
  const amount = unpackAmount(intent.p2);
  const header = `🏦 fxSAVE Deposit — ${amount} ${token === "usdc" ? "USDC" : "fxUSD"}`;
  const user = await requireWalletUser(ctx, header);
  if (!user || amount <= 0) {
    if (user) await editSafe(ctx, `${header}\n\n❌ Invalid amount.`);
    return;
  }
  const sdk = createFxSdk();
  await runRoute({
    ctx,
    user,
    header,
    txType: "fxsave_deposit",
    idempotencyKey: `save:${user.id}:${intent.nonce}`,
    quote: async () => ({
      txs: await quoteSaveDeposit({
        sdk,
        userAddress: user.walletAddress,
        tokenIn: token,
        amountWei: parseUnits(String(amount), token === "usdc" ? 6 : 18),
        slippagePercent: user.slippageBps / 100,
      }),
    }),
    successText: `✅ Deposited into fxSAVE. Check /save for your balance.`,
  });
}

async function executeSaveWithdraw(ctx: Context, intent: ActionIntent): Promise<void> {
  const instant = intent.p1 === "i";
  const amount = unpackAmount(intent.p2); // 0 = all
  const header = `🔓 fxSAVE Withdraw — ${amount === 0 ? "ALL" : amount} shares (${instant ? "instant" : "2-step"})`;
  const user = await requireWalletUser(ctx, header);
  if (!user) return;
  const sdk = createFxSdk();
  await runRoute({
    ctx,
    user,
    header,
    txType: "fxsave_withdraw",
    idempotencyKey: `save:${user.id}:${intent.nonce}`,
    quote: async () => {
      let sharesWei =
        amount === 0
          ? (await sdk.getFxSaveBalance({ userAddress: user.walletAddress })).balanceWei
          : parseUnits(String(amount), 18);
      if (sharesWei <= 0n) throw new Error("No fxSAVE balance to withdraw.");
      return {
        txs: await quoteSaveWithdraw({
          sdk,
          userAddress: user.walletAddress,
          sharesWei,
          instant,
          slippagePercent: user.slippageBps / 100,
        }),
      };
    },
    successText: instant
      ? `✅ Withdrawn instantly to fxUSD.`
      : `✅ Withdrawal requested. After the cooldown, run /claim to receive your fxUSD.`,
  });
}

async function executeSaveClaim(ctx: Context, intent: ActionIntent): Promise<void> {
  const header = `💎 Claim fxSAVE Redemption`;
  const user = await requireWalletUser(ctx, header);
  if (!user) return;
  const sdk = createFxSdk();
  await runRoute({
    ctx,
    user,
    header,
    txType: "fxsave_claim",
    idempotencyKey: `save:${user.id}:${intent.nonce}`,
    quote: async () => {
      const status = await getSaveClaimable(sdk, user.walletAddress);
      if (!status.hasPendingRedeem) throw new Error("No pending redemption to claim.");
      if (!status.isCooldownComplete) throw new Error("Cooldown not finished yet — try later.");
      return { txs: await quoteSaveClaim(sdk, user.walletAddress) };
    },
    successText: `✅ Claimed — funds are in your wallet (/balance).`,
  });
}

async function executeMint(ctx: Context, intent: ActionIntent): Promise<void> {
  const market = MARKETS[Number(intent.p1)];
  const collateral = unpackAmount(intent.p2);
  const fxUsd = unpackAmount(intent.p3);
  if (!market || collateral <= 0 || fxUsd <= 0) {
    await editSafe(ctx, `🏛 Mint fxUSD\n\n❌ Invalid parameters.`);
    return;
  }
  const header = `🏛 Mint — ${collateral} ${market} → ${fxUsd} fxUSD`;
  const user = await requireWalletUser(ctx, header);
  if (!user) return;
  const sdk = createFxSdk();
  await runRoute({
    ctx,
    user,
    header,
    txType: "mint",
    idempotencyKey: `mint:${user.id}:${intent.nonce}`,
    quote: async () => {
      const q = await quoteDepositAndMint({
        sdk,
        userAddress: user.walletAddress,
        market,
        collateralWei: parseUnits(String(collateral), collateralDecimals(market)),
        mintWei: parseUnits(String(fxUsd), 18),
      });
      return { txs: q.txs };
    },
    successText: `✅ Minted ${fxUsd} fxUSD against your ${market}. Track with /portfolio, repay with /repay.`,
  });
}

async function executeRepay(ctx: Context, intent: ActionIntent): Promise<void> {
  const market = MARKETS[Number(intent.p1)];
  const positionId = parseInt(intent.p2, 36);
  const amount = unpackAmount(intent.p3); // 0 = all
  if (!market || !Number.isFinite(positionId) || positionId <= 0) {
    await editSafe(ctx, `💸 Repay\n\n❌ Invalid parameters.`);
    return;
  }
  const header = `💸 Repay — ${market} #${positionId} (${amount === 0 ? "ALL" : `${amount} fxUSD`})`;
  const user = await requireWalletUser(ctx, header);
  if (!user) return;
  const sdk = createFxSdk();
  await runRoute({
    ctx,
    user,
    header,
    txType: "repay",
    idempotencyKey: `repay:${user.id}:${intent.nonce}`,
    quote: async () => {
      // Resolve "all" + ownership server-side at confirm time.
      const positions = await getPositions(sdk, user.walletAddress, market, "long");
      const pos = positions.find((p) => p.positionId === positionId);
      if (!pos) throw new Error(`Position #${positionId} not found in your ${market} positions.`);
      if (pos.rawDebts <= 0n) throw new Error(`Position #${positionId} has no outstanding debt.`);
      let repayWei = amount === 0 ? pos.rawDebts : parseUnits(String(amount), 18);
      if (repayWei > pos.rawDebts) repayWei = pos.rawDebts;
      return {
        txs: await quoteRepay({
          sdk,
          userAddress: user.walletAddress,
          market,
          positionId,
          repayWei,
        }),
      };
    },
    successText: `✅ Debt repaid. Check /portfolio for the updated position.`,
  });
}

// ---------------------------------------------------------------------------
// Callback routing
// ---------------------------------------------------------------------------

export async function handleActionCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery().catch(() => undefined);

  if (data === "a1c") {
    await editSafe(ctx, "❌ Cancelled. Nothing was sent on-chain.");
    return;
  }

  const verdict = verifyActionIntent(data);
  if (!verdict.ok) {
    const why =
      verdict.reason === "expired"
        ? "This preview expired (10 min). Run the command again for a fresh quote."
        : "This button is no longer valid. Run the command again.";
    await editSafe(ctx, `⚠️ ${why}`);
    return;
  }

  const { intent } = verdict;
  switch (intent.kind) {
    case "sd":
      return executeSaveDeposit(ctx, intent);
    case "sw":
      return executeSaveWithdraw(ctx, intent);
    case "sc":
      return executeSaveClaim(ctx, intent);
    case "mt":
      return executeMint(ctx, intent);
    case "rp":
      return executeRepay(ctx, intent);
  }
}
