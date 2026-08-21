import { Router, Request, Response, NextFunction } from "express";
import { logger } from "../middleware/logger.js";
import { healthRouter } from "./health.js";
import { simulateRouter } from "./simulate-trade.js";
import { limitOrdersRouter } from "./limit-orders.js";
import { adminRouter } from "./admin.js";
import { errorCodes } from "../middleware/errors.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/simulate", simulateRouter);
apiRouter.use("/limit-orders", limitOrdersRouter);
apiRouter.use("/v1/admin", adminRouter);

// Global error handler for API routes
type ApiError = Error & { status?: number; code?: string };

/** Never reflect RPC, relay, database or SDK error text to an API caller. */
export function publicApiError(err: ApiError): { status: number; code: string; message: string } {
  const status = Number.isInteger(err.status) && err.status! >= 400 && err.status! <= 599
    ? err.status!
    : 500;
  const code = typeof err.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(err.code)
    ? err.code
    : "INTERNAL_ERROR";
  const known = errorCodes[code as keyof typeof errorCodes];
  return {
    status,
    code,
    // Validation messages are generated locally from schemas and retain useful
    // field-level feedback. All service/chain errors use fixed public copy.
    message: code === "VALIDATION_ERROR"
      ? err.message
      : known ?? errorCodes.INTERNAL_ERROR,
  };
}

apiRouter.use((err: ApiError, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err }, "API error");
  const safe = publicApiError(err);
  res.status(safe.status).json({
    error: {
      message: safe.message,
      code: safe.code,
    },
  });
});
