import { LIVE_QUOTE_MAX_AGE_MS, type LiveMarketStatus, type LiveQuote } from './liveMarket';
import type { MarketSymbol } from './marketData';

export type LiveMarketSnapshot = { quote: LiveQuote | null; status: LiveMarketStatus; now: number };
const EMPTY: LiveMarketSnapshot = { quote: null, status: 'paused', now: 0 };
const markets: Record<MarketSymbol, LiveMarketSnapshot> = { ETH: EMPTY, BTC: EMPTY };
const latest: Partial<Record<MarketSymbol, LiveQuote>> = {};
const listeners = new Set<() => void>();
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let lastPublished = 0;

function notify(): void { listeners.forEach((listener) => listener()); }
function publish(): void {
  publishTimer = null;
  const now = Date.now();
  (['ETH', 'BTC'] as const).forEach((market) => {
    const quote = latest[market] ?? null;
    markets[market] = { quote, status: markets[market].status, now };
  });
  lastPublished = now;
  notify();
}
function schedulePublish(): void {
  if (publishTimer !== null) return;
  const delay = Math.max(0, 250 - (Date.now() - lastPublished));
  publishTimer = setTimeout(publish, delay);
}
function scheduleExpiry(): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  const expiry = Object.values(latest).filter(Boolean).reduce<number | null>((min, quote) => {
    const next = quote!.receivedAt + LIVE_QUOTE_MAX_AGE_MS;
    return min === null ? next : Math.min(min, next);
  }, null);
  if (expiry === null) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    const now = Date.now();
    (['ETH', 'BTC'] as const).forEach((market) => { markets[market] = { ...markets[market], now }; });
    notify();
  }, Math.max(0, expiry - Date.now() + 1));
}
export const liveMarketStore = {
  acceptQuote(quote: LiveQuote) {
    const previous = latest[quote.market];
    if (previous && quote.sequence <= previous.sequence) return;
    latest[quote.market] = quote;
    schedulePublish();
    scheduleExpiry();
  },
  setStatus(status: LiveMarketStatus) {
    if (markets.ETH.status === status && markets.BTC.status === status) return;
    markets.ETH = { ...markets.ETH, status, now: Date.now() };
    markets.BTC = { ...markets.BTC, status, now: Date.now() };
    notify();
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot(market: MarketSymbol): LiveMarketSnapshot {
    return markets[market];
  },
};
