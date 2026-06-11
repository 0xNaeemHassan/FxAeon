import { Router, Request, Response, NextFunction } from "express";
import { logger } from "../middleware/logger.js";
import { healthRouter } from "./health.js";
import { simulateRouter } from "./simulate-trade.js";
import { webhookRouter } from "./webhook.js";
import { limitOrdersRouter } from "./limit-orders.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/simulate", simulateRouter);
apiRouter.use("/webhook", webhookRouter);
apiRouter.use("/limit-orders", limitOrdersRouter);

// Global error handler for API routes
apiRouter.use((err: Error & { status?: number; code?: string }, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err }, "API error");
  res.status(err.status || 500).json({
    error: {
      message: err.message || "Internal server error",
      code: err.code || "INTERNAL_ERROR",
    },
  });
});
