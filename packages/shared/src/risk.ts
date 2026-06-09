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
