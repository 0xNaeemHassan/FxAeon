'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
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
import { getInitData, isTelegramLaunchContext, restoreTelegramLaunchHash, waitForTelegramWebApp } from '@/lib/telegram';
import { switchBrowserChain as switchBrowserChainWithConfig } from './switchBrowserChain';
import { eip6963FocusTrapDestination, getDiscoveredEip6963Providers, recordEip6963Announcement, selectEip6963Provider, shouldBindEip6963ProviderEvents, shouldPromptEip6963Provider, type DiscoveredEip6963Provider, type Eip6963Announcement } from './eip6963';

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

let eip6963Requested = false;

function discoverEip6963(onChange?: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Announcement>).detail;
    if (recordEip6963Announcement(detail)) onChange?.();
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  if (!eip6963Requested) {
    eip6963Requested = true;
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }
  return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
}

function browserProvider(): Eip1193Provider | undefined {
  if (typeof window === 'undefined') return undefined;
  if (process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === '1') {
    const address = process.env.NEXT_PUBLIC_FX_SCREENSHOT_WALLET_ADDRESS;
    const rpcUrl = process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL;
    if (address && rpcUrl) return screenshotProvider(address, rpcUrl);
  }
  const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
  return (selectEip6963Provider(preferred)?.provider)
    ?? window.ethereum
    ?? getDiscoveredEip6963Providers()[0]?.provider;
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
  // A Telegram launch can finish Privy's seamless authentication shortly
  // after the provider has rendered. Keep the current value in a ref so a
  // click made during that hand-off can await the same session rather than
  // running its action callback against an unauthenticated wallet.
  const authenticatedRef = useRef(authenticated);

  useEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);

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
    if (isTelegramLaunchContext()) {
      // Telegram's WebApp bridge can arrive after the shell and Privy have
      // rendered. Wait for that bridge here as a final hand-off guard instead
      // of surfacing the old "sign-in is initializing" dead end.
      if (!getInitData()) await waitForTelegramWebApp();
      if (!getInitData()) {
        throw new Error('Reopen FxAeon from the Telegram bot menu so signed launch data is available.');
      }
      // The provider consumes this signed hash automatically. This call is a
      // safe idempotent recovery for a late bridge/navigation transition; it
      // never opens the Telegram popup inside the Telegram WebView.
      restoreTelegramLaunchHash();
      // When the button was pressed before Privy completed its automatic
      // Telegram auth, wait for that in-flight session. Once it is ready,
      // continue into Privy's explicit wallet selector so the user still
      // approves the wallet connection themselves. A bounded failure keeps
      // the CTA recoverable and avoids the old generic browser-wallet error.
      if (!authenticatedRef.current) {
        const startedAt = Date.now();
        while (!authenticatedRef.current && Date.now() - startedAt < 15_000) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
        }
      }
      if (!authenticatedRef.current) {
        throw new Error('Automatic Telegram sign-in did not complete. Reopen FxAeon from the bot menu and try again.');
      }
      await connectWallet();
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
  const [, setProviderVersion] = useState(0);
  const [chooser, setChooser] = useState<readonly DiscoveredEip6963Provider[] | null>(null);
  const pendingChoiceRef = useRef<{ resolve: (choice: DiscoveredEip6963Provider) => void; reject: (reason: Error) => void } | null>(null);
  const [address, setAddress] = useState<string>();
  const [chainId, setChainId] = useState<FxChainId>();
  const provider = browserProvider();

  const sync = useCallback(async (requestAccounts = false, providerOverride?: Eip1193Provider) => {
    if (isTelegramLaunchContext()) {
      // The no-Privy build is also used by the static client/E2E harness. A
      // Telegram host must never fall through to browser-wallet discovery,
      // but it also cannot authenticate without Privy's launch-data flow.
      // Keep the provider in a quiet, disconnected state so the CTA remains
      // usable and never paints a misleading browser-wallet error.
      return;
    }
    const currentProvider = providerOverride ?? browserProvider();
    if (!currentProvider) {
      throw new Error('No browser wallet detected. Install MetaMask, Coinbase Wallet, or another EVM wallet to continue.');
    }
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
    const stopDiscovery = discoverEip6963(() => {
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      if (shouldPromptEip6963Provider(preferred)) {
        // A late second announcement invalidates any legacy auto-bind that may
        // have occurred during the single-provider discovery window.
        setAddress(undefined);
        setChainId(undefined);
      }
      setProviderVersion((version) => version + 1);
    });
    let cancelled = false;
    // Give EIP-6963 announcements a short discovery window before restoring
    // an existing account. This prevents a legacy window.ethereum account
    // from becoming the session while the user still has multiple providers
    // to choose from.
    const autoSyncTimer = window.setTimeout(() => {
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      if (!shouldBindEip6963ProviderEvents(preferred)) {
        setReady(true);
        return;
      }
      void sync().catch(() => undefined).finally(() => { if (!cancelled) setReady(true); });
    }, 200);
    let listenersAttached = false;
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
    const attachListeners = () => {
      if (!provider?.on || listenersAttached) return;
      provider.on('accountsChanged', onAccounts);
      provider.on('chainChanged', onChain);
      provider.on('disconnect', onDisconnect);
      listenersAttached = true;
    };
    const attachTimer = window.setTimeout(() => {
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      if (shouldBindEip6963ProviderEvents(preferred)) attachListeners();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(autoSyncTimer);
      window.clearTimeout(attachTimer);
      if (listenersAttached) {
        provider?.removeListener?.('accountsChanged', onAccounts);
        provider?.removeListener?.('chainChanged', onChain);
        provider?.removeListener?.('disconnect', onDisconnect);
      }
      stopDiscovery();
    };
  }, [provider, sync]);

  const connect = useCallback(async () => {
    if (isTelegramLaunchContext()) {
      // Telegram authentication is owned by the Privy adapter above when it
      // is configured. In the intentionally no-Privy/static build there is no
      // safe auth action to invoke; resolve quietly rather than reporting a
      // browser-wallet or Telegram-popup error in the host UI.
      return;
    }
    window.localStorage.removeItem(BROWSER_DISCONNECTED_KEY);
    try {
      const providers = getDiscoveredEip6963Providers();
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      let selected: DiscoveredEip6963Provider | undefined = preferred
        ? providers.find((candidate) => candidate.rdns === preferred)
        : undefined;
      if (providers.length > 1 && !selected) {
        selected = await new Promise<DiscoveredEip6963Provider>((resolve, reject) => {
          pendingChoiceRef.current = { resolve, reject };
          setChooser(providers);
        });
        window.localStorage.setItem('fxaeon:wallet-provider-rdns', selected.rdns);
        setProviderVersion((version) => version + 1);
      }
      await sync(true, selected?.provider);
    } catch (cause) {
      window.localStorage.setItem(BROWSER_DISCONNECTED_KEY, '1');
      throw cause;
    }
  }, [sync]);
  useEffect(() => () => {
    pendingChoiceRef.current?.reject(new Error('Wallet selection was cancelled.'));
    pendingChoiceRef.current = null;
  }, []);
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
  const chooseProvider = useCallback((choice: DiscoveredEip6963Provider) => {
    const pending = pendingChoiceRef.current;
    pendingChoiceRef.current = null;
    setChooser(null);
    pending?.resolve(choice);
  }, []);
  const cancelProviderChoice = useCallback(() => {
    const pending = pendingChoiceRef.current;
    pendingChoiceRef.current = null;
    setChooser(null);
    pending?.reject(new Error('Wallet selection was cancelled.'));
  }, []);
  return createElement(
    FxWalletContext.Provider,
    { value: wallet },
    createElement(ReactFragment, null, children, chooser
      ? createElement(Eip6963ProviderChooser, { providers: chooser, onChoose: chooseProvider, onCancel: cancelProviderChoice })
      : null),
  );
}

function ReactFragment({ children }: { children: ReactNode }) {
  return children;
}

function Eip6963ProviderChooser({
  providers,
  onChoose,
  onCancel,
}: {
  providers: readonly DiscoveredEip6963Provider[];
  onChoose: (provider: DiscoveredEip6963Provider) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    firstButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const destination = eip6963FocusTrapDestination({
        activeInside: Boolean(dialogRef.current?.contains(document.activeElement)),
        atFirst: document.activeElement === first,
        atLast: document.activeElement === last,
        shiftKey: event.shiftKey,
      });
      if (destination === 'last') { event.preventDefault(); last.focus(); }
      else if (destination === 'first') { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [onCancel]);
  const options = providers.map((provider, index) => createElement('button', {
        key: provider.rdns,
        ref: index === 0 ? firstButtonRef : undefined,
        type: 'button',
        className: 'button glass-press flex min-h-12 flex-col items-start rounded-xl px-4 py-3 text-left',
        onClick: () => onChoose(provider),
      }, createElement('span', { className: 'font-semibold' }, provider.name), createElement('span', { className: 'text-[11px] text-mut' }, provider.rdns)));
  return createElement('div', { className: 'wallet-provider-chooser-backdrop', role: 'presentation', onMouseDown: (event: MouseEvent) => { if (event.target === event.currentTarget) onCancel(); } },
    createElement('div', { ref: dialogRef, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wallet-provider-chooser-title', className: 'wallet-provider-chooser' },
      createElement('h2', { id: 'wallet-provider-chooser-title', className: 'text-display text-lg font-semibold' }, 'Choose a wallet'),
      createElement('p', { className: 'mt-2 text-sm text-mut' }, 'Select which browser wallet should connect to FxAeon.'),
      createElement('div', { className: 'mt-4 flex flex-col gap-2' }, options),
      createElement('button', { type: 'button', onClick: onCancel, className: 'mt-3 min-h-11 px-3 text-sm text-mut' }, 'Cancel'),
    ),
  );
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
