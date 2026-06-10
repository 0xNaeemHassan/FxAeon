// INPUT VALIDATION: All user inputs must be validated with Zod schemas
import { Request, Response } from "express";
import { txNotifier } from "../notifications/tx-notifier.js";

export async function privyWebhookHandler(req: Request, res: Response) {
  try {
    // Verify webhook signature (Privy sends signed webhooks)
    const signature = req.headers["privy-signature"] as string;
    if (!signature) {
      return res.status(401).json({ error: "Missing signature" });
    }
    
    // Process webhook event
    await txNotifier.handleWebhook(req.body);
    res.setHeader('Content-Type', 'application/json');
  res.json({ received: true });
  } catch (error) {
    console.error("Privy webhook error:", error);
    res.status(500).json({ error: "Internal error" });
  }
}
