import { formatUnits, parseUnits, type Address } from 'viem';
import { tokens as sdkTokens } from '@aladdindao/fx-sdk';
import type { PositionInfo, TokenSymbol } from '@aladdindao/fx-sdk';
import { assertConfiguredPublicClientChain, assertPublicClientChain, getEthereumClient, getFxSdk, type FxPublicClient } from '@/lib/fx';

export type UiMarket = 'ETH' | 'BTC';
export type UiSide = 'long' | 'short';
export type UiToken = 'ETH' | 'WETH' | 'stETH' | 'wstETH' | 'WBTC' | 'USDC' | 'USDT' | 'fxUSD';
export type SaveToken = 'usdc' | 'fxUSD' | 'fxUSDBasePool';

export const FXUSD_ADDRESS = sdkTokens.fxUSD as Address;
export const FXSAVE_ADDRESS = '0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39' as Address;
export const FXUSD_BASE_POOL_ADDRESS = sdkTokens.fxUSDBasePool as Address;

export const TOKEN_META: Record<UiToken | 'fxSAVE' | 'fxUSDBasePool', { address: Address; decimals: number }> = {
  ETH: { address: sdkTokens.eth as Address, decimals: 18 },
  WETH: { address: sdkTokens.weth as Address, decimals: 18 },
  stETH: { address: sdkTokens.stETH as Address, decimals: 18 },
  wstETH: { address: sdkTokens.wstETH as Address, decimals: 18 },
  WBTC: { address: sdkTokens.WBTC as Address, decimals: 8 },
  USDC: { address: sdkTokens.usdc as Address, decimals: 6 },
  USDT: { address: sdkTokens.usdt as Address, decimals: 6 },
  fxUSD: { address: sdkTokens.fxUSD as Address, decimals: 18 },
  fxSAVE: { address: FXSAVE_ADDRESS, decimals: 18 },
  fxUSDBasePool: { address: sdkTokens.fxUSDBasePool as Address, decimals: 18 },
};

export const ETH_MARKET_TOKENS: readonly UiToken[] = ['ETH', 'WETH', 'stETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'];
export const ETH_SHORT_MARKET_TOKENS: readonly UiToken[] = ['ETH', 'WETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'];
export const BTC_MARKET_TOKENS: readonly UiToken[] = ['WBTC', 'USDC', 'USDT', 'fxUSD'];

/** Mirror the exact input-token allow-list enforced by fx-sdk. */
export function positionInputTokenOptions(market: UiMarket): readonly UiToken[] {
  return market === 'BTC' ? BTC_MARKET_TOKENS : ETH_MARKET_TOKENS;
}

/** The SDK excludes stETH only when it is the output of an ETH short. */
export function positionOutputTokenOptions(market: UiMarket, side: UiSide): readonly UiToken[] {
  if (market === 'BTC') return BTC_MARKET_TOKENS;
  return side === 'short' ? ETH_SHORT_MARKET_TOKENS : ETH_MARKET_TOKENS;
}

const WAD = 10n ** 18n;
const WSTETH_RATE_ABI = [{ type: 'function', name: 'stEthPerToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;

export function tokenAddress(token: UiToken | 'fxSAVE' | 'fxUSDBasePool'): Address {
  return TOKEN_META[token].address;
}

export function tokenDecimals(token: UiToken | 'fxSAVE' | 'fxUSDBasePool'): number {
  return TOKEN_META[token].decimals;
}

export function parseAmount(value: string, token: UiToken | 'fxSAVE' | 'fxUSDBasePool'): bigint | null {
  if (!value || value === 'all') return null;
  try {
    const amount = parseUnits(value, tokenDecimals(token));
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

export function parseZeroAmount(value: string, token: UiToken | 'fxSAVE' | 'fxUSDBasePool'): bigint | null {
  if (!value) return 0n;
  try {
    return parseUnits(value, tokenDecimals(token));
  } catch {
    return null;
  }
}

export function formatAmount(value: bigint | undefined, decimals = 18, digits = 5): string {
  if (value === undefined) return '—';
  const raw = formatUnits(value, decimals);
  const [integer, fraction = ''] = raw.split('.');
  const trimmed = fraction.slice(0, digits).replace(/0+$/, '');
  return trimmed ? `${integer}.${trimmed}` : integer;
}

export interface UiPosition {
  market: UiMarket;
  side: UiSide;
  info: PositionInfo;
}

/**
 * Resolve the display/input precision from the token symbol, not only from
 * the SDK's decimal metadata.  The pinned SDK currently reports 18 for both
 * position fields even for the BTC pools, whose WBTC amounts are 8-decimal
 * token units.  Raw values remain untouched; this helper only prevents the
 * UI from rendering a BTC amount with the wrong scale.
 */
export function positionTokenDecimals(
  position: UiPosition,
  field: 'collateral' | 'debt',
): number {
  const symbol = (field === 'collateral' ? position.info.rawCollsToken : position.info.rawDebtsToken).toLowerCase();
  if (symbol === 'wbtc' || symbol === 'wbtc.e') return 8;
  if (symbol === 'usdc' || symbol === 'usdt') return 6;
  if (symbol === 'eth' || symbol === 'weth' || symbol === 'steth' || symbol === 'wsteth' || symbol === 'fxusd') return 18;
  return field === 'collateral' ? position.info.rawCollsDecimals : position.info.rawDebtsDecimals;
}

export async function readAllPositions(walletAddress: string): Promise<UiPosition[]> {
  await assertConfiguredPublicClientChain(1);
  const sdk = getFxSdk();
  const requests: Array<{ market: UiMarket; side: UiSide }> = [
    { market: 'ETH', side: 'long' },
    { market: 'ETH', side: 'short' },
    { market: 'BTC', side: 'long' },
    { market: 'BTC', side: 'short' },
  ];
  const results = await Promise.all(requests.map(async (request) => ({
    ...request,
    positions: await sdk.getPositions({
      userAddress: walletAddress,
      market: request.market,
      type: request.side,
    }),
  })));
  return results.flatMap((result) => result.positions.map((info) => ({ market: result.market, side: result.side, info })));
}

export function positionCollateralDecimals(position: UiPosition): number {
  return positionTokenDecimals(position, 'collateral');
}

export function positionDebtDecimals(position: UiPosition): number {
  return positionTokenDecimals(position, 'debt');
}

export function positionKey(position: UiPosition): string {
  return `${position.market}:${position.side}:${position.info.positionId}`;
}

/**
 * fx-sdk's reducePosition amount is not one universal unit:
 * - long positions use raw collateral units;
 * - BTC shorts use raw debt units;
 * - ETH/wstETH shorts use raw debt normalized by the live stETH-per-token rate.
 * Full closes use a positive sentinel because the SDK's close branch ignores
 * the amount after its positive-input validation.
 */
export function calculateSdkReductionAmountWei(params: {
  market: UiMarket;
  side: UiSide;
  rawCollateralWei: bigint;
  rawDebtWei: bigint;
  fractionBps: number;
  wstEthRateWei?: bigint;
}): bigint {
  const { market, side, rawCollateralWei, rawDebtWei, fractionBps, wstEthRateWei } = params;
  if (!Number.isInteger(fractionBps) || fractionBps <= 0 || fractionBps > 10_000) {
    throw new RangeError('Reduction fraction must be from 1% to 100%');
  }
  if (rawCollateralWei <= 0n) throw new RangeError('Position collateral must be greater than zero');
  if (fractionBps === 10_000) return 1n;
  if (side === 'long') {
    const amount = (rawCollateralWei * BigInt(fractionBps)) / 10_000n;
    if (amount <= 0n || amount >= rawCollateralWei) throw new RangeError('Reduction rounds to an invalid SDK amount');
    return amount;
  }
  if (rawDebtWei <= 0n) throw new RangeError('Position debt must be greater than zero');
  const rate = market === 'ETH' ? wstEthRateWei : WAD;
  if (rate === undefined || rate <= 0n) throw new RangeError('A positive stETH conversion rate is required for an ETH short');
  const numerator = rawDebtWei * rate;
  const basis = numerator / WAD;
  const amount = (numerator * BigInt(fractionBps)) / (WAD * 10_000n);
  if (amount <= 0n || amount >= basis) throw new RangeError('Reduction rounds to an invalid SDK amount');
  return amount;
}

export async function getSdkReductionAmountWei(params: {
  client?: Pick<FxPublicClient, 'readContract'>;
  market: UiMarket;
  side: UiSide;
  rawCollateralWei: bigint;
  rawDebtWei: bigint;
  fractionBps: number;
}): Promise<bigint> {
  let wstEthRateWei: bigint | undefined;
  if (params.side === 'short' && params.market === 'ETH' && params.fractionBps < 10_000) {
    const client = params.client ?? getEthereumClient();
    await assertPublicClientChain(client as FxPublicClient, 1);
    wstEthRateWei = await client.readContract({ address: tokenAddress('wstETH'), abi: WSTETH_RATE_ABI, functionName: 'stEthPerToken' });
  }
  return calculateSdkReductionAmountWei({ ...params, wstEthRateWei });
}

export function sdkTokenSymbol(token: UiToken): TokenSymbol {
  return token === 'ETH' ? 'ETH' : token === 'fxUSD' ? 'FXUSD' : token as TokenSymbol;
}
