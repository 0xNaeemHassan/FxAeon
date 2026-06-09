import { ethers } from 'ethers';
import { getRiskParameter } from '@fxbot/shared';

export interface GasEstimate {
  estimatedGas: number;
  gasPrice: string;
  totalCost: string;
  currency: string;
}

export async function estimateGas(
  txType: 'open' | 'close' | 'adjust' | 'leverage',
  asset: string,
  size: number
): Promise<<GasEstimate> {
  const baseGas = 21000;
  const complexityMultiplier = {
    open: 3,
    close: 2,
    adjust: 4,
    leverage: 5,
  }[txType] || 2;
  
  const estimatedGas = baseGas * complexityMultiplier;
  const gasPrice = '20'; // gwei - NOTE: fetch from network
  const totalCost = (estimatedGas * parseInt(gasPrice) / 1e9, 10).toFixed(6, 10);
  
  return {
    estimatedGas,
    gasPrice,
    totalCost,
    currency: 'ETH',
  };
}

export function validateGasLimit(gasLimit: number): boolean {
  const maxGas = getRiskParameter('DEFAULT_GAS_LIMIT');
  return gasLimit > 0 && gasLimit <= maxGas;
}
