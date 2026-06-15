/**
 * Single broadcast path — MEV-aware (W-11 follow-on / GAP "real MEV protection").
 *
 * Until now the `mevProtection` toggle was cosmetic: every transaction was sent
 * via Privy's `sendTransaction`, which broadcasts through Privy's own public
 * RPC — i.e. straight into the public mempool where sandwich/front-running bots
 * can see and exploit it. The Flashbots chain override built in fx/index.ts was
 * never used for the actual send.
 *
 * This module makes the toggle real. Every broadcast in the bot (trades,
 * withdrawals, speed-up/cancel) goes through `broadcastTransaction`:
 *
 *   - mev = "flashbots": the user opted into protection. We ask Privy to SIGN
 *     the tx (it does not broadcast), then submit the raw signed tx ourselves
 *     to the Flashbots Protect RPC — a private channel to block builders, never
 *     the public mempool. Because Privy isn't broadcasting, the caller must
 *     pass a fully-formed tx (explicit nonce, gas, fees, chainId, type).
 *   - mev = "off": unchanged — Privy broadcasts via `sendTransaction`.
 *
 * Both paths return the transaction hash. Reads/receipts continue to use the
 * standard RPC (the Flashbots RPC does not serve historical reads).
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { FLASHBOTS_RPC } from "../fx/index.js";
import { sendWalletTransaction, signWalletTransaction } from "./privy.js";

export type MevMode = "off" | "flashbots";

/** A fully-formed EIP-1559 transaction ready to sign or broadcast. */
export interface BroadcastTx {
  to: `0x${string}`;
  data?: `0x${string}`;
  /** wei as hex, or omit for zero. */
  value?: `0x${string}`;
  /** REQUIRED when mev === "flashbots" (we sign+broadcast ourselves). */
  nonce?: `0x${string}`;
  gasLimit: `0x${string}`;
  maxFeePerGas: `0x${string}`;
  maxPriorityFeePerGas: `0x${string}`;
}

/** Optional injection seam for tests (avoids real network in unit tests). */
export interface BroadcastDeps {
  rawSend?: (raw: `0x${string}`) => Promise<`0x${string}`>;
}

let flashbotsClient: PublicClient | null = null;
function getFlashbotsClient(): PublicClient {
  if (!flashbotsClient) {
    flashbotsClient = createPublicClient({ chain: mainnet, transport: http(FLASHBOTS_RPC) });
  }
  return flashbotsClient;
}

/**
 * Broadcast one transaction, honouring the user's MEV-protection choice.
 * Returns the transaction hash. Throws on submission failure (callers map this
 * to their own failed-broadcast handling).
 */
export async function broadcastTransaction(
  walletId: string,
  tx: BroadcastTx,
  mev: MevMode,
  deps?: BroadcastDeps
): Promise<`0x${string}`> {
  const transaction = { ...tx, chainId: 1 as const, type: 2 as const };

  if (mev === "flashbots") {
    if (tx.nonce === undefined) {
      // Privy's signTransaction cannot fill the nonce, and a private raw
      // broadcast needs a complete tx. Fail loudly rather than silently
      // downgrade a user who explicitly asked for MEV protection.
      throw new Error("MEV-protected broadcast requires an explicit nonce");
    }
    const { signedTransaction } = await signWalletTransaction(walletId, transaction);
    const send = deps?.rawSend ?? ((raw) => getFlashbotsClient().sendRawTransaction({ serializedTransaction: raw }));
    return send(signedTransaction);
  }

  const sent = await sendWalletTransaction(walletId, transaction);
  return sent.hash as `0x${string}`;
}
