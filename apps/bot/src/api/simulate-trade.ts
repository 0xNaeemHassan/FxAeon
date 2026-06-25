import { Router } from "express";
import { z } from "zod";
import { isAddress, formatEther } from "viem";
import { RISK_PARAMS, MARKETS } from "@fxaeon/shared";
import { ValidationError, SimulationError, asyncHandler } from "../middleware/errors.js";
import {
  createFxSdk,
  createPublicClientForUser,
  quoteOpenPosition,
  simulateRoute,
  collateralDecimals,
} from "../fx/index.js";

export const simulateRouter = Router();

const tradeSchema = z.object({
  address: z.string().refine(isAddress, "invalid address"),
  market: z.enum(MARKETS),
  side: z.enum(["long", "short"]),
  leverage: z.coerce.number().min(RISK_PARAMS.MIN_LEVERAGE),
  /** Collateral amount in wei units of the input token, as a decimal string. */
  amountWei: z.string().regex(/^[0-9]+$/, "amountWei must be an integer wei string"),
  slippageBps: z.coerce.number().int().min(1).max(1000).optional(),
});

simulateRouter.post("/trade", asyncHandler(async (req, res) => {
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const { address, market, side, leverage, amountWei, slippageBps } = parsed.data;

  const maxLev = side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
  if (leverage > maxLev) {
    throw new ValidationError(`Leverage must be between ${RISK_PARAMS.MIN_LEVERAGE}x and ${maxLev}x`);
  }

  try {
    const sdk = createFxSdk();
    const client = createPublicClientForUser("off");

    // Real route quote from the f(x) SDK (Odos / Velora / FxRoute).
    const quote = await quoteOpenPosition({
      sdk,
      userAddress: address,
      market,
      side,
      leverage,
      amountWei: BigInt(amountWei),
      slippagePercent: (slippageBps ?? RISK_PARAMS.SLIPPAGE_DEFAULT_BPS) / 100,
    });
    const route = quote.routes[0];
    if (!route) throw new SimulationError("no route available", { market, side, leverage });

    // Real chained simulation (eth_simulateV1): approve -> Router.
    const sim = await simulateRoute(client, address, route.txs);
    const [gasPrice, feeHistory] = await Promise.all([
      client.getGasPrice(),
      client.getFeeHistory({ blockCount: 5, rewardPercentiles: [50] }).catch(() => null),
    ]);
    const totalGas = sim.success ? sim.totalGas : 0n;
    const estimatedGasCostWei = totalGas * gasPrice;

    res.json({
      success: sim.success,
      simulation: {
        address,
        market,
        side,
        leverage,
        collateralWei: amountWei,
        collateralDecimals: collateralDecimals(market),
        route: route.routeType,
        executionPrice: route.executionPrice,
        expectedColls: route.colls,
        expectedDebts: route.debts,
        slippage: quote.slippage,
        txCount: route.txs.length,
        ...(sim.success
          ? {
              gasUsed: sim.gasUsed.map(String),
              totalGas: totalGas.toString(),
              gasPriceWei: gasPrice.toString(),
              baseFeeWei: feeHistory?.baseFeePerGas?.at(-1)?.toString(),
              estimatedGasCostEth: formatEther(estimatedGasCostWei),
            }
          : { error: sim.error, failedTxIndex: sim.failedTxIndex }),
      },
      warnings: leverage > 5 ? ["High leverage increases liquidation risk"] : [],
    });
  } catch (error: unknown) {
    if (error instanceof SimulationError || error instanceof ValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SimulationError(message, { address, market, side, leverage });
  }
}));

// Limit orders moved to the real rail: /api/limit-orders/{prepare,submit,status,cancel-tx} (W-09).
simulateRouter.post("/limit", (_req, res) => {
  res.status(410).json({
    success: false,
    error: "Moved: use /api/limit-orders/prepare and /api/limit-orders/submit.",
  });
});
