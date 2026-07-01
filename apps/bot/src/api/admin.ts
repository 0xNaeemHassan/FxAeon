/**
 * Admin API endpoints — operational controls for the FxAeon operator.
 *
 * All endpoints are guarded by `ADMIN_TOKEN` (Bearer auth). If the env var
 * is not set, every request returns 403.
 *
 * Endpoints:
 *   POST /api/v1/admin/rewebhook     — force re-register the Telegram webhook
 *   GET  /api/v1/admin/policy-mode   — read current signer-policy mode
 *   POST /api/v1/admin/policy-mode   — hot-toggle signer-policy mode
 *   GET  /api/v1/admin/fee-mode      — read current fee mode
 *   POST /api/v1/admin/fee-mode      — hot-toggle fee mode
 *   GET  /api/v1/admin/stats         — today's volume / fees / error rates
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "@fxaeon/db";
import {
  getBotState,
  setBotState,
  BS_FEE_MODE,
  BS_POLICY_MODE,
} from "../core/botState.js";
import { logger } from "../middleware/logger.js";

export const adminRouter = Router();

// ── Auth guard ──────────────────────────────────────────────────────────
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    res.status(403).json({ error: "ADMIN_TOKEN not configured" });
    return;
  }
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

adminRouter.use(requireAdmin);

// ── POST /rewebhook ─────────────────────────────────────────────────────
adminRouter.post("/rewebhook", async (_req: Request, res: Response) => {
  try {
    // This endpoint is a signal — the actual re-registration happens in main.ts
    // on the next restart. We clear the cached webhook URL so the skip-noop
    // logic forces a re-register.
    await setBotState("webhook_url", "");
    res.json({ ok: true, message: "Webhook cache cleared — will re-register on next boot or poll cycle" });
  } catch (e) {
    logger.error(e, "admin: rewebhook failed");
    res.status(500).json({ error: "Failed to clear webhook cache" });
  }
});

// ── GET/POST /policy-mode ───────────────────────────────────────────────
adminRouter.get("/policy-mode", async (_req: Request, res: Response) => {
  const mode = (await getBotState(BS_POLICY_MODE)) ?? process.env.SIGNER_POLICY_MODE ?? "enforce";
  res.json({ mode });
});

adminRouter.post("/policy-mode", async (req: Request, res: Response) => {
  const { mode } = req.body as { mode?: string };
  if (!mode || !["enforce", "observe", "off"].includes(mode)) {
    res.status(400).json({ error: "mode must be one of: enforce, observe, off" });
    return;
  }
  await setBotState(BS_POLICY_MODE, mode);
  logger.info({ mode }, "admin: signer policy mode changed");
  res.json({ ok: true, mode });
});

// ── GET/POST /fee-mode ──────────────────────────────────────────────────
adminRouter.get("/fee-mode", async (_req: Request, res: Response) => {
  const mode = (await getBotState(BS_FEE_MODE)) ?? process.env.FXAEON_FEE_MODE ?? "observe";
  res.json({ mode });
});

adminRouter.post("/fee-mode", async (req: Request, res: Response) => {
  const { mode } = req.body as { mode?: string };
  if (!mode || !["enforce", "observe", "off"].includes(mode)) {
    res.status(400).json({ error: "mode must be one of: enforce, observe, off" });
    return;
  }
  await setBotState(BS_FEE_MODE, mode);
  logger.info({ mode }, "admin: fee mode changed");
  res.json({ ok: true, mode });
});

// ── GET /stats ──────────────────────────────────────────────────────────
adminRouter.get("/stats", async (_req: Request, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeToday,
      feeLedgerToday,
      feeOrphans,
      txsToday,
      openPositions,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({
        where: { updatedAt: { gte: todayStart }, deletedAt: null },
      }),
      prisma.feeLedger.aggregate({
        where: { createdAt: { gte: todayStart } },
        _sum: { usdAmount: true, notionalUsd: true },
        _count: true,
      }),
      prisma.feeLedger.count({ where: { feeOrphan: true } }),
      prisma.txRecord.count({
        where: { createdAt: { gte: todayStart } },
      }),
      prisma.position.count(),
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      users: { total: totalUsers, activeToday },
      today: {
        trades: txsToday,
        feeCount: feeLedgerToday._count,
        feeUsd: feeLedgerToday._sum.usdAmount ?? 0,
        volumeUsd: feeLedgerToday._sum.notionalUsd ?? 0,
      },
      openPositions,
      feeOrphans,
    });
  } catch (e) {
    logger.error(e, "admin: stats failed");
    res.status(500).json({ error: "Failed to compute stats" });
  }
});
