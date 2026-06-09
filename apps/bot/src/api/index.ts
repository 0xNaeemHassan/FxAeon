import { Router } from "express";
import { asyncHandler } from "../middleware";
import { healthRouter } from "./health";
import { simulateRouter } from "./simulate-trade";
import { webhookRouter } from "./webhook";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/simulate", simulateRouter);
apiRouter.use("/webhook", webhookRouter);

// Global error handler for API routes
apiRouter.use((err: unknown, req: unknown, res: unknown, next: unknown) => {
  console.error("API Error:", err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || "Internal server error",
      code: err.code || "INTERNAL_ERROR",
    },
  });
});
