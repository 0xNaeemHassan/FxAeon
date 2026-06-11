/**
 * grammY command-timing middleware (W-15).
 *
 * Logs every command's handler duration and feeds the in-process metrics
 * (count + latency summary per command, error counter). Must be installed
 * with bot.use() BEFORE the command handlers are registered.
 */
import type { Context, NextFunction } from "grammy";
import { logger } from "./logger.js";
import { incr, observe } from "../core/metrics.js";

export function commandName(ctx: Context): string | null {
  const text = ctx.message?.text;
  if (!text || !text.startsWith("/")) return null;
  const cmd = text.split(/[\s@]/, 1)[0].slice(1).toLowerCase();
  // Defensive: only count well-formed command words, not arbitrary input.
  return /^[a-z0-9_]{1,32}$/.test(cmd) ? cmd : null;
}

export async function commandTiming(ctx: Context, next: NextFunction): Promise<void> {
  const cmd = commandName(ctx);
  if (!cmd) return next();

  const start = Date.now();
  try {
    await next();
    const ms = Date.now() - start;
    incr(`cmd.${cmd}`);
    observe(`cmd.${cmd}`, ms);
    logger.info({ command: cmd, durationMs: ms }, "command handled");
  } catch (err) {
    const ms = Date.now() - start;
    incr(`cmd.${cmd}.error`);
    observe(`cmd.${cmd}`, ms);
    logger.error({ command: cmd, durationMs: ms, error: err }, "command failed");
    throw err;
  }
}
