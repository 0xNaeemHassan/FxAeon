import { Router } from "express";
import { txNotifier } from "../notifications/tx-notifier.js";

export const webhookRouter = Router();

// Privy webhook endpoint
webhookRouter.post("/privy", async (req, res) => {
  const signature = req.headers["privy-signature"] as string;
  
  if (!signature) {
    return res.status(401).json({ error: "Missing Privy signature" });
  }
  
  // Verify webhook signature (in production, verify against Privy secret)
  // const isValid = verifyPrivySignature(req.body, signature);
  
  try {
    await txNotifier.handleWebhook(req.body);
    res.json({ received: true, processed: true });
  } catch (error: unknown) {
    console.error("Webhook processing error:", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "Failed to process webhook", details: message });
  }
});

// Telegram webhook (for bot updates)
webhookRouter.post("/telegram", async (req, res) => {
  // This is handled by grammY webhookCallback in main.ts
  // This route is for additional processing if needed
  res.json({ received: true });
});

// Health check for webhooks
webhookRouter.get("/status", (req, res) => {
  res.json({
    privy: "active",
    telegram: "active",
    lastReceived: new Date().toISOString(),
  });
});
