import type { FxTokenKey } from './tokens';

export type TokenPresentation = { symbol: string; name: string; role: string };

const PRESENTATIONS: Partial<Record<FxTokenKey, TokenPresentation>> = {
  ETH: { symbol: 'ETH', name: 'Ethereum', role: 'Native asset' },
  WETH: { symbol: 'WETH', name: 'Wrapped Ether', role: 'Wrapped asset' },
  stETH: { symbol: 'stETH', name: 'Lido Staked Ether', role: 'Liquid staking token' },
  wstETH: { symbol: 'wstETH', name: 'Wrapped staked Ether', role: 'Liquid staking token' },
  WBTC: { symbol: 'WBTC', name: 'Wrapped Bitcoin', role: 'Wrapped asset' },
  USDC: { symbol: 'USDC', name: 'USD Coin', role: 'Stablecoin' },
  USDT: { symbol: 'USDT', name: 'Tether USD', role: 'Stablecoin' },
  fxUSD: { symbol: 'fxUSD', name: 'f(x) USD', role: 'Protocol stablecoin' },
  fxUSDBasePool: { symbol: 'fxUSDBasePool', name: 'f(x) USD base-pool shares', role: 'Pool share token' },
  fxSAVE: { symbol: 'fxSAVE', name: 'f(x) Savings', role: 'Savings share token' },
  FXN: { symbol: 'FXN', name: 'f(x) Network', role: 'Protocol token' },
};

export function tokenPresentation(token: string): TokenPresentation {
  if (token === 'usdc') return PRESENTATIONS.USDC!;
  return PRESENTATIONS[token as FxTokenKey] ?? { symbol: token, name: token, role: 'Token' };
}
export function tokenSymbol(token: string): string { return tokenPresentation(token).symbol; }
export function tokenName(token: string): string { return tokenPresentation(token).name; }
export function tokenRole(token: string): string { return tokenPresentation(token).role; }
