import type { WalletAssetChain } from './walletAssets';

export type RealtimeChainStatus = 'idle' | 'connecting' | 'live' | 'polling' | 'offline' | 'unavailable';
export type RealtimeChainEvent = { chainId: WalletAssetChain; kind: 'block' | 'transfer'; blockNumber: bigint | null; removed: boolean; at: number };
export type RealtimeChainState = { chainId: WalletAssetChain; status: RealtimeChainStatus; transport: 'websocket' | 'polling' | null; latestBlockNumber: bigint | null; lastEventAt: number | null; lastTransferAt: number | null; reconnectAttempt: number; revision: number };

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const;
const stateFor = (chainId: WalletAssetChain): RealtimeChainState => ({ chainId, status: 'idle', transport: null, latestBlockNumber: null, lastEventAt: null, lastTransferAt: null, reconnectAttempt: 0, revision: 0 });

export function deriveAlchemyWebSocketUrl(chainId: WalletAssetChain, input?: string): string | null {
  const value = input ?? (chainId === 1 ? process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL : process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL);
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+-mainnet\.g\.alchemy\.com$/i.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash) return null;
    const expected = chainId === 1 ? 'eth-mainnet.g.alchemy.com' : 'base-mainnet.g.alchemy.com';
    if (url.hostname.toLowerCase() !== expected) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[0] !== 'v2' || !/^[A-Za-z0-9_-]{8,128}$/.test(parts[1])) return null;
    return `wss://${url.hostname}/v2/${parts[1]}`;
  } catch { return null; }
}

type WebSocketLike = { onopen: (() => void) | null; onmessage: ((event: { data?: unknown }) => void) | null; onerror: (() => void) | null; onclose: (() => void) | null; send(data: string): void; close(code?: number, reason?: string): void };
type Timer = ReturnType<typeof setTimeout>;
const WALLET_ADDRESS = /^0x[0-9a-f]{40}$/i;

export function realtimeReconnectDelay(attempt: number, random = Math.random): number {
  const exponent = Math.min(Math.max(0, Math.trunc(attempt)), 8);
  const base = Math.min(30_000, 800 * (2 ** exponent));
  return Math.round(base * (0.8 + Math.min(1, Math.max(0, random())) * 0.4));
}

export function createAlchemyChainPulse(options: {
  chainId: WalletAssetChain; walletAddress: string; onEvent: (event: RealtimeChainEvent) => void; onState: (state: RealtimeChainState) => void;
  createSocket?: (url: string) => WebSocketLike; schedule?: (callback: () => void, delay: number) => Timer; cancelSchedule?: (timer: Timer) => void; now?: () => number; random?: () => number;
}): { setActive: (active: boolean) => void; stop: () => void } {
  if (!WALLET_ADDRESS.test(options.walletAddress)) throw new Error('Invalid wallet address.');
  const createSocket = options.createSocket ?? ((url) => new WebSocket(url) as WebSocketLike);
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const websocketUrl = deriveAlchemyWebSocketUrl(options.chainId);
  let socket: WebSocketLike | null = null;
  let retry: Timer | null = null;
  let watchdog: Timer | null = null;
  let retryAttempt = 0;
  let active = false;
  let disposed = false;
  let state = stateFor(options.chainId);
  let latestHead: bigint | null = null;
  const update = (patch: Partial<RealtimeChainState>) => { state = { ...state, ...patch, revision: state.revision + 1 }; options.onState(state); };
  const close = () => { if (watchdog !== null) { cancelSchedule(watchdog); watchdog = null; } const current = socket; socket = null; if (!current) return; current.onopen = null; current.onmessage = null; current.onerror = null; current.onclose = null; try { current.close(1000, 'FxAeon realtime feed paused'); } catch { /* already closed */ } };
  const clearRetry = () => { if (retry !== null) { cancelSchedule(retry); retry = null; } };
  const reconnect = () => { if (!active || disposed || retry !== null) return; const delay = realtimeReconnectDelay(retryAttempt, random); retryAttempt += 1; update({ status: 'polling', transport: 'polling', reconnectAttempt: retryAttempt }); retry = schedule(() => { retry = null; connect(); }, delay); };
  const emit = (kind: 'block' | 'transfer', blockNumber: bigint | null, removed = false) => { const at = now(); update({ latestBlockNumber: blockNumber ?? state.latestBlockNumber, lastEventAt: at, lastTransferAt: kind === 'transfer' ? at : state.lastTransferAt }); options.onEvent({ chainId: options.chainId, kind, blockNumber, removed, at }); };
  const connect = () => {
    if (!active || disposed || socket) return;
    if (!websocketUrl) { update({ status: 'unavailable', transport: null }); return; }
    update({ status: retryAttempt ? 'polling' : 'connecting', transport: retryAttempt ? 'polling' : 'websocket', reconnectAttempt: retryAttempt });
    let current: WebSocketLike;
    try { current = createSocket(websocketUrl); } catch { reconnect(); return; }
    socket = current;
    const subscriptions = new Map<string, number>();
    const armWatchdog = () => {
      if (watchdog !== null) cancelSchedule(watchdog);
      watchdog = schedule(() => { watchdog = null; if (socket === current) { close(); reconnect(); } }, 45_000);
    };
    armWatchdog();
    current.onopen = () => {
      if (socket !== current || !active || disposed) return;
      try {
        current.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
        const address = options.walletAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0');
        current.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: ['logs', { topics: [TRANSFER_TOPIC, [`0x${address}`], null] }] }));
        current.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_subscribe', params: ['logs', { topics: [TRANSFER_TOPIC, null, [`0x${address}`]] }] }));
      } catch { close(); reconnect(); }
    };
    current.onmessage = (event) => {
      if (socket !== current || !active || typeof event.data !== 'string') return;
      let payload: unknown; try { payload = JSON.parse(event.data); } catch { return; }
      if (!payload || typeof payload !== 'object') return;
      const message = payload as { id?: unknown; error?: unknown; result?: unknown; method?: unknown; params?: { subscription?: unknown; result?: { number?: unknown; removed?: unknown; topics?: unknown } } };
      if (message.id === 1 || message.id === 2 || message.id === 3) {
        if (message.error || typeof message.result !== 'string' || !message.result) { close(); reconnect(); return; }
        subscriptions.set(message.result, message.id);
        if (new Set(subscriptions.values()).size === 3) { retryAttempt = 0; update({ status: 'live', transport: 'websocket', reconnectAttempt: 0 }); armWatchdog(); }
        return;
      }
      const subscription = typeof message.params?.subscription === 'string' ? subscriptions.get(message.params.subscription) : undefined;
      const result = message.params?.result;
      if (message.method !== 'eth_subscription' || !subscription || !result || typeof result !== 'object') return;
      let block: bigint | null = null;
      if (typeof result.number === 'string' && /^0x[0-9a-f]+$/i.test(result.number)) {
        try { block = BigInt(result.number); } catch { block = null; }
      } else if (typeof (result as { blockNumber?: unknown }).blockNumber === 'string' && /^0x[0-9a-f]+$/i.test((result as { blockNumber: string }).blockNumber)) {
        try { block = BigInt((result as { blockNumber: string }).blockNumber); } catch { block = null; }
      }
      if (block === null) return;
      const transfer = subscription !== 1;
      if (transfer) {
        const walletTopic = `0x${options.walletAddress.toLowerCase().slice(2).padStart(64, '0')}`;
        if (!Array.isArray(result.topics) || result.topics.length !== 3 || result.topics[0] !== TRANSFER_TOPIC || result.topics[subscription === 2 ? 1 : 2] !== walletTopic) return;
      }
      armWatchdog();
      if (!transfer && block !== null && latestHead !== null && block <= latestHead) return;
      if (!transfer && block !== null) latestHead = block;
      emit(transfer ? 'transfer' : 'block', block, result.removed === true);
    };
    current.onerror = () => { if (socket !== current) return; close(); reconnect(); };
    current.onclose = () => { if (socket !== current) return; close(); reconnect(); };
  };
  return {
    setActive(next) { if (disposed || active === next) return; active = next; if (!active) { clearRetry(); close(); update({ status: navigator.onLine === false ? 'offline' : 'idle', transport: null }); } else if (navigator.onLine === false) update({ status: 'offline', transport: null }); else connect(); },
    stop() { if (disposed) return; active = false; disposed = true; clearRetry(); close(); update({ status: 'idle', transport: null }); },
  };
}

export function initialRealtimeChainState(chainId: WalletAssetChain): RealtimeChainState { return stateFor(chainId); }
