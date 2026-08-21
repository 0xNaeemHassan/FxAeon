import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendTransaction: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock('../src/middleware/config.js', () => ({
  features: { enablePrivyWalletApi: true },
  getConfig: () => ({
    PRIVY_APP_ID: 'app-test',
    PRIVY_APP_SECRET: 'secret-test',
    PRIVY_AUTHORIZATION_KEY: 'auth-test',
  }),
}));

vi.mock('@privy-io/server-auth', () => ({
  PrivyClient: class {
    walletApi = {
      ethereum: {
        sendTransaction: mocks.sendTransaction,
        signTransaction: mocks.signTransaction,
      },
    };
  },
}));

import {
  __resetPrivyClientForTests,
  sendWalletTransaction,
  signWalletTransaction,
} from '../src/core/privy.js';

const TO = '0x1111111111111111111111111111111111111111' as const;

describe('Privy source-chain selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPrivyClientForTests();
  });

  it('uses Base CAIP-2 for a Base public broadcast', async () => {
    mocks.sendTransaction.mockResolvedValue({ hash: '0xabc', caip2: 'eip155:8453' });
    await sendWalletTransaction('wallet-1', { to: TO, chainId: 8453, type: 2 }, 8453);
    expect(mocks.sendTransaction).toHaveBeenCalledWith({
      walletId: 'wallet-1',
      caip2: 'eip155:8453',
      transaction: { to: TO, chainId: 8453, type: 2 },
    });
  });

  it('keeps Ethereum as the compatibility default', async () => {
    mocks.sendTransaction.mockResolvedValue({ hash: '0xdef', caip2: 'eip155:1' });
    await sendWalletTransaction('wallet-1', { to: TO, chainId: 1, type: 2 });
    expect(mocks.sendTransaction.mock.calls[0][0].caip2).toBe('eip155:1');
  });

  it('refuses CAIP-2/transaction chain mismatches before calling Privy', async () => {
    await expect(
      sendWalletTransaction('wallet-1', { to: TO, chainId: 1 }, 8453)
    ).rejects.toThrow(/chain mismatch/i);
    await expect(
      signWalletTransaction('wallet-1', { to: TO, chainId: 1 }, 8453)
    ).rejects.toThrow(/chain mismatch/i);
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.signTransaction).not.toHaveBeenCalled();
  });
});
