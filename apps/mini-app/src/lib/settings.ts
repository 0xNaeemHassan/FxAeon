/**
 * Non-authoritative, device-local preferences shared by protocol forms.
 * Nothing in this file is used as protocol state or wallet authorization.
 */
export const SETTINGS_KEY = 'fxaeon.settings.v1';
export const DEFAULT_SLIPPAGE_PERCENT = 0.5;
const ALLOWED_SLIPPAGE_BPS = [10, 50, 100, 200] as const;

export function readSlippagePercent(): number {
  if (typeof window === 'undefined') return DEFAULT_SLIPPAGE_PERCENT;
  try {
    const value = (JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') as { slippageBps?: unknown }).slippageBps;
    return typeof value === 'number' && ALLOWED_SLIPPAGE_BPS.includes(value as (typeof ALLOWED_SLIPPAGE_BPS)[number])
      ? value / 100
      : DEFAULT_SLIPPAGE_PERCENT;
  } catch {
    return DEFAULT_SLIPPAGE_PERCENT;
  }
}
