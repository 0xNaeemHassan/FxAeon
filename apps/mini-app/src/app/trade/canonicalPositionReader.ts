import type { PositionInfo } from '@aladdindao/fx-sdk';
import type { Address } from 'viem';
import type { FxPublicClient } from '@/lib/fx/types';
import { positionPoolAddress } from '@/lib/fx/policy';
import type { PositionGroup } from './fxUi';

const WAD = 10n ** 18n;
const QUERY_AMOUNT = 100n * WAD;
const RATE_PROVIDER = '0x81A777c4aB65229d1Bf64DaE4c831bDf628Ccc7f' as Address;
const CONVERTER = '0x12AF4529129303D7FbD2563E242C4a2890525912' as Address;

const POSITION_ABI = [{
  type: 'function', name: 'getPosition', stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: 'collateral', type: 'uint256' }, { name: 'debt', type: 'uint256' }],
}] as const;
const RATE_ABI = [{
  type: 'function', name: 'getRate', stateMutability: 'view', inputs: [],
  outputs: [{ name: 'rate', type: 'uint256' }],
}] as const;
const QUOTE_ABI = [{
  type: 'function', name: 'queryConvert', stateMutability: 'nonpayable',
  inputs: [
    { name: '_amount', type: 'uint256' },
    { name: '_encoding', type: 'uint256' },
    { name: '_routes', type: 'uint256[]' },
  ], outputs: [{ name: 'amountOut', type: 'uint256' }],
}] as const;

type ReadClient = Pick<FxPublicClient, 'readContract'>;
type PoolReaderConfig = {
  isShort: boolean;
  collSymbol: string;
  debtSymbol: string;
  minPrecision: bigint;
  precision: bigint;
  routesIn: readonly `0x${string}`[];
  routesOut: readonly `0x${string}`[];
  encodingIn: bigint;
  encodingOut: bigint;
  sellAmount: bigint;
};

// These are the pinned SDK 1.0.5 pool configs and FxRoute paths.  Keeping the
// values local avoids importing private SDK classes while retaining its exact
// accounting units and long/short semantics.
const ETH_IN = ['0x254062fa20b733978fcbcec244eb8825ae6cfed87c0c', '0x040007d2239a830b7749bfbad93c0e68b104a5bf2cfd590001', '0x02b9eae5948378e863978446d7aaac254c4b5ffa110a', '0x01fce71607d656d4f172c66f42cfe369b24d78b2810a'] as const;
const ETH_OUT = ['0x01fce71607d656d4f172c66f42cfe369b24d78b2820a', '0x277090c5ae6b80a3c525f09d7ae464a8fa83d9c08804', '0x07d2239a830b7749bfbad93c0e68b104a5bf2cfd590001', '0x01054062fa20b733978fcbcec244eb8825ae6cfed87c0c'] as const;
const BTC_IN = ['0x254062fa20b733978fcbcec244eb8825ae6cfed87c0c', '0x2ee266b2329c21fe928a87ed8d5c9a659688052af0d401'] as const;
const BTC_OUT = ['0x04002ee266b2329c21fe928a87ed8d5c9a659688052af0d401', '0x01054062fa20b733978fcbcec244eb8825ae6cfed87c0c'] as const;
const BTC_V3_IN = ['0x254062fa20b733978fcbcec244eb8825ae6cfed87c0c', '0x07d269dc8063ef5dff34b49595f97151eebfcff5f45801'] as const;
const BTC_V3_OUT = ['0x040007d269dc8063ef5dff34b49595f97151eebfcff5f45801', '0x01054062fa20b733978fcbcec244eb8825ae6cfed87c0c'] as const;

function configFor(group: PositionGroup): PoolReaderConfig {
  const eth = group.market === 'ETH';
  const short = group.side === 'short';
  return {
    isShort: short,
    collSymbol: short ? 'fxUSD' : eth ? 'ETH' : 'WBTC',
    debtSymbol: short ? eth ? 'wstETH' : 'WBTC' : 'fxUSD',
    minPrecision: eth ? 100_000_000_000_000n : 1_000_000_000_000n,
    precision: eth ? WAD : 100_000_000n,
    routesIn: eth ? ETH_IN : BTC_IN,
    routesOut: eth ? ETH_OUT : BTC_OUT,
    encodingIn: 1_048_575n + (BigInt(eth ? 4 : 2) << 20n),
    encodingOut: 1_048_575n + (BigInt(eth ? 4 : 2) << 20n),
    sellAmount: eth ? 10n ** 16n : 10n ** 4n,
  };
}

function tuple2(value: unknown, label: string): readonly [bigint, bigint] {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'bigint' || typeof value[1] !== 'bigint' || value[0] < 0n || value[1] < 0n) {
    throw new TypeError(`${label} was malformed`);
  }
  return [value[0], value[1]];
}

function uint(value: unknown, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) throw new TypeError(`${label} was malformed`);
  return value;
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/** Convert a positive ratio without first coercing its raw accounting integers. */
function ratioToNumber(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new RangeError('ratio denominator must be positive');
  if (numerator === 0n) return 0;
  const integer = numerator / denominator;
  const remainder = numerator % denominator;
  const whole = Number(integer);
  if (!Number.isFinite(whole)) throw new RangeError('position leverage exceeded numeric range');
  const fractionDigits = 18;
  const scale = 10n ** BigInt(fractionDigits);
  const fraction = Number((remainder * scale) / denominator) / Number(scale);
  const result = whole + fraction;
  if (!Number.isFinite(result)) throw new RangeError('position leverage was not finite');
  return result;
}

export interface CanonicalPositionContext {
  rate: bigint;
  averageNumerator: bigint;
  averageDenominator: bigint;
}

async function queryConvert(client: ReadClient, amount: bigint, encoding: bigint, routes: readonly `0x${string}`[]): Promise<bigint> {
  return uint(await client.readContract({
    address: CONVERTER,
    abi: QUOTE_ABI,
    functionName: 'queryConvert',
    args: [amount, encoding, routes],
  } as Parameters<ReadClient['readContract']>[0]), 'conversion quote');
}

// SDK getQuote includes both FxRoute candidates for WBTC and selects the
// greatest output independently for buying and selling. One failed candidate
// must not discard a valid quote from the other route.
async function bestQuote(client: ReadClient, amount: bigint, encoding: bigint, routes: readonly `0x${string}`[], alternate?: readonly `0x${string}`[]): Promise<bigint> {
  const results = await Promise.allSettled([routes, ...(alternate ? [alternate] : [])].map((route) => queryConvert(client, amount, encoding, route)));
  const quotes = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (quotes.length === 0) throw new Error('canonical position quotes unavailable');
  return quotes.reduce((best, quote) => quote > best ? quote : best);
}

/**
 * Read one position using the same pool config, FxRoute quote prices, close
 * threshold, short debt normalization, and leverage formula as SDK 1.0.5.
 */
export async function readCanonicalPositionInfo(params: {
  client: ReadClient;
  group: PositionGroup;
  positionId: number;
  context?: CanonicalPositionContext;
}): Promise<PositionInfo> {
  if (!Number.isSafeInteger(params.positionId) || params.positionId < 1) throw new TypeError('position ID must be a positive safe integer');
  const config = configFor(params.group);
  const pool = positionPoolAddress(params.group.market, params.group.side);
  const [state, context] = await Promise.all([
    params.client.readContract({ address: pool, abi: POSITION_ABI, functionName: 'getPosition', args: [BigInt(params.positionId)] } as Parameters<ReadClient['readContract']>[0]),
    params.context ?? readCanonicalPositionContext({ client: params.client, group: params.group }),
  ]);
  const [rawColls, rawDebts] = tuple2(state, 'canonical position state');
  const { rate, averageNumerator, averageDenominator } = context;
  const closed = rawColls < 5n * config.minPrecision;
  // Position.getPositionInfo rounds currentSize and debtUsd independently
  // with Decimal#toFixed(0) before calculating leverage. Keep that rounding
  // boundary instead of using a display-price approximation.
  const normalizedColl = closed ? 0n : rawColls;
  const normalizedDebt = closed ? 0n : config.isShort ? roundDiv(rawDebts * rate, WAD) : rawDebts;
  const currentSize = config.isShort ? normalizedColl : roundDiv(normalizedColl * averageNumerator, averageDenominator);
  const debtUsd = config.isShort ? roundDiv(normalizedDebt * averageNumerator, averageDenominator) : normalizedDebt;
  const currentLeverage = closed || debtUsd === 0n
    ? 0
    : ratioToNumber(currentSize, currentSize - debtUsd);
  return {
    positionId: params.positionId,
    rawColls,
    rawDebts,
    currentLeverage: closed ? 0 : currentLeverage,
    lsdLeverage: closed ? (config.isShort ? -1 : 0) : config.isShort ? currentLeverage - 1 : currentLeverage,
    rawCollsToken: config.collSymbol,
    rawDebtsToken: config.debtSymbol,
    // SDK Position.getPositionInfo currently returns 18 for both fields,
    // including WBTC pools. Preserve that public SDK contract exactly.
    rawCollsDecimals: 18,
    rawDebtsDecimals: 18,
  };
}

/** Read the quote/rate context once per pool refresh, then reuse it per NFT. */
export async function readCanonicalPositionContext(params: {
  client: ReadClient;
  group: PositionGroup;
}): Promise<CanonicalPositionContext> {
  const config = configFor(params.group);
  const [rateResult, buyDestination, sellSource] = await Promise.all([
    params.group.market === 'ETH'
      ? params.client.readContract({ address: RATE_PROVIDER, abi: RATE_ABI, functionName: 'getRate' } as Parameters<ReadClient['readContract']>[0])
      : Promise.resolve(WAD),
    bestQuote(params.client, QUERY_AMOUNT, config.encodingIn, config.routesIn, params.group.market === 'BTC' ? BTC_V3_IN : undefined),
    bestQuote(params.client, config.sellAmount, config.encodingOut, config.routesOut, params.group.market === 'BTC' ? BTC_V3_OUT : undefined),
  ]);
  const rate = uint(rateResult, 'stETH rate');
  const buyDestinationAmount = uint(buyDestination, 'buy quote');
  const sellSourceAmount = uint(sellSource, 'sell quote');
  if (rate === 0n || buyDestinationAmount === 0n || sellSourceAmount === 0n) throw new Error('canonical position quote was empty');
  const buyNumerator = QUERY_AMOUNT * config.precision;
  const buyDenominator = buyDestinationAmount * rate;
  const sellNumerator = sellSourceAmount * config.precision;
  const sellDenominator = config.sellAmount * rate;
  return {
    rate,
    averageNumerator: buyNumerator * sellDenominator + sellNumerator * buyDenominator,
    averageDenominator: 2n * buyDenominator * sellDenominator,
  };
}
