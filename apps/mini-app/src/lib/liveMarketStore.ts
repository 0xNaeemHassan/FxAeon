import { LIVE_QUOTE_MAX_AGE_MS, isLiveQuoteFresh, type LiveMarketStatus, type LiveQuote } from './liveMarket';
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
function updateSnapshot(market: MarketSymbol, quote: LiveQuote | null, now: number): boolean {
  const previous = markets[market];
  // useSyncExternalStore compares snapshot identity. A BTC tick must not
  // rerender the ETH chart (and vice versa) merely to advance its clock.
  // Freshness transitions still publish even when the quote is unchanged.
  if (previous.quote === quote && isLiveQuoteFresh(previous.quote, previous.now) === isLiveQuoteFresh(quote, now)) return false;
  markets[market] = { quote, status: previous.status, now };
  return true;
}
function publish(): void {
  publishTimer = null;
  const now = Date.now();
  let changed = false;
  (['ETH', 'BTC'] as const).forEach((market) => {
    if (updateSnapshot(market, latest[market] ?? null, now)) changed = true;
  });
  lastPublished = now;
  if (changed) notify();
}
function schedulePublish(): void {
  if (publishTimer !== null) return;
  const delay = Math.max(0, 250 - (Date.now() - lastPublished));
  publishTimer = setTimeout(publish, delay);
}
function scheduleExpiry(): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  const now = Date.now();
  const expiry = Object.values(latest).filter(Boolean).reduce<number | null>((min, quote) => {
    const next = quote!.receivedAt + LIVE_QUOTE_MAX_AGE_MS;
    // An already expired instrument must not prevent the other instrument's
    // later expiry from being scheduled, or create a timer on every tick.
    if (next < now) return min;
    return min === null ? next : Math.min(min, next);
  }, null);
  if (expiry === null) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    const now = Date.now();
    let changed = false;
    (['ETH', 'BTC'] as const).forEach((market) => {
      if (updateSnapshot(market, markets[market].quote, now)) changed = true;
    });
    if (changed) notify();
    scheduleExpiry();
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
