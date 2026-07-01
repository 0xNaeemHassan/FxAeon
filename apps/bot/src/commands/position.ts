/**
 * /position — redirects to /portfolio (the single-screen portfolio).
 *
 * Phase 1: the static stub ("No active positions found") is replaced by a
 * route to the real on-chain portfolio reader. This command is an alias —
 * the canonical entry point is /portfolio.
 */
import { Context } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { portfolioCommand } from "./portfolio.js";

export default async function handler(ctx: Context & I18nFlavor): Promise<void> {
  await portfolioCommand(ctx);
}
