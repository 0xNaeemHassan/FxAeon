'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  usePrivy,
  useSendTransaction,
  useWallets,
  type ConnectedWallet,
  type SendTransactionModalUIOptions,
} from '@privy-io/react-auth';

export const FX_CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
} as const;

export type FxChainId = (typeof FX_CHAIN_IDS)[keyof typeof FX_CHAIN_IDS];

/**
 * The transaction shape the client transaction runner hands to Privy.
 * Quantities intentionally accept the same JSON-safe values as Privy's
 * UnsignedTransactionRequest. Callers should pass hex strings for calldata
 * and numeric quantities when possible.
 */
export type FxWalletTransaction = {
  from?: string;
  to: string;
  data?: string;
  value?: string | number | bigint;
  nonce?: string | number | bigint;
  gasLimit?: string | number | bigint;
  gasPrice?: string | number | bigint;
  maxFeePerGas?: string | number | bigint;
  maxPriorityFeePerGas?: string | number | bigint;
  chainId: FxChainId;
};

export type FxWalletTransactionOptions = {
  description?: string;
  action?: string;
  buttonText?: string;
  successHeader?: string;
  successDescription?: string;
};

export type FxSelectedWallet = ConnectedWallet & {
  walletClientType?: string;
};

export type FxPrivyWallet = {
  ready: boolean;
  authenticated: boolean;
  wallets: ConnectedWallet[];
  selectedWallet?: FxSelectedWallet;
  /** Current selected wallet network when Privy has a supported chain value. */
  chainId?: FxChainId;
  address?: string;
  isEmbedded: boolean;
  selectWallet: (address: string) => void;
  switchChain: (chainId: FxChainId) => Promise<void>;
  sendTransaction: (
    transaction: FxWalletTransaction,
    options?: FxWalletTransactionOptions
  ) => Promise<{ hash: `0x${string}` }>;
};

function asChainNumber(chainId: string | undefined): number | undefined {
  if (!chainId) return undefined;
  const value = chainId.startsWith('eip155:') ? chainId.slice(7) : chainId;
  const parsed = value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asHexQuantity(value: string | number | bigint | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (!/^0x[0-9a-f]+$/i.test(value) && !/^\d+$/.test(value)) {
      throw new Error('Transaction quantity is not a valid non-negative integer.');
    }
    const normalized = BigInt(value);
    return `0x${normalized.toString(16)}`;
  }
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Transaction quantity is not a valid non-negative integer.');
  }
  if (typeof value === 'bigint' && value < 0n) {
    throw new Error('Transaction quantity is not a valid non-negative integer.');
  }
  return `0x${BigInt(value).toString(16)}`;
}

function isEmbedded(wallet: ConnectedWallet | undefined): boolean {
  return wallet?.walletClientType === 'privy' || wallet?.walletClientType === 'privy-v2';
}

/**
 * Thin adapter over Privy's user-owned wallet APIs.
 *
 * - Embedded wallets use `useSendTransaction`, which opens Privy's visible
 *   confirmation modal for every transaction.
 * - Connected external wallets receive the same request through their EIP-1193
 *   provider, which delegates confirmation to that wallet's own UI.
 * - No FxAeon backend or private-key material is involved.
 */
function usePrivyWalletAdapter(): FxPrivyWallet {
  const { ready, authenticated } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { sendTransaction: sendEmbeddedTransaction } = useSendTransaction();
  const [selectedAddress, setSelectedAddress] = useState<string>();

  const selectedWallet = useMemo(() => {
    const selected = selectedAddress
      ? wallets.find((wallet) => wallet.address.toLowerCase() === selectedAddress.toLowerCase())
      : undefined;
    if (selected) return selected as FxSelectedWallet;

    // Prefer the embedded wallet for protocol interactions because Privy can
    // guarantee its explicit confirmation modal. The user may select an
    // external wallet when one is connected.
    return (
      wallets.find((wallet) => isEmbedded(wallet)) ?? wallets.find((wallet) => wallet.type === 'ethereum')
    ) as FxSelectedWallet | undefined;
  }, [selectedAddress, wallets]);

  const selectedChainId = useMemo(() => {
    const chainId = asChainNumber(selectedWallet?.chainId);
    return chainId === FX_CHAIN_IDS.ethereum || chainId === FX_CHAIN_IDS.base
      ? chainId
      : undefined;
  }, [selectedWallet]);

  useEffect(() => {
    if (!selectedAddress || !wallets.some((wallet) => wallet.address.toLowerCase() === selectedAddress.toLowerCase())) {
      const next = selectedWallet?.address;
      if (next && next !== selectedAddress) setSelectedAddress(next);
    }
  }, [selectedAddress, selectedWallet, wallets]);

  const selectWallet = useCallback((address: string) => {
    const wallet = wallets.find((candidate) => candidate.address.toLowerCase() === address.toLowerCase());
    if (wallet) setSelectedAddress(wallet.address);
  }, [wallets]);

  const switchChain = useCallback(async (chainId: FxChainId) => {
    if (!selectedWallet) throw new Error('Connect a wallet before switching networks.');
    await selectedWallet.switchChain(chainId);
  }, [selectedWallet]);

  const sendTransaction = useCallback(async (
    transaction: FxWalletTransaction,
    options?: FxWalletTransactionOptions
  ) => {
    if (transaction.chainId !== FX_CHAIN_IDS.ethereum && transaction.chainId !== FX_CHAIN_IDS.base) {
      throw new Error('FxAeon only signs transactions on Ethereum or Base.');
    }
    if (!authenticated || !selectedWallet || !selectedWallet.address) {
      throw new Error('Connect a wallet before signing a transaction.');
    }
    if (transaction.from && transaction.from.toLowerCase() !== selectedWallet.address.toLowerCase()) {
      throw new Error('Transaction sender does not match the selected wallet.');
    }

    const currentChain = asChainNumber(selectedWallet.chainId);
    // An absent/unknown wallet chain is not equivalent to the requested
    // chain. Ask the wallet to switch in that case, then independently verify
    // the provider below before sending an external-wallet transaction.
    if (currentChain !== transaction.chainId) {
      await selectedWallet.switchChain(transaction.chainId);
    }

    const request = {
      from: selectedWallet.address,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      nonce: transaction.nonce,
      gasLimit: transaction.gasLimit,
      gasPrice: transaction.gasPrice,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      chainId: transaction.chainId,
    };

    const uiOptions: SendTransactionModalUIOptions = {
      showWalletUIs: true,
      description: options?.description ?? 'Review this f(x) transaction in your wallet.',
      buttonText: options?.buttonText ?? 'Approve transaction',
      successHeader: options?.successHeader ?? 'Transaction submitted',
      successDescription: options?.successDescription ?? 'Your transaction is now being confirmed on-chain.',
      isCancellable: true,
      transactionInfo: options?.action ? { action: options.action } : undefined,
    };

    // Independently verify the provider immediately before either signing
    // path. Privy's hook remains the embedded-wallet prompt authority, but
    // selected React state alone must never establish chain/account identity.
    const provider = await selectedWallet.getEthereumProvider();
    const providerChain = await provider.request({ method: 'eth_chainId' });
    if (asChainNumber(typeof providerChain === 'string' ? providerChain : String(providerChain)) !== transaction.chainId) {
      throw new Error('The connected wallet is on the wrong network. Switch chains and try again.');
    }
    const providerAccounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(providerAccounts) || !providerAccounts.some(
      (account): account is string => typeof account === 'string'
        && account.toLowerCase() === selectedWallet.address.toLowerCase(),
    )) {
      throw new Error('The connected wallet account does not match the selected signing wallet.');
    }

    if (isEmbedded(selectedWallet)) {
      return sendEmbeddedTransaction(request, {
        address: selectedWallet.address,
        uiOptions,
      });
    }

    const providerRequest: Record<string, string> = {
      from: selectedWallet.address,
      to: transaction.to,
    };
    const data = transaction.data;
    if (data !== undefined) providerRequest.data = data;
    const value = asHexQuantity(transaction.value);
    if (value !== undefined) providerRequest.value = value;
    const nonce = asHexQuantity(transaction.nonce);
    if (nonce !== undefined) providerRequest.nonce = nonce;
    const gas = asHexQuantity(transaction.gasLimit);
    if (gas !== undefined) providerRequest.gas = gas;
    const gasPrice = asHexQuantity(transaction.gasPrice);
    if (gasPrice !== undefined) providerRequest.gasPrice = gasPrice;
    const maxFeePerGas = asHexQuantity(transaction.maxFeePerGas);
    if (maxFeePerGas !== undefined) providerRequest.maxFeePerGas = maxFeePerGas;
    const maxPriorityFeePerGas = asHexQuantity(transaction.maxPriorityFeePerGas);
    if (maxPriorityFeePerGas !== undefined) providerRequest.maxPriorityFeePerGas = maxPriorityFeePerGas;
    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [providerRequest],
    });
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new Error('The connected wallet returned an invalid transaction hash.');
    }
    return { hash: result as `0x${string}` };
  }, [authenticated, selectedWallet, sendEmbeddedTransaction]);

  return {
    ready: ready && walletsReady,
    authenticated,
    wallets,
    selectedWallet,
    chainId: selectedChainId,
    address: selectedWallet?.address,
    isEmbedded: isEmbedded(selectedWallet),
    selectWallet,
    switchChain,
    sendTransaction,
  };
}

const FxWalletContext = createContext<FxPrivyWallet | null>(null);

/** Bridge Privy's hooks into a small app-owned context mounted once. */
export function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const wallet = usePrivyWalletAdapter();
  return createElement(FxWalletContext.Provider, { value: wallet }, children);
}

const unavailableWallet: FxPrivyWallet = {
  ready: true,
  authenticated: false,
  wallets: [],
  selectedWallet: undefined,
  chainId: undefined,
  address: undefined,
  isEmbedded: false,
  selectWallet: () => undefined,
  switchChain: async () => {
    throw new Error('Wallet service is not configured for this build.');
  },
  sendTransaction: async () => {
    throw new Error('Wallet service is not configured for this build.');
  },
};

/** Honest no-wallet state for local builds that intentionally omit Privy. */
export function UnavailableWalletProvider({ children }: { children: ReactNode }) {
  return createElement(FxWalletContext.Provider, { value: unavailableWallet }, children);
}

export function usePrivyWallet(): FxPrivyWallet {
  const wallet = useContext(FxWalletContext);
  if (!wallet) throw new Error('usePrivyWallet must be used inside PrivyClientProvider');
  return wallet;
}
