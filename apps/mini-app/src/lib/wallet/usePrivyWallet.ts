'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject, type ReactNode } from 'react';
import {
  useConnectWallet,
  useLogin,
  useModalStatus,
  useLogout,
  usePrivy,
  useSendTransaction,
  useWallets,
  type ConnectedWallet,
  type SendTransactionModalUIOptions,
} from '@privy-io/react-auth';
import { assertLocalForkRpcUrl, configuredRpcUrls } from '@/lib/fx/config';
import { getInitData, isTelegramLaunchContext } from '@/lib/telegram';
import { useTelegramReconnect } from '@/lib/wallet/telegramReconnect';
import { PRIVY_PROMPT_OPEN_GRACE_MS, WalletConnectCancelledError, stepPrivyPrompt, watchPrivyPrompt, type PrivyPromptStep, type PrivyPromptWatch } from './connectWatch';
import { switchBrowserChain as switchBrowserChainWithConfig } from './switchBrowserChain';
import { eip6963FocusTrapDestination, getDiscoveredEip6963Providers, recordEip6963Announcement, selectEip6963Provider, shouldBindEip6963ProviderEvents, shouldPromptEip6963Provider, waitForWalletProvider, type DiscoveredEip6963Provider, type Eip6963Announcement } from './eip6963';

export const FX_CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
} as const;

const PRIVY_SUCCESS_MODAL_CLOSE_TIMEOUT_MS = 60_000;
const PRIVY_SUCCESS_MODAL_POLL_INTERVAL_MS = 100;

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
  /** Increments only after a provider reports a successful connection. */
  connectionVersion: number;
  wallets: ConnectedWallet[];
  selectedWallet?: FxSelectedWallet;
  /** Current selected wallet network when Privy has a supported chain value. */
  chainId?: FxChainId;
  address?: string;
  isEmbedded: boolean;
  /** True while a wallet prompt (Privy's modal or the browser wallet chooser) is on screen. */
  promptOpen?: boolean;
  /**
   * Request an account from the user's browser wallet. No private key leaves
   * the wallet. Rejects with WalletConnectCancelledError when the person
   * closes the prompt without connecting.
   */
  connect: (options?: { external?: boolean }) => Promise<void>;
  /** End the app wallet session. This never transfers assets or exposes keys. */
  disconnect: () => Promise<void>;
  selectWallet: (address: string) => void;
  switchChain: (chainId: FxChainId) => Promise<void>;
  sendTransaction: (
    transaction: FxWalletTransaction,
    options?: FxWalletTransactionOptions
  ) => Promise<{ hash: `0x${string}` }>;
  /** Wait for the preceding embedded-wallet success screen before revalidating a later step. */
  waitForPreviousConfirmationClose?: () => Promise<void>;
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

type PendingConnection = {
  kind: 'login' | 'wallet';
  resolve: () => void;
  reject: (cause: Error) => void;
  /** What has been observed about Privy's prompt for this request. */
  watch: PrivyPromptWatch;
  /** Ends the request if Privy never shows a prompt for it. */
  openTimer?: ReturnType<typeof setTimeout>;
};

function cancellation(kind: PendingConnection['kind']): WalletConnectCancelledError {
  return new WalletConnectCancelledError(kind === 'login' ? 'Sign-in cancelled.' : 'Wallet connection was cancelled.');
}

/** Settle the current request from one observed step. A superseded request stays untouched. */
function settleConnection(pendingRef: MutableRefObject<PendingConnection | null>, pending: PendingConnection, step: PrivyPromptStep): void {
  if (pendingRef.current !== pending) return;
  if (step.outcome === 'pending') {
    pending.watch = step.watch;
    return;
  }
  pendingRef.current = null;
  if (pending.openTimer !== undefined) clearTimeout(pending.openTimer);
  switch (step.outcome) {
    case 'resolved':
      pending.resolve();
      return;
    case 'cancelled':
      pending.reject(cancellation(pending.kind));
      return;
    case 'unavailable':
      pending.reject(new Error('The wallet window did not open. Try again.'));
      return;
    case 'failed':
      pending.reject(new Error(
        pending.kind === 'login' ? 'Sign-in failed. Please try again.' : 'Wallet connection failed. Please try again.',
        { cause: step.code },
      ));
      return;
  }
}

/** End the current request without an outcome from Privy (superseded, signed out, unmounted). */
function retireConnection(pendingRef: MutableRefObject<PendingConnection | null>, cause: Error): void {
  const pending = pendingRef.current;
  if (!pending) return;
  pendingRef.current = null;
  if (pending.openTimer !== undefined) clearTimeout(pending.openTimer);
  pending.reject(cause);
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
  return switchBrowserChainWithConfig(provider, chainId, () => {
    const localForkRpcUrl = process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === '1'
      ? process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL
      : undefined;
    return localForkRpcUrl ? { localForkRpcUrl } : { configuredRpcUrls: configuredRpcUrls(chainId) };
  });
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
  const { ready, authenticated, user } = usePrivy();
  const { isOpen: privyModalOpen } = useModalStatus();
  const reconnectTelegram = useTelegramReconnect();
  const { logout } = useLogout();
  const [selectedAddress, setSelectedAddress] = useState<string>();
  const [connectionVersion, setConnectionVersion] = useState(0);
  const mountedRef = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // Privy ignores login() while it holds any non-guest user, so such a
  // session is treated as signed in when choosing the connection path.
  const privySessionRef = useRef(false);
  privySessionRef.current = Boolean(user && !user.isGuest);
  const privyModalOpenRef = useRef(privyModalOpen);
  const walletSessionKeyRef = useRef('');
  const previousEmbeddedPromptRef = useRef<{ walletSessionKey: string } | null>(null);
  const connectPendingRef = useRef<PendingConnection | null>(null);
  const { login } = useLogin({
    onComplete: ({ user, loginAccount }) => {
      const pending = connectPendingRef.current;
      if (!pending || pending.kind !== 'login') return;
      if (!mountedRef.current) {
        retireConnection(connectPendingRef, cancellation('login'));
        return;
      }
      // Privy's user.wallet is the first linked wallet, which need not be
      // the external wallet the user selected for this login.
      const loginAddress = loginAccount?.type === 'wallet' && loginAccount.chainType === 'ethereum'
        ? loginAccount.address : user.wallet?.address;
      if (loginAddress) setSelectedAddress(loginAddress);
      settleConnection(connectPendingRef, pending, { outcome: 'resolved' });
    },
    onError: (cause) => {
      const pending = connectPendingRef.current;
      if (!pending || pending.kind !== 'login') return;
      settleConnection(connectPendingRef, pending, stepPrivyPrompt(pending.watch, { type: 'error', code: cause, modalOpen: privyModalOpenRef.current }));
    },
  });
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      const pending = connectPendingRef.current;
      // Privy may deliver a late callback after a cancelled/unmounted modal.
      // Without an active waiter it must not resurrect the selected wallet.
      if (!pending || pending.kind !== 'wallet') return;
      if (!mountedRef.current) {
        retireConnection(connectPendingRef, cancellation('wallet'));
        return;
      }
      setSelectedAddress(wallet.address);
      setConnectionVersion((version) => version + 1);
      settleConnection(connectPendingRef, pending, { outcome: 'resolved' });
    },
    onError: (cause) => {
      const pending = connectPendingRef.current;
      if (!pending || pending.kind !== 'wallet') return;
      settleConnection(connectPendingRef, pending, stepPrivyPrompt(pending.watch, { type: 'error', code: cause, modalOpen: privyModalOpenRef.current }));
    },
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      retireConnection(connectPendingRef, new WalletConnectCancelledError());
    };
  }, []);
  // Privy reports nothing when its connect-only modal is dismissed with the
  // backdrop or Escape, and a login error may arrive while its modal still
  // offers a retry. The modal closing without a success callback is
  // therefore the person ending the request.
  useEffect(() => {
    const pending = connectPendingRef.current;
    if (pending) settleConnection(connectPendingRef, pending, stepPrivyPrompt(pending.watch, { type: 'modal', open: privyModalOpen }));
  }, [privyModalOpen]);
  const { wallets } = useWallets();
  const { sendTransaction: sendEmbeddedTransaction } = useSendTransaction();
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
  const selectedWalletRef = useRef<FxSelectedWallet | undefined>(selectedWallet);
  useEffect(() => {
    selectedWalletRef.current = selectedWallet;
  }, [selectedWallet]);

  const selectedChainId = useMemo(() => {
    const chainId = asChainNumber(selectedWallet?.chainId);
    return chainId === FX_CHAIN_IDS.ethereum || chainId === FX_CHAIN_IDS.base
      ? chainId
      : undefined;
  }, [selectedWallet]);

  // Privy's send promise resolves on broadcast, while its confirmation UI may
  // remain on the submitted screen. Record only the session identity here;
  // the next embedded send consults useModalStatus before opening another UI.
  const walletSessionKey = JSON.stringify([
    user?.id ?? '',
    selectedWallet?.address.toLowerCase() ?? '',
    selectedChainId ?? null,
    connectionVersion,
    authenticated,
    ready,
  ]);
  privyModalOpenRef.current = privyModalOpen;
  walletSessionKeyRef.current = walletSessionKey;

  const awaitPreviousEmbeddedPromptClose = useCallback(async (sessionKey: string) => {
    const previous = previousEmbeddedPromptRef.current;
    if (!previous) return;
    if (previous.walletSessionKey !== sessionKey) {
      previousEmbeddedPromptRef.current = null;
      throw new Error('Wallet or session changed after the previous transaction. Reopen the action to continue.');
    }
    if (!privyModalOpenRef.current) {
      previousEmbeddedPromptRef.current = null;
      return;
    }

    const deadline = Date.now() + PRIVY_SUCCESS_MODAL_CLOSE_TIMEOUT_MS;
    while (true) {
      if (!mountedRef.current) {
        previousEmbeddedPromptRef.current = null;
        throw new Error('Wallet session ended while waiting for the transaction screen to close. Reopen the action to continue.');
      }
      if (walletSessionKeyRef.current !== sessionKey) {
        previousEmbeddedPromptRef.current = null;
        throw new Error('Wallet or session changed while waiting for the transaction screen to close. Reopen the action to continue.');
      }
      if (!privyModalOpenRef.current) {
        previousEmbeddedPromptRef.current = null;
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error('Close the Privy transaction screen, then retry to continue.');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, PRIVY_SUCCESS_MODAL_POLL_INTERVAL_MS));
    }
  }, []);

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

  // Register the request before Privy opens its prompt, so its callbacks, the
  // modal status, and the open grace period can each settle it.
  const beginConnection = useCallback((kind: PendingConnection['kind'], resolve: () => void, reject: (cause: Error) => void) => {
    retireConnection(connectPendingRef, new WalletConnectCancelledError('Wallet connection was superseded.'));
    const pending: PendingConnection = { kind, resolve, reject, watch: watchPrivyPrompt(privyModalOpenRef.current) };
    connectPendingRef.current = pending;
    // Before readiness, login() waits for Privy to initialize, so only a
    // ready SDK is held to showing its prompt promptly.
    if (readyRef.current) {
      pending.openTimer = setTimeout(() => {
        settleConnection(connectPendingRef, pending, stepPrivyPrompt(pending.watch, { type: 'open-timeout' }));
      }, PRIVY_PROMPT_OPEN_GRACE_MS);
    }
    return pending;
  }, []);

  const connectExternalWallet = useCallback(() => new Promise<void>((resolve, reject) => {
    const pending = beginConnection('wallet', resolve, reject);
    try {
      // The hook currently returns void, but resolving this through a promise
      // also handles SDK versions that return an async modal operation.
      void Promise.resolve(connectWallet()).catch((cause) => {
        if (connectPendingRef.current !== pending) return;
        retireConnection(connectPendingRef, cause instanceof Error ? cause : new Error('Wallet connection failed. Please try again.'));
      });
    } catch (cause) {
      retireConnection(connectPendingRef, cause instanceof Error ? cause : new Error('Wallet connection failed. Please try again.'));
    }
  }), [beginConnection, connectWallet]);

  const connectWithPrivyLogin = useCallback(() => new Promise<void>((resolve, reject) => {
    const pending = beginConnection('login', resolve, reject);
    try {
      // Keep the dashboard as the authority for enabled account methods. The
      // current app enables wallet and email; Telegram becomes available here
      // automatically when its Privy dashboard setting is enabled.
      void Promise.resolve(login()).catch((cause) => {
        if (connectPendingRef.current !== pending) return;
        retireConnection(connectPendingRef, cause instanceof Error ? cause : new Error('Sign-in failed. Please try again.'));
      });
    } catch (cause) {
      retireConnection(connectPendingRef, cause instanceof Error ? cause : new Error('Sign-in failed. Please try again.'));
    }
  }), [beginConnection, login]);

  const connect = useCallback(async ({ external = false }: { external?: boolean } = {}) => {
    if (external) {
      await connectExternalWallet();
      return;
    }
    if (isTelegramLaunchContext()) {
      if (authenticatedRef.current && isEmbedded(selectedWalletRef.current)) return;
      if (authenticatedRef.current) {
        await connectExternalWallet();
        return;
      }
      // Generic login opens Telegram's legacy web widget and can copy the
      // signed launch hash into its return URL. Reinitialize seamless auth
      // instead; signed data is consumed by Privy at the provider boundary.
      if (!getInitData()) throw new Error('Reopen FxAeon from Telegram to sign in again.');
      reconnectTelegram();
      return;
    }
    // login() is a silent no-op while Privy holds a session, so a session
    // goes straight to the wallet selector instead.
    if (authenticated || privySessionRef.current) {
      await connectExternalWallet();
      return;
    }
    await connectWithPrivyLogin();
  }, [authenticated, connectExternalWallet, connectWithPrivyLogin, reconnectTelegram]);

  const disconnect = useCallback(async () => {
    retireConnection(connectPendingRef, new WalletConnectCancelledError());
    await logout();
    authenticatedRef.current = false;
    setSelectedAddress(undefined);
  }, [logout]);

  const switchChain = useCallback(async (chainId: FxChainId) => {
    if (!selectedWallet) throw new Error('Connect a wallet before switching networks.');
    await selectedWallet.switchChain(chainId);
  }, [selectedWallet]);

  const waitForPreviousConfirmationClose = useCallback(async () => {
    if (!isEmbedded(selectedWallet)) return;
    await awaitPreviousEmbeddedPromptClose(walletSessionKey);
  }, [selectedWallet, awaitPreviousEmbeddedPromptClose, walletSessionKey]);

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
    const sessionKey = walletSessionKey;
    if (isEmbedded(selectedWallet) && previousEmbeddedPromptRef.current) {
      const previous = previousEmbeddedPromptRef.current;
      if (previous.walletSessionKey !== sessionKey) {
        previousEmbeddedPromptRef.current = null;
        throw new Error('Wallet or session changed after the previous transaction. Reopen the action to continue.');
      }
      if (privyModalOpenRef.current) {
        throw new Error('Close the Privy transaction screen and retry so the action can be checked again.');
      }
      previousEmbeddedPromptRef.current = null;
    }
    if (!mountedRef.current || walletSessionKeyRef.current !== sessionKey) {
      throw new Error('Wallet or session changed before the next transaction. Reopen the action to continue.');
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
      const result = await sendEmbeddedTransaction(request, {
        address: selectedWallet.address,
        uiOptions,
      });
      // Return the broadcast hash immediately so the transaction runner can
      // journal and receipt-track it. Only a later send may wait for this
      // success screen to close.
      previousEmbeddedPromptRef.current = { walletSessionKey: sessionKey };
      return result;
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
    // Application-selected fee tiers are part of Privy's embedded signing
    // request. External wallet providers own their fee UI and pricing, so do
    // not pin app gas caps into eth_sendTransaction.
    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [providerRequest],
    });
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new Error('The connected wallet returned an invalid transaction hash.');
    }
    return { hash: result as `0x${string}` };
  }, [authenticated, selectedWallet, sendEmbeddedTransaction, walletSessionKey]);

  return {
    // Privy's provider readiness is the gate for opening its login and wallet
    // flows. The wallet list can hydrate a little later (especially on a cold
    // custom-origin or Telegram launch); treating that secondary feed as a
    // provider outage made routes replace a usable connect CTA with
    // “Wallet provider is unavailable.” Consumers already handle an empty
    // wallet list as the disconnected state, and the list will re-render when
    // the wallet list changes.
    ready,
    authenticated,
    connectionVersion,
    wallets,
    selectedWallet,
    chainId: selectedChainId,
    address: selectedWallet?.address,
    isEmbedded: isEmbedded(selectedWallet),
    promptOpen: privyModalOpen,
    connect,
    disconnect,
    selectWallet,
    switchChain,
    sendTransaction,
    waitForPreviousConfirmationClose,
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
  const [connectionVersion, setConnectionVersion] = useState(0);
  const provider = browserProvider();
  const discoveryAbortRef = useRef<AbortController | null>(null);
  const connectAttemptRef = useRef(0);
  const boundProviderRef = useRef<Eip1193Provider | undefined>(undefined);
  const currentProviderRef = useRef(provider);
  currentProviderRef.current = provider;
  const currentAddressRef = useRef(address);
  currentAddressRef.current = address;

  const sync = useCallback(async (requestAccounts = false, providerOverride?: Eip1193Provider, attempt = connectAttemptRef.current) => {
    const currentAttempt = () => attempt === connectAttemptRef.current;
    const ensureCurrent = () => { if (!currentAttempt()) throw new Error('Wallet connection was cancelled.'); };
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
    ensureCurrent();
    const nextAddress = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : undefined;
    if (requestAccounts && !nextAddress) throw new Error('Wallet connection was cancelled.');
    setAddress(nextAddress);
    if (requestAccounts && nextAddress) setConnectionVersion((version) => version + 1);
    const rawChain = await currentProvider.request({ method: 'eth_chainId' });
    ensureCurrent();
    const parsed = asChainNumber(typeof rawChain === 'string' ? rawChain : String(rawChain));
    setChainId(parsed === FX_CHAIN_IDS.ethereum || parsed === FX_CHAIN_IDS.base ? parsed : undefined);
  }, []);

  useEffect(() => {
    const previous = boundProviderRef.current;
    boundProviderRef.current = provider;
    // An EIP-6963 provider can be replaced while retaining the same account.
    // Bump the identity version so action rails waiting on a connection event
    // cannot mistake the old provider for the newly selected one.
    if (previous && provider && previous !== provider && address) {
      setConnectionVersion((version) => version + 1);
    }
  }, [address, provider]);

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
    const attempt = ++connectAttemptRef.current;
    const discoveryAbort = new AbortController();
    discoveryAbortRef.current?.abort();
    discoveryAbortRef.current = discoveryAbort;
    try {
      // Readiness only means the initial restore window has completed. A
      // wallet extension can still inject window.ethereum or announce via
      // EIP-6963 after that point, so hold this user initiated request until
      // there is a concrete provider to pass to sync(true).
      const availableProvider = await waitForWalletProvider(
        browserProvider,
        window,
        { signal: discoveryAbort.signal },
      );
      const providers = getDiscoveredEip6963Providers();
      const preferred = window.localStorage.getItem('fxaeon:wallet-provider-rdns');
      let selected: DiscoveredEip6963Provider | undefined = preferred
        ? providers.find((candidate) => candidate.rdns === preferred)
        : undefined;
      // An explicit reconnect is also the user's opportunity to switch
      // between announced wallets. The preferred provider is used for silent
      // restore above, but should not silently win a user initiated choice.
      if (providers.length > 1) {
        selected = await new Promise<DiscoveredEip6963Provider>((resolve, reject) => {
          pendingChoiceRef.current = { resolve, reject };
          setChooser(providers);
        });
        if (attempt !== connectAttemptRef.current) throw new Error('Wallet connection was cancelled.');
        window.localStorage.setItem('fxaeon:wallet-provider-rdns', selected.rdns);
        setProviderVersion((version) => version + 1);
      }
      await sync(true, selected?.provider ?? availableProvider, attempt);
    } catch (cause) {
      if (!discoveryAbort.signal.aborted && attempt === connectAttemptRef.current) window.localStorage.setItem(BROWSER_DISCONNECTED_KEY, '1');
      throw cause;
    } finally {
      if (discoveryAbortRef.current === discoveryAbort) discoveryAbortRef.current = null;
    }
  }, [sync]);
  useEffect(() => () => {
    // Invalidate restores/connects before a provider request can resolve, so
    // no late result updates state after this provider unmounts.
    connectAttemptRef.current += 1;
    discoveryAbortRef.current?.abort();
    pendingChoiceRef.current?.reject(new Error('Wallet selection was cancelled.'));
    pendingChoiceRef.current = null;
  }, []);
  const disconnect = useCallback(async () => {
    connectAttemptRef.current += 1;
    discoveryAbortRef.current?.abort();
    discoveryAbortRef.current = null;
    const pending = pendingChoiceRef.current;
    pendingChoiceRef.current = null;
    setChooser(null);
    pending?.reject(new Error('Wallet connection was cancelled.'));
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
    const switchProvider = provider;
    const switchWallet = selectedWallet;
    if (!switchProvider || !switchWallet) throw new Error('Connect a browser wallet before switching networks.');
    const attempt = connectAttemptRef.current;
    const switchAddress = switchWallet.address.toLowerCase();
    const isCurrent = () => attempt === connectAttemptRef.current
      && currentProviderRef.current === switchProvider
      && currentAddressRef.current?.toLowerCase() === switchAddress;
    await switchBrowserChain(switchProvider, nextChain);
    if (!isCurrent()) throw new Error('The selected wallet changed while switching networks.');
    const rawChain = await switchProvider.request({ method: 'eth_chainId' });
    if (!isCurrent()) throw new Error('The selected wallet changed while checking the switched network.');
    const parsedChain = asChainNumber(typeof rawChain === 'string' ? rawChain : String(rawChain));
    const actualChain = parsedChain === FX_CHAIN_IDS.ethereum || parsedChain === FX_CHAIN_IDS.base
      ? parsedChain : undefined;
    // Publish what the provider actually reports, including an unsupported
    // result as undefined, before rejecting a mismatch with the requested
    // network. Never write this state after account/provider teardown.
    setChainId(actualChain);
    if (actualChain !== nextChain) {
      throw new Error(`Wallet network switch reported ${parsedChain === undefined ? 'an unsupported network' : `chain ${parsedChain}`} instead of chain ${nextChain}.`);
    }
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
    connectionVersion,
    wallets: selectedWallet ? [selectedWallet] : [],
    selectedWallet,
    chainId,
    address,
    isEmbedded: false,
    promptOpen: Boolean(chooser),
    connect,
    disconnect,
    selectWallet: () => undefined,
    switchChain,
    sendTransaction,
  }), [address, chainId, chooser, connect, connectionVersion, disconnect, ready, selectedWallet, sendTransaction, switchChain]);
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
