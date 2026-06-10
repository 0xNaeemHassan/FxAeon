// INPUT VALIDATION: All user inputs must be validated with Zod schemas
import { Request, Response } from "express";
import { txNotifier } from "../notifications/tx-notifier.js";
import { verifyPrivyRequest, type RequestWithRawBody } from "../utils/webhookAuth.js";

export async function privyWebhookHandler(req: Request, res: Response) {
  try {
    // Verify the SVIX HMAC signature over the raw body (AUDIT.md P0-5).
    // Fails closed when PRIVY_WEBHOOK_SECRET is not configured.
    const verdict = verifyPrivyRequest(req as RequestWithRawBody);
    if (!verdict.ok) {
      return res.status(401).json({ error: "Invalid webhook signature" });
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
