/**
 * Non-authoritative, device-local preferences shared by protocol forms.
 * Nothing in this file is used as protocol state or wallet authorization.
 */
export const SETTINGS_KEY = 'fxaeon.settings.v1';
export const SETTINGS_UPDATED_EVENT = 'fxaeon:settings-updated';
export const DEFAULT_SLIPPAGE_PERCENT = 0.5;
export const GAS_TIERS = ['standard', 'fast', 'rapid'] as const;
export type GasTier = (typeof GAS_TIERS)[number];
export const DEFAULT_GAS_TIER: GasTier = 'standard';
const ALLOWED_SLIPPAGE_BPS = [10, 50, 100, 200] as const;

export function readGasTier(): GasTier {
  if (typeof window === 'undefined') return DEFAULT_GAS_TIER;
  try {
    const value = (JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') as { gasTier?: unknown }).gasTier;
    return GAS_TIERS.includes(value as GasTier) ? value as GasTier : DEFAULT_GAS_TIER;
  } catch {
    return DEFAULT_GAS_TIER;
  }
}

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

/** Notify already-open protocol surfaces that device preferences changed. */
export function announceSettingsUpdated(slippageBps: number, gasTier?: GasTier): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: { slippageBps, ...(gasTier ? { gasTier } : {}) } }));
}
