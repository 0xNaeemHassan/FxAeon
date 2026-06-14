/**
 * Authenticated client for the bot's Mini App API (/api/v1/miniapp).
 *
 * Auth = Telegram initData (signed by Telegram, verified server-side), so it
 * only works for inline-button / menu-button / direct-link launches. Keyboard
 * launches use WebApp.sendData() instead — see lib/telegram.ts.
 *
 * The base URL is baked at build time (NEXT_PUBLIC_BOT_API_URL). When unset,
 * every call fails soft with `ApiUnavailableError` and pages render an honest
 * degraded state instead of fake data.
 */
import { getInitData } from './telegram';

const BASE = (process.env.NEXT_PUBLIC_BOT_API_URL || '').replace(/\/+$/, '');

export class ApiUnavailableError extends Error {
  constructor(message = 'Live data connection is not configured') {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

export interface Funding {
  known: boolean;
  funded?: boolean;
  eth?: string;
  wstEth?: string;
  wbtc?: string;
}

export interface ApiPosition {
  tokenId: string;
  market: string;
  side: 'long' | 'short';
  collateral: string;
  collateralToken?: string;
  debt: string;
  debtToken?: string;
  leverage: number;
  /** 1 = healthy, 0 = at liquidation (derived on-chain). */
  healthPercent: number;
  /** Position size (collateral notional) in USD — null when unpriced. */
  sizeUsd?: number | null;
  /** Unrealized PnL estimate since first tracked — null when unpriced. */
  pnlUsd?: number | null;
  pnlSince?: string | null;
}

/**
 * Real portfolio totals for the Total Value hero. Every field is null unless
 * EVERY component it depends on was priceable from the live spot snapshot —
 * the UI shows an honest "—" rather than a fabricated or partial number.
 */
export interface PortfolioSummary {
  totalValueUsd: number | null;
  walletUsd: number | null;
  positionsUsd: number | null;
  netPnlUsd: number | null;
  netPnlPct: number | null;
}

export interface Me {
  onboarded: boolean;
  walletAddress?: string;
  referralCode?: string | null;
  language?: string;
  slippageBps?: number;
  mevProtection?: 'on' | 'off';
  walletDelegated?: boolean;
  walletImported?: boolean;
  funding?: Funding;
  /** False when an on-chain read failed — positions may be incomplete. */
  positionsKnown?: boolean;
  positions?: ApiPosition[];
  /** Priced portfolio totals — present once positions read cleanly. */
  summary?: PortfolioSummary;
}

export interface OnboardResult {
  onboarded: boolean;
  created: boolean;
  walletAddress: string;
  walletShort: string;
  referralApplied: string | null;
  walletDelegated?: boolean;
  walletImported?: boolean;
}

/** True when authenticated API calls are possible in this launch context. */
export function apiAvailable(): boolean {
  return Boolean(BASE) && Boolean(getInitData());
}

/** Distinguishes "not configured" from "wrong launch context" for honest UI copy. */
export function apiConfigured(): boolean {
  return Boolean(BASE);
}

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  if (!BASE) throw new ApiUnavailableError();
  const initData = getInitData();
  if (!initData) throw new ApiUnavailableError('This screen needs a Telegram-authenticated launch');

  const res = await fetch(`${BASE}/api/v1/miniapp${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `tma ${initData}`,
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error?.message) message = data.error.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface MarketRow {
  symbol: string;
  data: {
    priceUsd: number;
    marketCapUsd: number | null;
    change24hPct: number | null;
    change7dPct: number | null;
  } | null;
}

export interface MarketSnapshot {
  fetchedAt: string;
  stale: boolean;
  rows: MarketRow[];
}

export const getMe = () => call<Me>('/me');

/** Live market snapshot — same cached CoinGecko data the bot's /price uses. */
export const getMarket = () => call<MarketSnapshot>('/market');

export const onboard = (referral?: string) =>
  call<OnboardResult>('/onboard', { method: 'POST', body: referral ? { referral } : {} });

/**
 * Re-sync wallet state (delegation grant / wallet id) from Privy after the
 * user grants or revokes bot trading in the Mini App.
 */
export const walletSync = () =>
  call<{ ok: boolean; walletDelegated: boolean; walletAddress: string }>('/wallet/sync', {
    method: 'POST',
    body: {},
  });

export const saveSettings = (settings: {
  language?: string;
  slippageBps?: number;
  mevProtection?: 'on' | 'off';
}) => call<{ ok: boolean }>('/settings', { method: 'POST', body: settings });
