import type { DebtRatioRange } from "./leverage";

const WAD = 10n ** 18n;
const BPS = 10_000n;
const CENT_TO_WAD = 10n ** 16n;

/**
 * The SDK plans inside a 100 bps window of the pool's debt-ratio range, and the
 * form values collateral at display prices rather than the pool oracle; reserve
 * another 100 bps for that. The limits guide the form; the SDK simulation
 * against the pool remains the authority before anything is signed.
 */
export const BORROW_LIMIT_GUARD_BPS = 200n;

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}

/**
 * fxUSD debt bounds (18 decimals) for a long position whose collateral is worth
 * `collateralUsdCents`. fxUSD is the pool's debt unit, valued at one dollar.
 */
export function borrowDebtBounds(collateralUsdCents: bigint, range: DebtRatioRange): { minDebt: bigint; maxDebt: bigint } {
  if (collateralUsdCents <= 0n || range.max <= range.min) return { minDebt: 0n, maxDebt: 0n };
  const collateral = collateralUsdCents * CENT_TO_WAD;
  return {
    minDebt: ceilDiv(collateral * range.min * (BPS + BORROW_LIMIT_GUARD_BPS), WAD * BPS),
    maxDebt: collateral * range.max * (BPS - BORROW_LIMIT_GUARD_BPS) / (WAD * BPS),
  };
}

/** How much more fxUSD a position can borrow, and the least a new loan must be. */
export function borrowCapacity({ collateralUsdCents, existingDebt, range }: {
  collateralUsdCents: bigint;
  existingDebt: bigint;
  range: DebtRatioRange;
}): { maxAdditional: bigint; minAdditional: bigint } {
  const { minDebt, maxDebt } = borrowDebtBounds(collateralUsdCents, range);
  return {
    maxAdditional: maxDebt > existingDebt ? maxDebt - existingDebt : 0n,
    minAdditional: minDebt > existingDebt ? minDebt - existingDebt : 0n,
  };
}

/** Collateral value (USD cents) that can leave while `remainingDebt` stays inside the range. */
export function withdrawableCollateralUsdCents(collateralUsdCents: bigint, remainingDebt: bigint, range: DebtRatioRange): bigint {
  if (collateralUsdCents <= 0n) return 0n;
  if (remainingDebt <= 0n) return collateralUsdCents;
  if (range.max <= 0n) return 0n;
  const neededWad = ceilDiv(remainingDebt * WAD * BPS, range.max * (BPS - BORROW_LIMIT_GUARD_BPS));
  const neededCents = ceilDiv(neededWad, CENT_TO_WAD);
  return collateralUsdCents > neededCents ? collateralUsdCents - neededCents : 0n;
}

/** Debt as a share of collateral value, in basis points; null when there is no collateral. */
export function loanToValueBps(debt: bigint, collateralUsdCents: bigint): bigint | null {
  if (collateralUsdCents <= 0n) return null;
  return debt * BPS / (collateralUsdCents * CENT_TO_WAD);
}
