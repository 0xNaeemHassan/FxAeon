/**
 * core/broadcast.ts — the single MEV-aware broadcast path.
 *
 * Verifies that the user's mevProtection setting is no longer cosmetic:
 *  - "off"       → Privy's public-mempool sendTransaction (unchanged behaviour)
 *  - "flashbots" → sign via Privy, then submit the RAW tx privately (never the
 *                  public mempool). A missing nonce fails loudly rather than
 *                  silently downgrading a user who asked for protection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const sendTxMock = vi.fn();
const signTxMock = vi.fn();

vi.mock("../src/core/privy.js", () => ({
  sendWalletTransaction: (...a: unknown[]) => sendTxMock(...a),
  signWalletTransaction: (...a: unknown[]) => signTxMock(...a),
}));

import { broadcastTransaction, type BroadcastTx } from "../src/core/broadcast.js";

const WALLET_ID = "wallet-123";
const baseTx: BroadcastTx = {
  to: ("0x" + "1".repeat(40)) as `0x${string}`,
  data: "0xabcdef",
  value: "0x0",
  nonce: "0x5",
  gasLimit: "0x5208",
  maxFeePerGas: "0x77359400",
  maxPriorityFeePerGas: "0x3b9aca00",
};

beforeEach(() => {
  sendTxMock.mockReset();
  signTxMock.mockReset();
});

describe("broadcastTransaction — mev 'off'", () => {
  it("broadcasts via Privy sendTransaction and never signs separately", async () => {
    sendTxMock.mockResolvedValue({ hash: "0x" + "a".repeat(64) });

    const hash = await broadcastTransaction(WALLET_ID, baseTx, "off");

    expect(hash).toBe("0x" + "a".repeat(64));
    expect(sendTxMock).toHaveBeenCalledTimes(1);
    expect(signTxMock).not.toHaveBeenCalled();
    // chainId/type are stamped server-side, never taken from the client.
    const [walletId, tx] = sendTxMock.mock.calls[0];
    expect(walletId).toBe(WALLET_ID);
    expect(tx).toMatchObject({ chainId: 1, type: 2, nonce: "0x5", to: baseTx.to });
  });
});

describe("broadcastTransaction — mev 'flashbots'", () => {
  it("signs via Privy then submits the RAW tx privately (no public send)", async () => {
    signTxMock.mockResolvedValue({ signedTransaction: "0xdeadbeef", encoding: "rlp" });
    const rawSend = vi.fn().mockResolvedValue("0x" + "c".repeat(64));

    const hash = await broadcastTransaction(WALLET_ID, baseTx, "flashbots", { rawSend });

    expect(hash).toBe("0x" + "c".repeat(64));
    expect(signTxMock).toHaveBeenCalledTimes(1);
    expect(rawSend).toHaveBeenCalledWith("0xdeadbeef");
    // Critically: the tx must NOT also go out via the public mempool.
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("refuses to broadcast without an explicit nonce (no silent downgrade)", async () => {
    const { nonce, ...noNonce } = baseTx;
    void nonce;
    const rawSend = vi.fn();

    await expect(
      broadcastTransaction(WALLET_ID, noNonce as BroadcastTx, "flashbots", { rawSend })
    ).rejects.toThrow(/nonce/i);

    expect(signTxMock).not.toHaveBeenCalled();
    expect(rawSend).not.toHaveBeenCalled();
    expect(sendTxMock).not.toHaveBeenCalled();
  });
});
