'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  useConnectWallet,
  useLogin,
  useLogout,
  usePrivy,
  useSendTransaction,
  useWallets,
  type ConnectedWallet,
  type SendTransactionModalUIOptions,
} from '@privy-io/react-auth';
import { assertLocalForkRpcUrl } from '@/lib/fx/config';
import { switchBrowserChain as switchBrowserChainWithConfig } from './switchBrowserChain';

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
  /** Request an account from the user's browser wallet. No private key leaves the wallet. */
  connect: () => Promise<void>;
  /** End the app wallet session. This never transfers assets or exposes keys. */
  disconnect: () => Promise<void>;
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

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function browserProvider(): Eip1193Provider | undefined {
  if (typeof window === 'undefined') return undefined;
  if (process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === '1') {
    const address = process.env.NEXT_PUBLIC_FX_SCREENSHOT_WALLET_ADDRESS;
    const rpcUrl = process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL;
    if (address && rpcUrl) return screenshotProvider(address, rpcUrl);
  }
  return window.ethereum;
}

let screenshotProviderInstance: Eip1193Provider | undefined;
function screenshotProvider(address: string, rpcUrl: string): Eip1193Provider {
  if (screenshotProviderInstance) return screenshotProviderInstance;
  const normalizedAddress = address.toLowerCase();
  const localRpc = assertLocalForkRpcUrl(rpcUrl, 'Screenshot fork RPC URL');
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  screenshotProviderInstance = {
    request: async ({ method, params }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [normalizedAddress];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_sendTransaction') throw new Error('Screenshot fork wallet is read-only.');
      const response = await fetch(localRpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? [] }),
      });
      if (!response.ok) throw new Error(`Screenshot fork RPC returned HTTP ${response.status}`);
      const payload = await response.json() as { result?: unknown; error?: { message?: string } };
      if (payload.error) throw new Error(payload.error.message ?? 'Screenshot fork RPC request failed');
      return payload.result;
    },
    on: (event, listener) => { (listeners.get(event) ?? (listeners.set(event, new Set()), listeners.get(event)!)).add(listener); },
    removeListener: (event, listener) => { listeners.get(event)?.delete(listener); },
  };
  return screenshotProviderInstance;
}

function walletDescriptor(provider: Eip1193Provider, address: string, chainId?: number): FxSelectedWallet {
  const selectedChain = chainId === FX_CHAIN_IDS.ethereum || chainId === FX_CHAIN_IDS.base ? chainId : undefined;
  return {
    address,
    type: 'ethereum',
    walletClientType: 'browser',
    chainId: selectedChain ? `eip155:${selectedChain}` : undefined,
    getEthereumProvider: async () => provider,
    switchChain: async (nextChain: FxChainId) => switchBrowserChain(provider, nextChain),
  } as unknown as FxSelectedWallet;
}

async function switchBrowserChain(provider: Eip1193Provider, chainId: FxChainId): Promise<void> {
  return switchBrowserChainWithConfig(provider, chainId, () => ({
    // Keep literal env accesses so Next can inline the static browser build.
    configuredRpcUrl: chainId === FX_CHAIN_IDS.ethereum
      ? process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL
      : process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL,
    localForkRpcUrl: process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === '1'
      ? process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL
      : undefined,
  }));
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
  const { login } = useLogin();
  const { logout } = useLogout();
  const { connectWallet } = useConnectWallet();
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

  const connect = useCallback(async () => {
    if (authenticated) {
      connectWallet();
      return;
    }
    login({ loginMethods: ['wallet'] });
  }, [authenticated, connectWallet, login]);

  const disconnect = useCallback(async () => {
    await logout();
    setSelectedAddress(undefined);
  }, [logout]);

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
    connect,
    disconnect,
    selectWallet,
    switchChain,
    sendTransaction,
  };
}

const FxWalletContext = createContext<FxPrivyWallet | null>(null);

const BROWSER_DISCONNECTED_KEY = 'fxaeon:browser-wallet-disconnected';

/** Bridge Privy's hooks into a small app-owned context mounted once. */
export function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const wallet = usePrivyWalletAdapter();
  return createElement(FxWalletContext.Provider, { value: wallet }, children);
}

/** Browser-only wallet provider used when the optional Privy service is not configured. */
export function BrowserWalletProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<string>();
  const [chainId, setChainId] = useState<FxChainId>();
  const provider = browserProvider();

  const sync = useCallback(async (requestAccounts = false) => {
    const currentProvider = browserProvider();
    if (!currentProvider) throw new Error('No browser wallet detected. Install MetaMask, Coinbase Wallet, or another EVM wallet to continue.');
    if (!requestAccounts && window.localStorage.getItem(BROWSER_DISCONNECTED_KEY) === '1') {
      setAddress(undefined);
      setChainId(undefined);
      return;
    }
    const accounts = await currentProvider.request({ method: requestAccounts ? 'eth_requestAccounts' : 'eth_accounts' });
    const nextAddress = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : undefined;
    setAddress(nextAddress);
    const rawChain = await currentProvider.request({ method: 'eth_chainId' });
    const parsed = asChainNumber(typeof rawChain === 'string' ? rawChain : String(rawChain));
    setChainId(parsed === FX_CHAIN_IDS.ethereum || parsed === FX_CHAIN_IDS.base ? parsed : undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sync().catch(() => undefined).finally(() => { if (!cancelled) setReady(true); });
    if (!provider?.on) return () => { cancelled = true; };
    const onAccounts = (...args: unknown[]) => {
      if (window.localStorage.getItem(BROWSER_DISCONNECTED_KEY) === '1') {
        setAddress(undefined);
        setChainId(undefined);
        return;
      }
      const accounts = Array.isArray(args[0]) ? args[0] : [];
      setAddress(typeof accounts[0] === 'string' ? accounts[0] : undefined);
    };
    const onChain = (...args: unknown[]) => {
      const parsed = asChainNumber(typeof args[0] === 'string' ? args[0] : undefined);
      setChainId(parsed === FX_CHAIN_IDS.ethereum || parsed === FX_CHAIN_IDS.base ? parsed : undefined);
    };
    const onDisconnect = () => { setAddress(undefined); setChainId(undefined); };
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    provider.on('disconnect', onDisconnect);
    return () => {
      cancelled = true;
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
      provider.removeListener?.('disconnect', onDisconnect);
    };
  }, [provider, sync]);

  const connect = useCallback(async () => {
    window.localStorage.removeItem(BROWSER_DISCONNECTED_KEY);
    try {
      await sync(true);
    } catch (cause) {
      window.localStorage.setItem(BROWSER_DISCONNECTED_KEY, '1');
      throw cause;
    }
  }, [sync]);
  const disconnect = useCallback(async () => {
    window.localStorage.setItem(BROWSER_DISCONNECTED_KEY, '1');
    setAddress(undefined);
    setChainId(undefined);
    const currentProvider = browserProvider();
    if (!currentProvider) return;
    try {
      await currentProvider.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // EIP-1193 has no universal disconnect method. The app-level marker
      // still ends this session when a wallet does not implement revocation.
    }
  }, []);
  const selectedWallet = useMemo(
    () => address && provider ? walletDescriptor(provider, address, chainId) : undefined,
    [address, chainId, provider],
  );
  const switchChain = useCallback(async (nextChain: FxChainId) => {
    if (!provider || !selectedWallet) throw new Error('Connect a browser wallet before switching networks.');
    await switchBrowserChain(provider, nextChain);
    setChainId(nextChain);
  }, [provider, selectedWallet]);
  const sendTransaction = useCallback(async (transaction: FxWalletTransaction) => {
    if (!provider || !selectedWallet?.address) throw new Error('Connect a browser wallet before signing a transaction.');
    if (transaction.from && transaction.from.toLowerCase() !== selectedWallet.address.toLowerCase()) throw new Error('Transaction sender does not match the selected wallet.');
    if (chainId !== transaction.chainId) {
      await switchBrowserChain(provider, transaction.chainId);
      setChainId(transaction.chainId);
    }
    const providerChain = await provider.request({ method: 'eth_chainId' });
    if (asChainNumber(typeof providerChain === 'string' ? providerChain : String(providerChain)) !== transaction.chainId) throw new Error('The connected wallet is on the wrong network. Switch chains and try again.');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || !accounts.some((account): account is string => typeof account === 'string' && account.toLowerCase() === selectedWallet.address!.toLowerCase())) throw new Error('The connected wallet account does not match the selected wallet.');
    const request: Record<string, string> = { from: selectedWallet.address, to: transaction.to };
    if (transaction.data !== undefined) request.data = transaction.data;
    for (const [key, value] of [['value', transaction.value], ['nonce', transaction.nonce], ['gas', transaction.gasLimit], ['gasPrice', transaction.gasPrice], ['maxFeePerGas', transaction.maxFeePerGas], ['maxPriorityFeePerGas', transaction.maxPriorityFeePerGas] ] as const) {
      const normalized = asHexQuantity(value);
      if (normalized !== undefined) request[key] = normalized;
    }
    const result = await provider.request({ method: 'eth_sendTransaction', params: [request] });
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('The connected wallet returned an invalid transaction hash.');
    return { hash: result as `0x${string}` };
  }, [chainId, provider, selectedWallet]);
  const wallet: FxPrivyWallet = useMemo(() => ({
    ready,
    authenticated: Boolean(address),
    wallets: selectedWallet ? [selectedWallet] : [],
    selectedWallet,
    chainId,
    address,
    isEmbedded: false,
    connect,
    disconnect,
    selectWallet: () => undefined,
    switchChain,
    sendTransaction,
  }), [address, chainId, connect, disconnect, ready, selectedWallet, sendTransaction, switchChain]);
  return createElement(FxWalletContext.Provider, { value: wallet }, children);
}

/** Backwards-compatible name for builds that intentionally omit Privy. */
export function UnavailableWalletProvider({ children }: { children: ReactNode }) {
  return createElement(BrowserWalletProvider, null, children);
}

export function usePrivyWallet(): FxPrivyWallet {
  const wallet = useContext(FxWalletContext);
  if (!wallet) throw new Error('usePrivyWallet must be used inside PrivyClientProvider');
  return wallet;
}
