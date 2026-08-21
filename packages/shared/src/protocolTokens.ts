import { ADDRESSES } from './addresses.js';

export const PROTOCOL_TOKEN_SYMBOLS = [
  'ETH',
  'WETH',
  'stETH',
  'wstETH',
  'WBTC',
  'USDC',
  'USDT',
  'fxUSD',
  'fxSAVE',
  'fxUSDBasePool',
] as const;

export type ProtocolTokenSymbol = (typeof PROTOCOL_TOKEN_SYMBOLS)[number];

export interface ProtocolToken {
  symbol: ProtocolTokenSymbol;
  address: `0x${string}`;
  decimals: number;
  native: boolean;
  /** Markets accepted by fx-sdk increasePosition/reducePosition. */
  positionMarkets: readonly ('wstETH' | 'WBTC')[];
}

/**
 * Canonical token metadata for every user-facing token accepted by fx-sdk
 * 1.0.5. This registry is shared by API validation and the Mini App so token
 * units and market compatibility cannot drift between surfaces.
 */
export const PROTOCOL_TOKENS: Record<ProtocolTokenSymbol, ProtocolToken> = {
  ETH: {
    symbol: 'ETH',
    address: ADDRESSES.ETH,
    decimals: 18,
    native: true,
    positionMarkets: ['wstETH'],
  },
  WETH: {
    symbol: 'WETH',
    address: ADDRESSES.WETH,
    decimals: 18,
    native: false,
    positionMarkets: ['wstETH'],
  },
  stETH: {
    symbol: 'stETH',
    address: ADDRESSES.STETH,
    decimals: 18,
    native: false,
    positionMarkets: ['wstETH'],
  },
  wstETH: {
    symbol: 'wstETH',
    address: ADDRESSES.WSTETH,
    decimals: 18,
    native: false,
    positionMarkets: ['wstETH'],
  },
  WBTC: {
    symbol: 'WBTC',
    address: ADDRESSES.WBTC,
    decimals: 8,
    native: false,
    positionMarkets: ['WBTC'],
  },
  USDC: {
    symbol: 'USDC',
    address: ADDRESSES.USDC,
    decimals: 6,
    native: false,
    positionMarkets: ['wstETH', 'WBTC'],
  },
  USDT: {
    symbol: 'USDT',
    address: ADDRESSES.USDT,
    decimals: 6,
    native: false,
    positionMarkets: ['wstETH', 'WBTC'],
  },
  fxUSD: {
    symbol: 'fxUSD',
    address: ADDRESSES.FXUSD,
    decimals: 18,
    native: false,
    positionMarkets: ['wstETH', 'WBTC'],
  },
  fxSAVE: {
    symbol: 'fxSAVE',
    address: ADDRESSES.FXSAVE,
    decimals: 18,
    native: false,
    positionMarkets: [],
  },
  fxUSDBasePool: {
    symbol: 'fxUSDBasePool',
    address: ADDRESSES.FXUSD_BASE_POOL,
    decimals: 18,
    native: false,
    positionMarkets: [],
  },
};

export function isProtocolTokenSymbol(value: unknown): value is ProtocolTokenSymbol {
  return typeof value === 'string' && PROTOCOL_TOKEN_SYMBOLS.includes(value as ProtocolTokenSymbol);
}

export function positionTokensForMarket(
  market: 'wstETH' | 'WBTC'
): ProtocolTokenSymbol[] {
  return PROTOCOL_TOKEN_SYMBOLS.filter((symbol) =>
    PROTOCOL_TOKENS[symbol].positionMarkets.includes(market)
  );
}
