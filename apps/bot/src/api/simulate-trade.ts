import { Router } from "express";
import { createPublicClient, http, parseEther, parseUnits } from "viem";
import { mainnet } from "viem/chains";
import { ADDRESSES, RISK_PARAMS } from "@fxbot/shared";
import { SimulationError, ValidationError } from "../middleware/errors";

export const simulateRouter = Router();

simulateRouter.post("/trade", async (req, res) => {
  const { address, market, side, leverage, amount, slippageBps } = req.body;
  
  // Validation
  if (!address || !market || !side || !leverage || !amount) {
    throw new ValidationError("Missing required parameters");
  }
  
  const lev = parseFloat(leverage);
  const maxLev = side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
  if (lev < RISK_PARAMS.MIN_LEVERAGE || lev > maxLev) {
    throw new ValidationError(`Leverage must be between ${RISK_PARAMS.MIN_LEVERAGE}x and ${maxLev}x`);
  }
  
  // Create public client
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(process.env.ALCHEMY_RPC_URL),
  });
  
  try {
    // Simulate the trade via fx-sdk Router
    // In production, this would call the actual fx-sdk simulate async function
    const gasEstimate = 250000 + Math.floor(Math.random() * 50000);
    const gasPrice = await publicClient.getGasPrice();
    const estimatedGasCost = (gasEstimate * Number(gasPrice)) / 1e18;
    
    // Calculate position details
    const collateralAmount = parseEther(amount);
    const notionalValue = collateralAmount * BigInt(Math.floor(lev * 100)) / BigInt(100);
    
    // Calculate fees
    const openFeeRate = market === "wstETH" ? RISK_PARAMS.OPEN_RATIO_BASE_WSTETH : RISK_PARAMS.OPEN_RATIO_BASE_WBTC;
    const openFee = Number(notionalValue) * openFeeRate / 1e18;
    
    // Slippage check
    const slippagePercent = (slippageBps || RISK_PARAMS.SLIPPAGE_DEFAULT_BPS) / 100;
    
    res.json({
      success: true,
      simulation: {
        address,
        market,
        side,
        leverage: lev,
        collateral: amount,
        notionalValue: (Number(notionalValue) / 1e18).toFixed(4),
        openFee: openFee.toFixed(6),
        gasEstimate,
        estimatedGasCost: estimatedGasCost.toFixed(8),
        gasPrice: gasPrice.toString(),
        slippageTolerance: `${slippagePercent}%`,
        totalCost: (openFee + estimatedGasCost).toFixed(6),
      },
      warnings: lev > 5 ? ["High leverage increases liquidation risk"] : [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SimulationError(message, { address, market, side, leverage });
  }
});

simulateRouter.post("/limit", async (req, res) => {
  const { address, market, side, action, triggerPrice } = req.body;
  
  // Validate limit order parameters
  const currentPrice = 3000; // Would fetch from oracle
  const isTP = (side === "long" && triggerPrice > currentPrice) || (side === "short" && triggerPrice < currentPrice);
  
  res.json({
    success: true,
    simulation: {
      address,
      market,
      side,
      action,
      triggerPrice,
      currentPrice,
      type: isTP ? "take-profit" : "stop-loss",
      estimatedFillTime: isTP ? "When price reaches target" : "Immediate if condition met",
      gasEstimate: 180000,
    },
  });
});
