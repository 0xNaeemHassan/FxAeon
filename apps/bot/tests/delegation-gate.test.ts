import { beforeEach, describe, expect, it, vi } from "vitest";

const syncWalletStateMock = vi.fn();
vi.mock("../src/core/onboarding.js", () => ({
  syncWalletState: (...args: unknown[]) => syncWalletStateMock(...args),
}));

import { requireDelegatedWallet } from "../src/core/delegation.js";

const USER = {
  id: "u1",
  privyUserId: "privy-1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  privyWalletId: "cached-wallet",
  walletDelegated: true,
  walletImported: false,
};

describe("delegation execution gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revalidates even when the database cached a delegated wallet", async () => {
    syncWalletStateMock.mockResolvedValue({
      walletAddress: USER.walletAddress,
      privyWalletId: null,
      walletDelegated: false,
      walletImported: false,
    });
    await expect(requireDelegatedWallet(USER)).resolves.toMatchObject({ ok: false });
    expect(syncWalletStateMock).toHaveBeenCalledWith(USER);
  });

  it("fails closed when Privy is unavailable or the wallet rotated", async () => {
    syncWalletStateMock.mockRejectedValueOnce(new Error("privy down"));
    await expect(requireDelegatedWallet(USER)).resolves.toMatchObject({ ok: false });

    syncWalletStateMock.mockResolvedValueOnce({
      walletAddress: "0x2222222222222222222222222222222222222222",
      privyWalletId: "new-wallet",
      walletDelegated: true,
      walletImported: false,
    });
    await expect(requireDelegatedWallet(USER)).resolves.toMatchObject({ ok: false });
  });

  it("returns only the freshly verified Privy wallet id", async () => {
    syncWalletStateMock.mockResolvedValue({
      walletAddress: USER.walletAddress.toUpperCase().replace("0X", "0x"),
      privyWalletId: "fresh-wallet",
      walletDelegated: true,
      walletImported: false,
    });
    await expect(requireDelegatedWallet(USER)).resolves.toEqual({
      ok: true,
      walletId: "fresh-wallet",
    });
  });
});
