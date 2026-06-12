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
  debt: string;
  leverage: number;
  healthPercent: number;
  liquidationPrice: number;
}

export interface Me {
  onboarded: boolean;
  walletAddress?: string;
  referralCode?: string | null;
  language?: string;
  slippageBps?: number;
  mevProtection?: 'on' | 'off';
  funding?: Funding;
  positions?: ApiPosition[];
}

export interface OnboardResult {
  onboarded: boolean;
  created: boolean;
  walletAddress: string;
  walletShort: string;
  referralApplied: string | null;
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

export const getMe = () => call<Me>('/me');

export const onboard = (referral?: string) =>
  call<OnboardResult>('/onboard', { method: 'POST', body: referral ? { referral } : {} });

export const saveSettings = (settings: {
  language?: string;
  slippageBps?: number;
  mevProtection?: 'on' | 'off';
}) => call<{ ok: boolean }>('/settings', { method: 'POST', body: settings });
