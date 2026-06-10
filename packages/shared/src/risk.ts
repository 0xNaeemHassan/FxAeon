/**
 * Risk Parameters - LOCKED
 * These parameters are immutable and must match the specification exactly.
 */

export const RISK_PARAMETERS = {
  // Maximum leverage ratios
  MAX_LEVERAGE_XETH: 31,
  MAX_LEVERAGE_XUSD: 10,
  
  // Liquidation threshold (LTV %)
  LIQUIDATION_THRESHOLD: 80,
  
  // Cooldown period between large trades (minutes)
  COOLDOWN_PERIOD_MINUTES: 60,
  
  // Slippage defaults
  DEFAULT_SLIPPAGE_BPS: 50,  // 0.5%
  MAX_SLIPPAGE_BPS: 500,     // 5%
  
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
  MAX_LEVERAGE_LONG: RISK_PARAMETERS.MAX_LEVERAGE_XETH,        // 31x
  MAX_LEVERAGE_SHORT: RISK_PARAMETERS.MAX_LEVERAGE_XUSD,       // 10x
  MIN_LEVERAGE: 1,
  LIQUIDATION_THRESHOLD: RISK_PARAMETERS.LIQUIDATION_THRESHOLD,
  SLIPPAGE_DEFAULT_BPS: RISK_PARAMETERS.DEFAULT_SLIPPAGE_BPS,  // 50 = 0.5%
  SLIPPAGE_MAX_BPS: RISK_PARAMETERS.MAX_SLIPPAGE_BPS,          // 500 = 5%
  OPEN_RATIO_BASE_WSTETH: 30,   // basis-point fee for opening wstETH positions
  OPEN_RATIO_BASE_WBTC: 30,     // basis-point fee for opening WBTC positions
} as const;

/**
 * Health-level thresholds (percent).
 * health < URGENT  → position at high liquidation risk
 * health < WARNING → position needs attention
 */
export const HEALTH_LEVELS = {
  URGENT: 85,
  WARNING: 95,
} as const;

/**
 * Convert a debt ratio (0–1 range) to a health percentage (0–100).
 * health = 100 × (1 − debtRatio / liquidationThreshold)
 * At debtRatio == 0.8 (liquidation), health == 0.
 */
export function computeHealthPercent(debtRatio: number): number {
  const threshold = RISK_PARAMETERS.LIQUIDATION_THRESHOLD / 100; // 0.8
  const health = 100 * (1 - debtRatio / threshold);
  return Math.max(0, Math.min(100, health));
}

export type RiskParameter = keyof typeof RISK_PARAMETERS;

export function getRiskParameter(name: RiskParameter): number {
  return RISK_PARAMETERS[name];
}

export function getAllRiskParameters(): Record<string, number> {
  return { ...RISK_PARAMETERS };
}

export function validateLeverage(asset: 'xETH' | 'xUSD', leverage: number): boolean {
  const max = asset === 'xETH' ? RISK_PARAMETERS.MAX_LEVERAGE_XETH : RISK_PARAMETERS.MAX_LEVERAGE_XUSD;
  return leverage > 0 && leverage <= max;
}

export function validatePositionSize(size: number): boolean {
  return size >= RISK_PARAMETERS.MIN_POSITION_SIZE_ETH && size <= RISK_PARAMETERS.MAX_POSITION_SIZE_ETH;
}

export function validateSlippage(slippageBps: number): boolean {
  return slippageBps > 0 && slippageBps <= RISK_PARAMETERS.MAX_SLIPPAGE_BPS;
}
