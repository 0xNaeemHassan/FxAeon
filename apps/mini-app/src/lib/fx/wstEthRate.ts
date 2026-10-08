/**
 * The live wstETH rate: stETH per wstETH, as `wstETH.stEthPerToken()` reports
 * it, in 1e18 fixed point. f(x)'s wstETH long pool accounts collateral in
 * stETH because its PoolManager scales wstETH by a rate provider that returns
 * this same rate, so a quote figure that is natively wstETH converts with it.
 * Nothing here ever assumes 1:1: an unusable read is no rate at all.
 */
export const WSTETH_RATE_PRECISION = 10n ** 18n;

/**
 * Beyond any rate wstETH has had or will plausibly reach: it started above 1
 * and grows a few percent a year. Outside these bounds a read is not a rate.
 */
const MIN_EXCLUSIVE_RATE = WSTETH_RATE_PRECISION;
const MAX_EXCLUSIVE_RATE = 10n * WSTETH_RATE_PRECISION;

/** A read (bigint) or stored (decimal digits) rate, or undefined when it is not a usable rate. */
export function parseStEthPerWstEth(value: unknown): bigint | undefined {
  let rate: bigint;
  if (typeof value === 'bigint') rate = value;
  else if (typeof value === 'string' && /^\d{1,40}$/.test(value)) rate = BigInt(value);
  else return undefined;
  return rate > MIN_EXCLUSIVE_RATE && rate < MAX_EXCLUSIVE_RATE ? rate : undefined;
}

/**
 * wstETH in stETH at the rate, rounded down: the pool's own scaling also
 * rounds down, and an estimate of collateral or a minimum must not overstate it.
 */
export function stEthForWstEth(wstEth: bigint, rate: bigint): bigint {
  return (wstEth * rate) / WSTETH_RATE_PRECISION;
}
