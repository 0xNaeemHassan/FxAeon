import pino from "pino";

/**
 * Mask Ethereum addresses in a string: 0x1234…abcd (W-15).
 * Keeps first/last 4 hex chars so an operator can still correlate a user's
 * own reports, but logs no longer link telegram ids to full addresses.
 * 32-byte values (tx hashes, 66 chars) are NOT masked — they are public
 * chain data and essential for debugging; the lookahead leaves any 0x-hex
 * run longer than 40 chars untouched.
 */
export function maskAddresses(s: string): string {
  return s.replace(
    /0x([0-9a-fA-F]{4})[0-9a-fA-F]{32}([0-9a-fA-F]{4})(?![0-9a-fA-F])/g,
    "0x$1\u2026$2"
  );
}

const MAX_DEPTH = 5;

/** Deep-copy `value` with addresses masked in all strings (depth-limited). */
export function maskDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return maskAddresses(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, depth + 1));
  if (value instanceof Error) {
    // Preserve Error identity (pino serializes it specially) but mask message.
    const e = value as Error & { message: string };
    e.message = maskAddresses(e.message);
    return e;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value; // class instances: leave alone
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = maskDeep(v, depth + 1);
  return out;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  base: { service: "fxbot", version: process.env.npm_package_version || "1.0.0" },
  redact: {
    paths: ["*.privateKey", "*.apiKey", "*.secret", "*.token", "*.password", "*.authorization", "headers.authorization", "body.telegramInitData", "body.privateKey"],
    remove: true,
  },
  hooks: {
    // Mask wallet addresses in every log call (W-15).
    logMethod(args, method) {
      const masked = args.map((a) => maskDeep(a)) as Parameters<typeof method>;
      return method.apply(this, masked);
    },
  },
});

export const botLogger = logger.child({ component: "bot" });
export const privyLogger = logger.child({ component: "privy" });
export const fxLogger = logger.child({ component: "fx-sdk" });
export const notifLogger = logger.child({ component: "notifications" });
export const workerLogger = logger.child({ component: "workers" });
