/**
 * Sentry error tracking (W-15) — only active when SENTRY_DSN is set.
 *
 * beforeSend scrubs everything sensitive before it leaves the process:
 * request headers/cookies/body are dropped entirely, and wallet addresses
 * are masked in messages and stack frames (same masking as the logger).
 * tracesSampleRate stays 0 — errors only, comfortably inside the free tier.
 */
import * as Sentry from "@sentry/node";
import { logger, maskAddresses } from "../middleware/logger.js";

export function scrubEvent(event: Sentry.Event): Sentry.Event {
  // Never ship request payloads, headers, or cookies.
  delete event.request;
  delete (event as { user?: unknown }).user;

  if (event.message) event.message = maskAddresses(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = maskAddresses(ex.value);
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = maskAddresses(crumb.message);
    // Breadcrumb data can carry arbitrary objects — drop rather than risk it.
    delete crumb.data;
  }
  if (event.extra) {
    for (const [k, v] of Object.entries(event.extra)) {
      event.extra[k] = typeof v === "string" ? maskAddresses(v) : "[scrubbed]";
    }
  }
  return event;
}

export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.npm_package_version,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: () => null,
  });
  logger.info("Sentry initialized (errors only, scrubbed)");
  return true;
}

/** Report an error if Sentry is active; always safe to call. */
export function captureError(err: unknown, context?: Record<string, string>): void {
  try {
    Sentry.captureException(err, context ? { tags: context } : undefined);
  } catch {
    /* never let error reporting throw */
  }
}
