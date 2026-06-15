/**
 * /speedup and /cancel — replace a stuck pending transaction (W-11 follow-on).
 *
 * A transaction that has been broadcast but not yet mined sits in the mempool
 * waiting for inclusion. If the fee was too low it can stall for a long time.
 * Ethereum offers no "edit"; the only fix is to rebroadcast at the SAME nonce
 * with a higher fee:
 *
 *   /speedup — resend the original call faster (bumped fees, same nonce).
 *   /cancel  — replace it with a 0-value self-send so the original is voided.
 *
 * Both act on the user's most recent replaceable tx (status 'broadcast' with a
 * stored pending tx), require an explicit Confirm tap, run through the signer
 * policy + receipt watcher, and only ever touch the user's own delegated
 * wallet. Fees are bumped server-side — the user never supplies fee numbers.
 */
import { Context, InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
import { prisma } from "@fxbot/db";
import { formatGwei } from "viem";
import { executeReplacement, readPending, type PendingTx } from "../core/txReplace.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import { describeExecutionError } from "../core/errorTaxonomy.js";
import { createPublicClientForUser, mevModeForUser } from "../fx/index.js";
import { botLogger } from "../middleware/logger.js";

type Kind = "speedup" | "cancel";

interface PendingControl {
  telegramId: string;
  recordId: string;
  kind: Kind;
  expiresAt: number;
}

const PENDING_TTL_MS = 5 * 60 * 1000;
const controls = new Map<string, PendingControl>();

function prune(): void {
  const now = Date.now();
  for (const [id, c] of controls) if (c.expiresAt < now) controls.delete(id);
}

/** Test hook. */
export function __clearTxControlsForTests(): void {
  controls.clear();
}

const label: Record<Kind, string> = { speedup: "Speed up", cancel: "Cancel" };

/** Find the user's most recent replaceable tx (broadcast + a stored pending tx). */
async function latestReplaceable(userId: string): Promise<{ id: string; pending: PendingTx } | null> {
  const recs = await prisma.txRecord.findMany({
    where: { userId, status: "broadcast" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const r of recs) {
    const pending = readPending(r.data);
    if (pending) return { id: r.id, pending };
  }
  return null;
}

async function startControl(ctx: Context, kind: Kind): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please set up your wallet first with /start");
    return;
  }

  const target = await latestReplaceable(user.id);
  if (!target) {
    await ctx.reply(
      `⛽ Nothing to ${kind === "speedup" ? "speed up" : "cancel"}.\n\n` +
        `You have no transaction waiting in the mempool right now. ` +
        `Speed-up/cancel only apply while a tx is broadcast but not yet mined.`
    );
    return;
  }

  prune();
  const id = randomBytes(6).toString("hex");
  controls.set(id, { telegramId, recordId: target.id, kind, expiresAt: Date.now() + PENDING_TTL_MS });

  const p = target.pending;
  const tipGwei = Number(formatGwei(BigInt(p.maxPriorityFeePerGas))).toFixed(2);
  const maxGwei = Number(formatGwei(BigInt(p.maxFeePerGas))).toFixed(2);
  const keyboard = new InlineKeyboard()
    .text(`✅ ${label[kind]}`, `tx_${id}`)
    .text("❌ Dismiss", "tx_cancel");

  await ctx.reply(
    `⛽ ${label[kind]} pending transaction\n\n` +
      `Tx: ${p.hash.slice(0, 10)}…${p.hash.slice(-6)}\n` +
      `Nonce: ${p.nonce}\n` +
      `Current fees: ${tipGwei} gwei tip / ${maxGwei} gwei max\n\n` +
      (kind === "speedup"
        ? `I'll rebroadcast the same action at the same nonce with fees bumped ≥12.5% so it mines sooner.`
        : `I'll send a 0-value transfer to your own wallet at the same nonce, voiding the original.`) +
      `\n\nFees are bumped automatically. Confirm to broadcast — this preview expires in ~5 min.`,
    { reply_markup: keyboard }
  );
}

export async function speedUpCommand(ctx: Context): Promise<void> {
  await startControl(ctx, "speedup");
}

export async function cancelTxCommand(ctx: Context): Promise<void> {
  await startControl(ctx, "cancel");
}

export async function handleTxControlCallback(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery().catch(() => undefined);
  if (!telegramId) return;

  const editSafe = async (text: string) => {
    try {
      await ctx.editMessageText(text);
    } catch (e) {
      botLogger.debug({ error: String(e) }, "txControl: editMessageText skipped");
    }
  };

  if (data === "tx_cancel") {
    await editSafe("❌ Dismissed. Your transaction is unchanged.");
    return;
  }

  const id = data.slice(3);
  prune();
  const req = controls.get(id);
  if (!req || req.telegramId !== telegramId) {
    await editSafe("⌛ This preview expired or is invalid. Run /speedup or /cancel again.");
    return;
  }
  controls.delete(id); // single-use

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await editSafe("🔐 Wallet required — run /start first.");
    return;
  }
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) {
    await editSafe(gate.message);
    return;
  }

  const header = `⛽ ${label[req.kind]} transaction`;
  try {
    await editSafe(`${header}\n\n⏳ Broadcasting replacement at the same nonce…`);
    const result = await executeReplacement({
      recordId: req.recordId,
      walletId: gate.walletId,
      walletAddress: user.walletAddress as `0x${string}`,
      client: createPublicClientForUser(user.mevProtection === "flashbots" ? "flashbots" : "off"),
      mev: mevModeForUser(user.mevProtection),
      kind: req.kind,
    });

    if (result.ok) {
      await editSafe(
        `${header}\n\n` +
          (req.kind === "speedup"
            ? `✅ Sped up — the replacement mined.`
            : `✅ Cancelled — the original was voided by a self-send.`) +
          `\n\nTx: https://etherscan.io/tx/${result.hash}`
      );
    } else {
      await editSafe(`${header}\n\n❌ Not completed.\n\n${describeExecutionError(result.reason)}`);
    }
  } catch (error) {
    botLogger.error({ error: String(error), telegramId }, "txControl: execution error");
    await editSafe(`${header}\n\n❌ Failed before broadcast — your original transaction is unchanged.`);
  }
}
