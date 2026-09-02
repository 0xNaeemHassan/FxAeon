import { formatUnits } from 'viem';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from './policy';
import { FX_TOKENS, type FxTokenDefinition } from './tokens';
import type { OfficialFxMethod, PlannedRoute, ReviewedActionIntent } from './types';

export type ReviewFact = { label: string; value: string; title?: string };
type Unit = { symbol: string; decimals: number };
type Pool = { market: 'ETH' | 'BTC'; side: 'long' | 'short' };

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const tokenUnit = (token: FxTokenDefinition): Unit => ({ symbol: token.key, decimals: token.decimals });

function unitForAddress(address: string): Unit | undefined {
  const token = Object.values(FX_TOKENS).find((candidate) => sameAddress(address, candidate.address));
  return token && tokenUnit(token);
}

function knownPool(intent: ReviewedActionIntent): Pool | undefined {
  if (!('poolAddress' in intent)) return undefined;
  for (const market of ['ETH', 'BTC'] as const) {
    for (const side of ['long', 'short'] as const) {
      if (!sameAddress(intent.poolAddress, positionPoolAddress(market, side))) continue;
      if ('positionType' in intent && intent.positionType !== side) return undefined;
      if (!('positionType' in intent) && side !== 'long') return undefined;
      if ('collateralTokenAddress' in intent && !sameAddress(intent.collateralTokenAddress, positionCollateralTokenAddress(market, side))) return undefined;
      if ('debtTokenAddress' in intent && !sameAddress(intent.debtTokenAddress, positionDebtTokenAddress(market, side))) return undefined;
      return { market, side };
    }
  }
  return undefined;
}

/** Decimal-string formatting avoids losing precision through Number. */
function compactDecimal(value: string, places: number): string {
  const [whole, fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const shown = fraction.slice(0, places).replace(/0+$/, '');
  const truncated = /[1-9]/.test(fraction.slice(places));
  if (truncated && integer === '0' && !shown) return `<0.${'0'.repeat(places - 1)}1`;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${truncated ? '≈ ' : ''}${grouped}${shown ? `.${shown}` : ''}`;
}

function amountFact(label: string, raw: string | undefined, unit: Unit | undefined): ReviewFact | undefined {
  if (raw === undefined || !unit || !/^\d+$/.test(raw)) return undefined;
  const exact = formatUnits(BigInt(raw), unit.decimals);
  return {
    label,
    value: `${compactDecimal(exact, Math.min(unit.decimals, 8))} ${unit.symbol}`,
    title: `${exact} ${unit.symbol}`,
  };
}

function quoteUnits(intent: ReviewedActionIntent, pool: Pool): { collateral?: Unit; debt: Unit } {
  // Pinned fx-sdk 1.0.5 quote/accounting amounts are WAD (18 decimals),
  // including WBTC. Converter minimums below use ERC-20 decimals instead.
  const derivative = pool.market === 'ETH' ? 'wstETH' : 'WBTC';
  if (pool.side === 'short') return { collateral: { symbol: 'fxUSD', decimals: 18 }, debt: { symbol: derivative, decimals: 18 } };
  const debt = { symbol: 'fxUSD', decimals: 18 };
  if (pool.market === 'BTC') return { collateral: { symbol: 'WBTC', decimals: 18 }, debt };

  // The ETH long opening quote normalizes delta wstETH; reduce/borrow quotes
  // use stETH accounting. Existing increases add unlike units in this SDK,
  // and adjustments may choose either branch. Do not invent a conversion.
  if (intent.kind === 'position-increase') {
    return { collateral: intent.positionId === 0 ? { symbol: 'wstETH', decimals: 18 } : undefined, debt };
  }
  if (intent.kind === 'position-adjust') return { debt };
  return { collateral: { symbol: 'stETH', decimals: 18 }, debt };
}

function limitUnit(label: string, intent: ReviewedActionIntent, pool: Pool | undefined): { label: string; unit: Unit | undefined } | undefined {
  switch (label) {
    case 'position input conversion minimum output':
      if (pool && (intent.kind === 'position-increase' || intent.kind === 'position-adjust')) {
        return { label: 'Minimum converted input', unit: unitForAddress(intent.collateralTokenAddress) };
      }
      break;
    case 'position output conversion minimum output':
      if (pool && (intent.kind === 'position-reduce' || intent.kind === 'position-adjust')) {
        return { label: 'Minimum received', unit: unitForAddress(intent.kind === 'position-reduce' ? intent.outputTokenAddress : intent.collateralTokenAddress) };
      }
      break;
    case 'deposit conversion minimum output':
      if (pool && intent.kind === 'deposit-and-mint') return { label: 'Minimum converted deposit', unit: unitForAddress(positionCollateralTokenAddress(pool.market, 'long')) };
      break;
    case 'repay conversion minimum output':
      if (pool && intent.kind === 'repay-and-withdraw') return { label: 'Minimum debt repaid', unit: tokenUnit(FX_TOKENS.fxUSD) };
      break;
    case 'withdraw output conversion minimum output':
      if (pool && intent.kind === 'repay-and-withdraw') return { label: 'Minimum received', unit: unitForAddress(intent.withdrawTokenAddress) };
      break;
    case 'fxSAVE minimum shares':
      if (intent.kind === 'fxsave-deposit' && !intent.directBasePool) return { label: 'Minimum shares', unit: tokenUnit(FX_TOKENS.fxSAVE) };
      break;
    case 'fxSAVE deposit conversion minimum output':
      if (intent.kind === 'fxsave-deposit' && !intent.directBasePool) {
        // The supported USDC/fxUSD inputs use identity conversion. Do not
        // infer converter output units for an unrecognized input route.
        const input = [FX_TOKENS.USDC, FX_TOKENS.fxUSD].find((token) => sameAddress(token.address, intent.tokenInAddress));
        if (input) return { label: 'Minimum converted deposit', unit: tokenUnit(input) };
      }
      break;
    case 'fxUSD instant output minimum output':
    case 'USDC instant output minimum output':
      if (intent.kind === 'fxsave-withdraw' && intent.instant && !intent.directBasePool) {
        return { label: `Minimum received (${label.startsWith('fxUSD') ? 'fxUSD' : 'USDC'} leg)`, unit: unitForAddress(intent.tokenOutAddress) };
      }
      break;
  }
  return undefined;
}

const INTENT_OPERATION = {
  'position-increase': 'increasePosition',
  'position-reduce': 'reducePosition',
  'position-adjust': 'adjustPositionLeverage',
  'deposit-and-mint': 'depositAndMint',
  'repay-and-withdraw': 'repayAndWithdraw',
  'fxsave-deposit': 'depositFxSave',
  'fxsave-withdraw': 'withdrawFxSave',
  'fxsave-claim': 'getRedeemTx',
} as const satisfies Record<ReviewedActionIntent['kind'], OfficialFxMethod>;

/** Only interpret quote fields whose units are known for the reviewed action. */
export function routeFinancialReviewFacts(route: PlannedRoute): ReviewFact[] {
  const facts: ReviewFact[] = [];
  const intent = route.policy?.reviewedAction;
  if (!intent || route.chainId !== 1 || route.operation !== INTENT_OPERATION[intent.kind]) return facts;
  const details = route.details;
  const pool = knownPool(intent);
  const add = (fact: ReviewFact | undefined) => { if (fact) facts.push(fact); };

  if (pool) {
    const price = details?.executionPrice;
    if ('positionType' in intent && price && /^\d+(?:\.\d+)?$/.test(price) && /[1-9]/.test(price)) {
      // curPrice is already a decimal fxUSD/underlying ratio, not wei and
      // not an external USD price. ETH quotes divide out the wstETH rate.
      const pair = `fxUSD / ${pool.market === 'ETH' ? 'stETH' : 'WBTC'}`;
      add({ label: 'Execution price', value: `${compactDecimal(price, 4)} ${pair}`, title: `${price} ${pair}` });
    }
    // Borrow/repay expose an oracle price under the same SDK field name,
    // not a swap execution price. Keep that value in advanced details.
    const units = quoteUnits(intent, pool);
    add(amountFact('Estimated collateral', details?.colls, units.collateral));
    add(amountFact('Estimated debt', details?.debts, units.debt));
  }

  let unsupportedLimits = 0;
  for (const limit of details?.economicLimits ?? []) {
    const known = limitUnit(limit.label, intent, pool);
    const fact = known && amountFact(known.label, limit.value, known.unit);
    if (fact) add(fact);
    else unsupportedLimits += 1;
  }
  if (pool && intent.kind === 'position-reduce') {
    const minimum = amountFact('Minimum received', details?.minOut, unitForAddress(intent.outputTokenAddress));
    const boundMinimum = facts.find((fact) => fact.label === 'Minimum received');
    if (minimum && (!boundMinimum || boundMinimum.title !== minimum.title)) {
      add({ ...minimum, label: boundMinimum ? 'Quoted minimum received' : minimum.label });
    }
  }
  if (unsupportedLimits) add({ label: 'Additional limits', value: 'See advanced details' });
  return facts;
}

/** Exact source values remain inspectable even when units are unsupported. */
export function rawQuoteReviewFacts(route: PlannedRoute): ReviewFact[] {
  const fields = [
    ['executionPrice', 'Execution price (unrounded)'],
    ['minOut', 'Minimum output quote (raw units)'],
    ['colls', 'Collateral quote (raw units)'],
    ['debts', 'Debt quote (raw units)'],
  ] as const;
  return fields.flatMap(([key, label]) => {
    const value = route.details?.[key];
    return value === undefined ? [] : [{ label, value }];
  });
}
