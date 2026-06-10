import { z } from 'zod';
import { getRiskParameter, validateLeverage, validatePositionSize, validateSlippage } from '@fxbot/shared';

export const positionSchema = z.object({
  asset: z.enum(['xETH', 'xUSD']),
  size: z.number().positive().refine(validatePositionSize, {
    message: 'Position size out of allowed range',
  }),
  leverage: z.number().positive().refine((val) => validateLeverage('xETH', val) || validateLeverage('xUSD', val), {
    message: 'Leverage exceeds maximum allowed',
  }),
  side: z.enum(['long', 'short']),
  slippageBps: z.number().optional().refine((val) => val === undefined || validateSlippage(val), {
    message: 'Slippage exceeds maximum allowed',
  }),
});

export const twapSchema = z.object({
  asset: z.enum(['xETH', 'xUSD']),
  totalSize: z.number().positive(),
  intervals: z.number().int().min(2).max(24),
  intervalMinutes: z.number().int().min(5),
  side: z.enum(['buy', 'sell']),
});

export const batchSchema = z.object({
  transactions: z.array(z.object({
    type: z.enum(['open', 'close', 'adjust']),
    asset: z.enum(['xETH', 'xUSD']),
    params: z.record(z.string(), z.any()),
  })).min(1).max(10),
});

export function validateAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function validateAmount(amount: string): boolean {
  try {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0;
  } catch {
    return false;
  }
}
