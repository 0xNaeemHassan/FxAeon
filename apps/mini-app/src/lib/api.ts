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

/** A structured API error that preserves the server's machine-readable code. */
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface Funding {
  known: boolean;
  funded?: boolean;
  eth?: string;
  wstEth?: string;
  wbtc?: string;
  balances?: Partial<Record<ProtocolTokenSymbol, string | null>>;
}

export type ProtocolTokenSymbol =
  | 'ETH'
  | 'WETH'
  | 'stETH'
  | 'wstETH'
  | 'WBTC'
  | 'USDC'
  | 'USDT'
  | 'fxUSD'
  | 'fxSAVE'
  | 'fxUSDBasePool';

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
  /** Unrealized PnL percent vs entry equity; null when unknown. */
  pnlPct?: number | null;
  /** Entry spot price (USD) captured at first-seen; null when unknown. */
  entryPrice?: number | null;
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
  /** fxSAVE (stability pool) value in USD. 0 = no position, null = unpriced. */
  savingsUsd: number | null;
  netPnlUsd: number | null;
  netPnlPct: number | null;
}

/**
 * The user's fxSAVE (stability pool) holding — real on-chain savings.
 * Present while shares are held OR a queued redemption is pending. A
 * redeem-all therefore remains visible until its cooldown claim is complete.
 */
export interface SavingsPosition {
  /** fxSAVE share balance (formatted, 18 dec). */
  shares: string;
  /** Underlying fxUSD for shares still in the wallet, or null when unavailable. */
  assets: string | null;
  /** Exact SDK claim preview for queued shares, or null when none/unavailable. */
  pendingAssets?: { fxUsd: string; usdc: string } | null;
  /** USD value of active shares plus the queued claim, or null when unpriced. */
  valueUsd: number | null;
  /** A withdrawal is queued in the cooldown. */
  pendingRedeem: boolean;
  /** The queued withdrawal's cooldown is over — claimable now. */
  redeemReady: boolean;
  pendingShares: string;
  /** Unix seconds the pending redemption becomes claimable, or null. */
  redeemableAt: number | null;
  cooldownHours: number;
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
  /** False when the fxSAVE read failed — savings state is unknown. */
  savingsKnown?: boolean;
  /** Active stability-pool shares and/or a queued redemption; null when neither exists. */
  savings?: SavingsPosition | null;
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
    let code = 'HTTP_ERROR';
    try {
      const data = await res.json();
      if (data?.error?.message) message = data.error.message;
      if (data?.error?.code) code = data.error.code;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, code, res.status);
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

// ---------------------------------------------------------------------------
// Unified action execution. Every protocol intent uses /action/quote and
// /action/execute; there is no parallel legacy trade money path.
// ---------------------------------------------------------------------------

/** Real gas estimate from a live simulateCalls + EIP-1559 feeHistory. */
export type FeeTierKey = 'slow' | 'market' | 'fast';

/** One real speed tier (Slow/Market/Fast), all numbers chain-derived. */
export interface GasTier {
  key: FeeTierKey;
  maxFeeGwei: number;
  priorityGwei: number;
  estCostWei: string;
  estCostEth: number;
  /** null when no ETH price is available — never fabricated. */
  estCostUsd: number | null;
}

export interface GasEstimate {
  units: string;
  /** [slow, market, fast] — real fee-history percentile tiers. */
  tiers: GasTier[];
  /** Default selection; the broadcast uses whichever tier the user confirms. */
  recommended: FeeTierKey;
}

/** Real on-chain receipt detail for the result screen (null when unread). */
export interface TradeReceipt {
  blockNumber: number;
  gasUsed: string;
  effectiveGasPriceGwei: number;
  gasPaidWei: string;
  gasPaidEth: number;
  gasPaidUsd: number | null;
  confirmations: number;
}

export interface TradeExecuteResult {
  ok: true;
  deduped: boolean;
  status: string;
  txHash: string | null;
  hashes: string[];
  recordId: string;
  receipt: TradeReceipt | null;
  /** Honest executor detail for pending/partial/cancelled/reverted outcomes. */
  message?: string;
}

// ---------------------------------------------------------------------------
// Complete f(x) action surface. Parameters are intents, never calldata.
// ---------------------------------------------------------------------------

export type Market = 'wstETH' | 'WBTC';
export type PositionSide = 'long' | 'short';

export type MiniActionParams =
  | {
      kind: 'position_open';
      market: Market;
      side: PositionSide;
      inputToken: ProtocolTokenSymbol;
      amount: string;
      leverage: number;
    }
  | {
      kind: 'position_increase';
      market: Market;
      side: PositionSide;
      positionId: number;
      inputToken: ProtocolTokenSymbol;
      amount: string;
    }
  | {
      kind: 'position_reduce';
      market: Market;
      side: PositionSide;
      positionId: number;
      outputToken: ProtocolTokenSymbol;
      fractionBps: number;
    }
  | {
      kind: 'position_adjust';
      market: Market;
      side: PositionSide;
      positionId: number;
      leverage: number;
    }
  | {
      kind: 'mint';
      market: Market;
      positionId: number;
      depositToken: ProtocolTokenSymbol;
      depositAmount: string;
      mintAmount: string;
    }
  | {
      kind: 'repay_withdraw';
      market: Market;
      positionId: number;
      repayAmount: string | 'all';
      withdrawToken: ProtocolTokenSymbol;
      withdrawAmount: string;
    }
  | {
      kind: 'save_deposit';
      tokenIn: 'USDC' | 'fxUSD' | 'fxUSDBasePool';
      amount: string;
    }
  | {
      kind: 'save_withdraw';
      tokenOut: 'USDC' | 'fxUSD' | 'fxUSDBasePool';
      shares: string | 'all';
      instant: boolean;
    }
  | { kind: 'save_claim' }
  | {
      kind: 'bridge';
      token: 'fxUSD' | 'fxSAVE';
      amount: string;
      direction: 'ethereum_to_base' | 'base_to_ethereum';
    };

export interface ActionDetail {
  label: string;
  value: string;
}

export interface ActionQuote {
  kind: MiniActionParams['kind'];
  title: string;
  description: string;
  network: 'Ethereum' | 'Base';
  chainId: 1 | 8453;
  details: ActionDetail[];
  warning?: string;
  mevProtection: 'on' | 'off';
  gas: GasEstimate;
  ticket: string;
  expiresAt: string;
}

export interface ActionExecuteResult extends TradeExecuteResult {
  chainId: 1 | 8453;
}

export const actionQuote = (params: MiniActionParams) =>
  call<{ ok: true; quote: ActionQuote }>('/action/quote', { method: 'POST', body: params });

export const actionExecute = (
  ticket: string,
  feeTier: FeeTierKey = 'market'
) =>
  call<ActionExecuteResult>('/action/execute', {
    method: 'POST',
    body: { ticket, feeTier },
  });

export interface SaveProtocolConfig {
  totalSupply: string;
  totalAssets: string;
  assetsPerShare: number | null;
  cooldownHours: number;
  instantRedeemFeePct: number;
  expenseRatioPct: number;
  harvesterRatioPct: number;
  threshold: string;
}

export interface ProtocolInfo {
  network: { name: 'Ethereum'; chainId: 1 };
  save: SaveProtocolConfig;
  tokens: Array<{
    symbol: ProtocolTokenSymbol;
    decimals: number;
    native: boolean;
    positionMarkets: Market[];
  }>;
}

export const getProtocol = () => call<ProtocolInfo>('/protocol');

export interface BridgeChainState {
  chainId: 1 | 8453;
  /** False means the source RPC read failed; null balances are not zeros. */
  known: boolean;
  /** Native ETH available for source-chain gas and the LayerZero fee. */
  native: string | null;
  assets: {
    fxUSD: string | null;
    fxSAVE: string | null;
  };
}

export interface BridgeState {
  /** Operator execution gate. Balances remain readable while paused. */
  enabled: boolean;
  ethereum: BridgeChainState;
  base: BridgeChainState;
}

export const getBridgeState = () => call<BridgeState>('/bridge-state');

export interface ActivityItem {
  id: string;
  hash: string | null;
  hashes: string[];
  status: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  chainId: 1 | 8453;
  steps: Array<{ index: number; status: string; hash: string | null }>;
  message: string | null;
}

export const getActivity = (take = 30) =>
  call<{ items: ActivityItem[] }>(`/activity?take=${Math.max(1, Math.min(50, Math.round(take)))}`);
