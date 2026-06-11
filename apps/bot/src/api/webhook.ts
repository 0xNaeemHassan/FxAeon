import { Router } from "express";

export const webhookRouter = Router();

// The /privy webhook route was removed in W-12: transaction webhooks are a
// Privy enterprise feature we don't have. Tx lifecycle is tracked by the
// W-11 receipt watcher instead.

// Telegram webhook (for bot updates)
webhookRouter.post("/telegram", async (req, res) => {
  // This is handled by grammY webhookCallback in main.ts
  // This route is for additional processing if needed
  res.json({ received: true });
});

// Health check for webhooks
webhookRouter.get("/status", (req, res) => {
  res.json({
    telegram: "active",
    lastReceived: new Date().toISOString(),
  });
});
