/**
 * Deterministic API fixtures mirroring the bot's Mini App API shapes
 * (see apps/mini-app/src/lib/api.ts). Every value is fixed so visual snapshots
 * and assertions are reproducible.
 */
import type {
  Me,
  MarketSnapshot,
  TradeQuote,
  TradeExecuteResult,
} from '../../src/lib/api';

export const WALLET = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
export const TX_HASH = '0x' + 'ab'.repeat(32);

/** A fully-onboarded, funded user with two positions and an fxSAVE holding. */
export const onboardedMe: Me = {
  onboarded: true,
  walletAddress: WALLET,
  referralCode: 'FXAEON',
  language: 'en',
  slippageBps: 50,
  mevProtection: 'on',
  walletDelegated: true,
  walletImported: false,
  funding: { known: true, funded: true, eth: '1.2500', wstEth: '0.5000', wbtc: '0.0100' },
  positionsKnown: true,
  positions: [
    {
      tokenId: '1',
      market: 'wstETH',
      side: 'long',
      collateral: '0.5000',
      collateralToken: 'wstETH',
      debt: '500.00',
      debtToken: 'fxUSD',
      leverage: 3,
      healthPercent: 0.82,
      sizeUsd: 1750,
      pnlUsd: 124.5,
      pnlSince: '2026-01-01T00:00:00.000Z',
    },
    {
      tokenId: '2',
      market: 'WBTC',
      side: 'short',
      collateral: '0.0100',
      collateralToken: 'WBTC',
      debt: '300.00',
      debtToken: 'fxUSD',
      leverage: 2,
      healthPercent: 0.41,
      sizeUsd: 650,
      pnlUsd: -32.1,
      pnlSince: '2026-01-01T00:00:00.000Z',
    },
  ],
  savingsKnown: true,
  savings: {
    shares: '1200.0000',
    assets: '1215.5000',
    valueUsd: 1215.5,
    pendingRedeem: false,
    redeemReady: false,
    pendingShares: '0',
    redeemableAt: null,
    cooldownHours: 24,
  },
  summary: {
    totalValueUsd: 5240.75,
    walletUsd: 2400,
    positionsUsd: 1625.0,
    savingsUsd: 1215.5,
    netPnlUsd: 92.4,
    netPnlPct: 1.79,
  },
};

/** A freshly-onboarded user: no positions, no savings, unfunded wallet. */
export const emptyMe: Me = {
  onboarded: true,
  walletAddress: WALLET,
  referralCode: null,
  language: 'en',
  slippageBps: 50,
  mevProtection: 'off',
  walletDelegated: false,
  walletImported: false,
  funding: { known: true, funded: false, eth: '0', wstEth: '0', wbtc: '0' },
  positionsKnown: true,
  positions: [],
  savingsKnown: true,
  savings: null,
  summary: {
    totalValueUsd: null,
    walletUsd: null,
    positionsUsd: null,
    savingsUsd: 0,
    netPnlUsd: null,
    netPnlPct: null,
  },
};

export const marketSnapshot: MarketSnapshot = {
  fetchedAt: '2026-01-01T00:00:00.000Z',
  stale: false,
  rows: [
    { symbol: 'fxUSD', data: { priceUsd: 1.0009, marketCapUsd: 75_000_000, change24hPct: 0.02, change7dPct: 0.11 } },
    { symbol: 'wstETH', data: { priceUsd: 3500.42, marketCapUsd: 9_800_000_000, change24hPct: 1.23, change7dPct: -0.54 } },
    { symbol: 'WBTC', data: { priceUsd: 65000.0, marketCapUsd: 12_400_000_000, change24hPct: -0.81, change7dPct: 2.06 } },
  ],
};

/** A review-quote for the canonical test trade: wstETH long 3x, 1 wstETH. */
export function quoteFor(
  market = 'wstETH',
  side: 'long' | 'short' = 'long',
  leverage = 3,
  collateral = 1
): TradeQuote {
  return {
    market,
    side,
    leverage,
    collateral,
    collateralToken: market,
    exposure: collateral * leverage,
    executionPrice: '3500.42',
    collateralAfter: collateral * leverage,
    debtAfter: collateral * leverage * 2333.33,
    positionId: 0,
    slippagePct: 0.5,
    mevProtection: 'on',
    routeType: 'FxRoute',
    gas: {
      units: '450000',
      recommended: 'market',
      tiers: [
        { key: 'slow', maxFeeGwei: 18.2, priorityGwei: 0.5, estCostWei: '8190000000000000', estCostEth: 0.00819, estCostUsd: 7.35 },
        { key: 'market', maxFeeGwei: 22.4, priorityGwei: 1.2, estCostWei: '10080000000000000', estCostEth: 0.01008, estCostUsd: 9.8 },
        { key: 'fast', maxFeeGwei: 28.9, priorityGwei: 2.5, estCostWei: '13005000000000000', estCostEth: 0.013005, estCostUsd: 12.6 },
      ],
    },
  };
}

export const executeSuccess: TradeExecuteResult = {
  ok: true,
  deduped: false,
  status: 'confirmed',
  txHash: TX_HASH,
  hashes: [TX_HASH],
  recordId: 'rec-1',
  receipt: {
    blockNumber: 19_000_000,
    gasUsed: '420000',
    effectiveGasPriceGwei: 21.5,
    gasPaidWei: '9030000000000000',
    gasPaidEth: 0.00903,
    gasPaidUsd: 31.6,
    confirmations: 3,
  },
};

export const executeDeduped: TradeExecuteResult = {
  ...executeSuccess,
  deduped: true,
  status: 'broadcast',
  receipt: null,
};
