/** Deterministic EIP-1193 wallet used by browser-only connected-flow tests. */
export interface BrowserWalletShimOptions {
  address?: string;
  /** Start with an exposed account, or require eth_requestAccounts on connect. */
  initiallyConnected?: boolean;
  chainId?: string;
}

export function browserWalletInitScript(_opts: BrowserWalletShimOptions = {}): (o: BrowserWalletShimOptions) => void {
  return (o: BrowserWalletShimOptions) => {
    const address = o.address ?? '0x930f0000000000000000000000000000000098b9';
    let connected = o.initiallyConnected ?? false;
    let chainId = o.chainId ?? '0x1';
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const requests: Array<{ method: string; params?: unknown[] }> = [];
    const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((listener) => listener(...args));
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        requests.push({ method, params });
        if (method === 'eth_accounts') return connected ? [address] : [];
        if (method === 'eth_requestAccounts') { connected = true; return [address]; }
        if (method === 'eth_chainId') return chainId;
        if (method === 'wallet_switchEthereumChain') {
          const next = (params?.[0] as { chainId?: unknown } | undefined)?.chainId;
          if (typeof next !== 'string') throw new Error('missing chain id');
          chainId = next;
          emit('chainChanged', chainId);
          return null;
        }
        if (method === 'wallet_addEthereumChain') return null;
        if (method === 'eth_sendTransaction') return `0x${'1'.repeat(64)}`;
        throw new Error(`Unhandled test wallet method: ${method}`);
      },
      on(event: string, listener: (...args: unknown[]) => void) { (listeners.get(event) ?? (listeners.set(event, new Set()), listeners.get(event)!)).add(listener); },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    };
    (window as unknown as { ethereum: unknown }).ethereum = provider;
    (window as unknown as { __wallet: unknown }).__wallet = { provider, requests };
  };
}
