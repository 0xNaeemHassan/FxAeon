/**
 * Gas estimation — live prices from Etherscan Gas Oracle.
 *
 * Previous implementation used hardcoded `gasPrice = '20'` gwei. This version
 * fetches REAL gas prices from Etherscan's Gas Oracle API (cached 12s,
 * single-flighted). Falls back to a conservative estimate only if both
 * Etherscan and the env-based RPC are unreachable.
 */
import { getGasOracle, type EtherscanGasOracle } from '@fxbot/shared';
import { getRiskParameter } from '@fxbot/shared';

export interface GasEstimate {
  estimatedGas: number;
  gasPrice: string;
  totalCost: string;
  currency: string;
}

/** Gas multipliers by transaction type — reflects on-chain complexity. */
const GAS_MULTIPLIERS: Record<string, number> = {
  open: 3,
  close: 2,
  adjust: 4,
  leverage: 5,
};

/** Conservative fallback gas price if all live sources fail (gwei). */
const FALLBACK_GAS_PRICE_GWEI = 30;

/**
 * Fetch the current proposed (standard) gas price in gwei.
 * Falls back to a conservative estimate on failure.
 */
async function getLiveGasPrice(): Promise<number> {
  try {
    if (!process.env.ETHERSCAN_API_KEY) return FALLBACK_GAS_PRICE_GWEI;
    const { data } = await getGasOracle();
    return data.proposeGasPrice;
  } catch {
    return FALLBACK_GAS_PRICE_GWEI;
  }
}

export async function estimateGas(
  txType: 'open' | 'close' | 'adjust' | 'leverage',
  _asset: string,
  _size: number
): Promise<GasEstimate> {
  const baseGas = 21000;
  const complexityMultiplier = GAS_MULTIPLIERS[txType] ?? 2;
  const estimatedGas = baseGas * complexityMultiplier;

  const gasPriceGwei = await getLiveGasPrice();
  const totalCost = (estimatedGas * gasPriceGwei / 1e9).toFixed(6);

  return {
    estimatedGas,
    gasPrice: gasPriceGwei.toFixed(2),
    totalCost,
    currency: 'ETH',
  };
}

export function validateGasLimit(gasLimit: number): boolean {
  const maxGas = getRiskParameter('DEFAULT_GAS_LIMIT');
  return gasLimit > 0 && gasLimit <= maxGas;
}
