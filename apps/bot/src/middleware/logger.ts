import pino from "pino";
import { isSensitiveLogKey, scrubSensitiveText } from "../utils/scrubSensitive.js";

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

/** Scrub both wallet addresses and credential-shaped free-form text. */
export function sanitizeLogString(s: string): string {
  return maskAddresses(scrubSensitiveText(s));
}

const MAX_DEPTH = 5;

/** Deep-copy `value` with addresses and credentials scrubbed (depth-limited). */
export function maskDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return sanitizeLogString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, depth + 1));
  if (value instanceof Error) {
    // Clone instead of mutating the live Error: callers may still need its
    // original message for classification or a safe user-facing response.
    const clone = new Error(sanitizeLogString(value.message));
    Object.setPrototypeOf(clone, Object.getPrototypeOf(value));
    Object.defineProperty(clone, "name", {
      value: sanitizeLogString(value.name),
      configurable: true,
      writable: true,
    });
    if (value.stack) {
      // V8 exposes stack through a lazy accessor tied to the original Error's
      // internal slots. Materialize it rather than copying that accessor.
      Object.defineProperty(clone, "stack", {
        value: sanitizeLogString(value.stack),
        configurable: true,
        writable: true,
      });
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "name" || key === "message" || key === "stack") continue;
      // Do not execute or transfer arbitrary accessors from third-party error
      // classes. Data properties (including `cause`) are sanitized recursively.
      if (!("value" in descriptor)) continue;
      descriptor.value = isSensitiveLogKey(key)
        ? "[REDACTED]"
        : maskDeep(descriptor.value, depth + 1);
      Object.defineProperty(clone, key, descriptor);
    }
    return clone;
  }
  const proto = Object.getPrototypeOf(value);
  if (value instanceof URL) return sanitizeLogString(value.toString());
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (proto !== Object.prototype && proto !== null) {
    // Unknown class serializers may expose non-enumerable headers or internal
    // credentials. Fail closed while retaining the class name for diagnosis.
    const name = (value as { constructor?: { name?: string } }).constructor?.name;
    return `[${name || "Object"}]`;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveLogKey(k) ? "[REDACTED]" : maskDeep(v, depth + 1);
  }
  return out;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  base: { service: "fxbot", version: process.env.npm_package_version || "1.0.0" },
  redact: {
    paths: [
      "privateKey", "apiKey", "secret", "token", "password", "authorization",
      "*.privateKey", "*.apiKey", "*.secret", "*.token", "*.password", "*.authorization",
      "headers.authorization", "body.telegramInitData", "body.privateKey",
    ],
    remove: true,
  },
  hooks: {
    // Scrub wallet addresses and secrets in every log call (W-15).
    logMethod(args, method) {
      const masked = args.map((a) => maskDeep(a)) as Parameters<typeof method>;
      return method.apply(this, masked);
    },
  },
});

/** Create a logger whose persistent child bindings are sanitized up front. */
export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(maskDeep(bindings) as Record<string, unknown>);
}

export const botLogger = childLogger({ component: "bot" });
export const privyLogger = childLogger({ component: "privy" });
export const fxLogger = childLogger({ component: "fx-sdk" });
export const notifLogger = childLogger({ component: "notifications" });
export const workerLogger = childLogger({ component: "workers" });
