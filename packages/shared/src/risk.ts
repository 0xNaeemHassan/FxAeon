/**
 * Risk Parameters - LOCKED
 * These parameters are immutable and must match the f(x) Protocol specification exactly.
 */

export const RISK_PARAMETERS = {
  // Debt ratio bounds
  DEBT_RATIO_LOWER: 0.0909,
  DEBT_RATIO_UPPER: 0.8666,

  // Thresholds
  REBALANCE_THRESHOLD: 0.88,
  LIQUIDATION_THRESHOLD: 0.95,

  // Bonuses
  REBALANCE_BONUS: 0.025,
  LIQUIDATE_BONUS: 0.04,

  // Fee ratios (as decimals: 0.001 = 0.1%)
  OPEN_RATIO_BASE_WSTETH: 0.001,
  OPEN_RATIO_BASE_WBTC: 0.003,
  OPEN_RATIO_STEP: 0.003,
  CLOSE_FEE: 0.001,

  // Leverage limits
  MAX_LEVERAGE_LONG: 7,
  MAX_LEVERAGE_SHORT: 3,
  MIN_LEVERAGE: 1.1,

  // Slippage defaults
  DEFAULT_SLIPPAGE_BPS: 50,  // 0.5%
  MAX_SLIPPAGE_BPS: 200,     // 2%

  // Position limits
  MIN_POSITION_SIZE_ETH: 0.01,
  MAX_POSITION_SIZE_ETH: 1000,

  // Gas limits
  DEFAULT_GAS_LIMIT: 500000,
  MAX_GAS_LIMIT: 2000000,

  // TWAP defaults
  TWAP_DEFAULT_INTERVALS: 4,
  TWAP_MIN_INTERVAL_MINUTES: 5,
  TWAP_MAX_INTERVAL_MINUTES: 1440,  // 24 hours

  // Trailing stop defaults
  TRAILING_STOP_DEFAULT_DISTANCE: 5,  // 5%
  TRAILING_STOP_MIN_DISTANCE: 1,
  TRAILING_STOP_MAX_DISTANCE: 20,
} as const;

/**
 * RISK_PARAMS — convenience alias with field names used by the bot.
 * Maps semantic names to the canonical RISK_PARAMETERS values.
 */
export const RISK_PARAMS = {
  // Debt ratio bounds
  DEBT_RATIO_LOWER: RISK_PARAMETERS.DEBT_RATIO_LOWER,
  DEBT_RATIO_UPPER: RISK_PARAMETERS.DEBT_RATIO_UPPER,

  // Thresholds
  REBALANCE_THRESHOLD: RISK_PARAMETERS.REBALANCE_THRESHOLD,
  LIQUIDATION_THRESHOLD: RISK_PARAMETERS.LIQUIDATION_THRESHOLD,

  // Bonuses
  REBALANCE_BONUS: RISK_PARAMETERS.REBALANCE_BONUS,
  LIQUIDATE_BONUS: RISK_PARAMETERS.LIQUIDATE_BONUS,

  // Fees
  OPEN_RATIO_BASE_WSTETH: RISK_PARAMETERS.OPEN_RATIO_BASE_WSTETH,
  OPEN_RATIO_BASE_WBTC: RISK_PARAMETERS.OPEN_RATIO_BASE_WBTC,
  OPEN_RATIO_STEP: RISK_PARAMETERS.OPEN_RATIO_STEP,
  CLOSE_FEE: RISK_PARAMETERS.CLOSE_FEE,

  // Leverage
  MAX_LEVERAGE_LONG: RISK_PARAMETERS.MAX_LEVERAGE_LONG,
  MAX_LEVERAGE_SHORT: RISK_PARAMETERS.MAX_LEVERAGE_SHORT,
  MIN_LEVERAGE: RISK_PARAMETERS.MIN_LEVERAGE,

  // Slippage
  SLIPPAGE_DEFAULT_BPS: RISK_PARAMETERS.DEFAULT_SLIPPAGE_BPS,
  SLIPPAGE_MAX_BPS: RISK_PARAMETERS.MAX_SLIPPAGE_BPS,
} as const;

/**
 * Health-level thresholds (ratio 0–1).
 * These represent the output of computeHealthPercent.
 * SAFE < WARNING < URGENT < liquidation (1.0)
 */
export const HEALTH_LEVELS = {
  SAFE: 0.70,
  WARNING: 0.85,
  URGENT: 0.95,
} as const;

/**
 * Compute health percent as a ratio (0–1+).
 * health = debtRatio / liquidationThreshold
 *
 * At debtRatio == LIQUIDATION_THRESHOLD (0.95), health == 1.0 (liquidation).
 * Values > 1.0 mean the position is past liquidation threshold.
 */
export function computeHealthPercent(debtRatio: number): number {
  return debtRatio / RISK_PARAMETERS.LIQUIDATION_THRESHOLD;
}

/**
 * Compute the price at which a position would be liquidated.
 *
 * For long: liquidation when price drops → price = (debt/collateral) / threshold
 * For short: liquidation when price rises → price = (debt/collateral) * threshold
 *
 * @param collateral - collateral amount (BigInt, 18 decimals, in ETH terms)
 * @param debt - debt value (BigInt, 15 decimals, in fxUSD/price terms)
 * @param side - "long" or "short"
 * @returns liquidation price as a number, or 0 if collateral is zero
 */
export function computeLiquidationPrice(
  collateral: bigint,
  debt: bigint,
  side: "long" | "short"
): number {
  if (collateral === 0n) return 0;

  // Collateral uses 18 decimal places (wei), debt uses 15 decimal places (price precision)
  const collateralNum = Number(collateral) / 1e18;
  const debtNum = Number(debt) / 1e15;

  if (collateralNum === 0) return 0;

  const ratio = debtNum / collateralNum;
  const threshold = RISK_PARAMETERS.LIQUIDATION_THRESHOLD;

  if (side === "long") {
    // Long gets liquidated when price drops below this
    return ratio / threshold;
  } else {
    // Short gets liquidated when price rises above this
    return ratio * threshold;
  }
}

export type RiskParameter = keyof typeof RISK_PARAMETERS;

export function getRiskParameter(name: RiskParameter): number {
  return RISK_PARAMETERS[name];
}

export function getAllRiskParameters(): Record<string, number> {
  return { ...RISK_PARAMETERS };
}

export function validateLeverage(asset: 'xETH' | 'xUSD', leverage: number): boolean {
  const max = asset === 'xETH' ? RISK_PARAMETERS.MAX_LEVERAGE_LONG : RISK_PARAMETERS.MAX_LEVERAGE_SHORT;
  return leverage >= RISK_PARAMETERS.MIN_LEVERAGE && leverage <= max;
}

export function validatePositionSize(size: number): boolean {
  return size >= RISK_PARAMETERS.MIN_POSITION_SIZE_ETH && size <= RISK_PARAMETERS.MAX_POSITION_SIZE_ETH;
}

export function validateSlippage(slippageBps: number): boolean {
  return slippageBps > 0 && slippageBps <= RISK_PARAMETERS.MAX_SLIPPAGE_BPS;
}
