/**
 * Admin API endpoints — operational controls for the FxAeon operator.
 *
 * All endpoints are guarded by `ADMIN_TOKEN` (Bearer auth). If the env var
 * is not set, every request returns 403.
 *
 * Endpoints:
 *   POST /api/v1/admin/rewebhook     — immediately re-register the Telegram webhook
 *   GET  /api/v1/admin/policy-mode   — read current signer-policy mode
 *   POST /api/v1/admin/policy-mode   — 405; restart-required by design
 *   GET  /api/v1/admin/stats         — current user / transaction counts
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@fxaeon/db";
import { logger } from "../middleware/logger.js";
import { resolvePolicyMode } from "../core/signerPolicy.js";

export const adminRouter = Router();

let rewebhook: (() => Promise<string>) | null = null;

/** Injected by main.ts after the Telegram bot and registration routine exist. */
export function configureAdminWebhook(action: () => Promise<string>): void {
  rewebhook = action;
}

// ── Auth guard ──────────────────────────────────────────────────────────
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    res.status(403).json({ error: "ADMIN_TOKEN not configured" });
    return;
  }
  const auth = req.headers.authorization;
  const supplied = Buffer.from(auth ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

adminRouter.use(requireAdmin);

// ── POST /rewebhook ─────────────────────────────────────────────────────
adminRouter.post("/rewebhook", async (_req: Request, res: Response) => {
  if (!rewebhook) {
    res.status(503).json({ error: "Webhook registration is unavailable in this process" });
    return;
  }
  try {
    const endpoint = await rewebhook();
    res.json({ ok: true, endpoint, message: "Telegram webhook re-registered" });
  } catch (e) {
    logger.error(e, "admin: rewebhook failed");
    res.status(500).json({ error: "Failed to clear webhook cache" });
  }
});

// ── GET/POST /policy-mode ───────────────────────────────────────────────
adminRouter.get("/policy-mode", async (_req: Request, res: Response) => {
  res.json({ mode: resolvePolicyMode(), mutable: false });
});

adminRouter.post("/policy-mode", async (_req: Request, res: Response) => {
  res.status(405).json({
    error: "Signer policy is security-critical and immutable at runtime. Set SIGNER_POLICY_MODE and restart the service.",
    mode: resolvePolicyMode(),
  });
});

// ── GET /stats ──────────────────────────────────────────────────────────
adminRouter.get("/stats", async (_req: Request, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeToday,
      txsToday,
      openPositions,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({
        where: { updatedAt: { gte: todayStart }, deletedAt: null },
      }),
      prisma.txRecord.count({
        where: { createdAt: { gte: todayStart } },
      }),
      prisma.position.count(),
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      users: { total: totalUsers, activeToday },
      today: { transactions: txsToday },
      openPositions,
    });
  } catch (e) {
    logger.error(e, "admin: stats failed");
    res.status(500).json({ error: "Failed to compute stats" });
  }
});
