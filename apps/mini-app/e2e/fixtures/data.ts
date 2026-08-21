/**
 * Deterministic API fixtures mirroring the bot's Mini App API shapes
 * (see apps/mini-app/src/lib/api.ts). Every value is fixed so visual snapshots
 * and assertions are reproducible.
 */
import type {
  ActionExecuteResult,
  ActionQuote,
  ActivityItem,
  BridgeState,
  Me,
  MarketSnapshot,
  MiniActionParams,
  ProtocolInfo,
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
  funding: {
    known: true,
    funded: true,
    eth: '1.2500',
    wstEth: '0.5000',
    wbtc: '0.0100',
    balances: {
      ETH: '1.2500',
      WETH: '0.3500',
      stETH: '0.7500',
      wstETH: '0.5000',
      WBTC: '0.0100',
      USDC: '2400.00',
      USDT: '900.00',
      fxUSD: '850.00',
      fxSAVE: '1200.0000',
      fxUSDBasePool: '125.00',
    },
  },
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
  funding: {
    known: true,
    funded: false,
    eth: '0',
    wstEth: '0',
    wbtc: '0',
    balances: { ETH: '0', wstETH: '0', WBTC: '0', fxUSD: '0', fxSAVE: '0' },
  },
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
    // Order matches the product sort: BTC, ETH, FXN, fxUSD, FRAX, then others.
    { symbol: 'BTC', data: { priceUsd: 104500.0, marketCapUsd: 2_000_000_000_000, change24hPct: 1.05, change7dPct: 2.3 } },
    { symbol: 'ETH', data: { priceUsd: 3500.42, marketCapUsd: 420_000_000_000, change24hPct: 1.23, change7dPct: -0.54 } },
    { symbol: 'FXN', data: { priceUsd: 12.5, marketCapUsd: 1_900_000, change24hPct: -2.1, change7dPct: -5.4 } },
    { symbol: 'fxUSD', data: { priceUsd: 1.0009, marketCapUsd: 75_000_000, change24hPct: 0.02, change7dPct: 0.11 } },
    { symbol: 'FRAX', data: { priceUsd: 0.285, marketCapUsd: 27_000_000, change24hPct: -2.2, change7dPct: -28.0 } },
    { symbol: 'wstETH', data: { priceUsd: 3500.42, marketCapUsd: 9_800_000_000, change24hPct: 1.23, change7dPct: -0.54 } },
    { symbol: 'WBTC', data: { priceUsd: 65000.0, marketCapUsd: 12_400_000_000, change24hPct: -0.81, change7dPct: 2.06 } },
  ],
};

export const protocolInfo: ProtocolInfo = {
  network: { name: 'Ethereum', chainId: 1 },
  save: {
    totalSupply: '10000000.0000',
    totalAssets: '10250000.0000',
    assetsPerShare: 1.025,
    cooldownHours: 24,
    instantRedeemFeePct: 0.25,
    expenseRatioPct: 10,
    harvesterRatioPct: 2,
    threshold: '1000',
  },
  tokens: [
    { symbol: 'ETH', decimals: 18, native: true, positionMarkets: ['wstETH'] },
    { symbol: 'wstETH', decimals: 18, native: false, positionMarkets: ['wstETH'] },
    { symbol: 'WBTC', decimals: 8, native: false, positionMarkets: ['WBTC'] },
    { symbol: 'USDC', decimals: 6, native: false, positionMarkets: ['wstETH', 'WBTC'] },
    { symbol: 'fxUSD', decimals: 18, native: false, positionMarkets: ['wstETH', 'WBTC'] },
    { symbol: 'fxSAVE', decimals: 18, native: false, positionMarkets: [] },
    { symbol: 'fxUSDBasePool', decimals: 18, native: false, positionMarkets: [] },
  ],
};

export const bridgeState: BridgeState = {
  enabled: true,
  ethereum: {
    chainId: 1,
    known: true,
    native: '0.125',
    assets: { fxUSD: '850', fxSAVE: '1200' },
  },
  base: {
    chainId: 8453,
    known: true,
    native: '0.03125',
    assets: { fxUSD: '90.5', fxSAVE: '40.25' },
  },
};

const actionGas = {
  units: '450000',
  recommended: 'market' as const,
  tiers: [
    { key: 'slow' as const, maxFeeGwei: 18.2, priorityGwei: 0.5, estCostWei: '8190000000000000', estCostEth: 0.00819, estCostUsd: 7.35 },
    { key: 'market' as const, maxFeeGwei: 22.4, priorityGwei: 1.2, estCostWei: '10080000000000000', estCostEth: 0.01008, estCostUsd: 9.8 },
    { key: 'fast' as const, maxFeeGwei: 28.9, priorityGwei: 2.5, estCostWei: '13005000000000000', estCostEth: 0.013005, estCostUsd: 12.6 },
  ],
};

function actionTitle(params: MiniActionParams): string {
  switch (params.kind) {
    case 'position_open': return `Open ${params.market} ${params.side}`;
    case 'position_increase': return `Increase ${params.market} position`;
    case 'position_reduce': return params.fractionBps === 10_000 ? `Close ${params.market} position` : `Reduce ${params.market} position`;
    case 'position_adjust': return `Adjust ${params.market} leverage`;
    case 'mint': return 'Mint fxUSD';
    case 'repay_withdraw': return 'Repay and release collateral';
    case 'save_deposit': return 'Deposit to fxSAVE';
    case 'save_withdraw': return params.instant ? 'Redeem fxSAVE instantly' : 'Queue fxSAVE redemption';
    case 'save_claim': return 'Claim fxSAVE redemption';
    case 'bridge': return params.direction === 'ethereum_to_base' ? `Bridge ${params.token} to Base` : `Bridge ${params.token} to Ethereum`;
  }
}

function actionDetails(params: MiniActionParams): Array<{ label: string; value: string }> {
  switch (params.kind) {
    case 'position_open':
      return [
        { label: 'Input', value: `${params.amount} ${params.inputToken}` },
        { label: 'Direction', value: params.side },
        { label: 'Leverage', value: `${params.leverage}x` },
      ];
    case 'position_increase':
      return [{ label: 'Position', value: `#${params.positionId}` }, { label: 'Input', value: `${params.amount} ${params.inputToken}` }];
    case 'position_reduce':
      return [{ label: 'Position', value: `#${params.positionId}` }, { label: 'Reduction', value: `${params.fractionBps / 100}%` }, { label: 'Receive', value: params.outputToken }];
    case 'position_adjust':
      return [{ label: 'Position', value: `#${params.positionId}` }, { label: 'Target leverage', value: `${params.leverage}x` }];
    case 'mint':
      return [{ label: 'Collateral', value: `${params.depositAmount} ${params.depositToken}` }, { label: 'Mint', value: `${params.mintAmount} fxUSD` }];
    case 'repay_withdraw':
      return [{ label: 'Repay', value: `${params.repayAmount} fxUSD` }, { label: 'Release', value: `${params.withdrawAmount} ${params.withdrawToken}` }];
    case 'save_deposit':
      return [{ label: 'Deposit', value: `${params.amount} ${params.tokenIn}` }];
    case 'save_withdraw':
      return [{ label: 'Shares', value: `${params.shares} fxSAVE` }, { label: 'Receive', value: params.tokenOut }];
    case 'save_claim':
      return [{ label: 'Action', value: 'Claim queued redemption' }];
    case 'bridge':
      return [{ label: 'Send', value: `${params.amount} ${params.token}` }, { label: 'Direction', value: params.direction === 'ethereum_to_base' ? 'Ethereum to Base' : 'Base to Ethereum' }];
  }
}

/** A deterministic review assembled from the submitted intent. */
export function actionQuoteFor(params: MiniActionParams): ActionQuote {
  const fromBase = params.kind === 'bridge' && params.direction === 'base_to_ethereum';
  return {
    kind: params.kind,
    title: actionTitle(params),
    description: 'Official SDK route, rebuilt from this wallet-scoped intent.',
    network: fromBase ? 'Base' : 'Ethereum',
    chainId: fromBase ? 8453 : 1,
    details: actionDetails(params),
    warning: params.kind === 'bridge' ? 'The native LayerZero fee is included in this source-chain quote.' : undefined,
    mevProtection: fromBase ? 'off' : 'on',
    gas: structuredClone(actionGas),
    ticket: (fromBase ? 'B' : 'E').repeat(43),
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

export const actionExecuteSuccess: ActionExecuteResult = {
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
  chainId: 1,
};

export const actionExecuteDeduped: ActionExecuteResult = {
  ...actionExecuteSuccess,
  deduped: true,
  status: 'broadcast',
  receipt: null,
};

export const activityItems: ActivityItem[] = [
  {
    id: 'activity-eth',
    hash: TX_HASH,
    hashes: [TX_HASH],
    status: 'confirmed',
    type: 'open_long',
    createdAt: '2026-01-02T12:00:00.000Z',
    updatedAt: '2026-01-02T12:01:00.000Z',
    chainId: 1,
    steps: [{ index: 0, status: 'confirmed', hash: TX_HASH }],
    message: null,
  },
  {
    id: 'activity-base',
    hash: null,
    hashes: ['0x' + 'cd'.repeat(32)],
    status: 'broadcast',
    type: 'bridge_base_to_eth',
    createdAt: '2026-01-03T15:30:00.000Z',
    updatedAt: '2026-01-03T15:30:05.000Z',
    chainId: 8453,
    steps: [{ index: 0, status: 'broadcast', hash: '0x' + 'cd'.repeat(32) }],
    message: 'Waiting for a source-chain receipt.',
  },
  {
    id: 'activity-failed',
    hash: null,
    hashes: [],
    status: 'failed',
    type: 'fxsave_withdraw',
    createdAt: '2026-01-04T08:15:00.000Z',
    updatedAt: '2026-01-04T08:15:02.000Z',
    chainId: 1,
    steps: [],
    message: 'Simulation failed before broadcast.',
  },
];
