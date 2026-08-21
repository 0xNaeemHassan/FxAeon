/**
 * Secret scrubbing shared by logs and outbound error telemetry.
 *
 * Structured logger redaction alone is not enough: driver and RPC errors often
 * embed credentials in a single free-form string (for example a Postgres URL
 * or an Authorization header). Keep this module dependency-free so it can be
 * used by the logger itself without creating an import cycle.
 */

const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "privatekey",
  "mnemonic",
  "seed",
  "seedphrase",
  "secret",
  "clientsecret",
  "webhooksecret",
  "telegramwebhooksecret",
  "apikey",
  "accesskey",
  "token",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bottoken",
  "secrettoken",
  "telegraminitdata",
  "initdata",
  "signature",
  "databaseurl",
  "directurl",
  "redisurl",
  "rpcurl",
  "alchemyrpcurl",
  "baserpcurl",
  "sentrydsn",
]);

/** True for object keys whose values must never be serialized to a log. */
export function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("rpcurl") ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("refreshtoken")
  );
}

/**
 * Remove credential-shaped values from arbitrary text while retaining enough
 * host/path context for production debugging. Public transaction hashes are
 * deliberately preserved; they are indistinguishable from private keys unless
 * accompanied by a sensitive label, which the assignment rule handles.
 */
export function scrubSensitiveText(text: string): string {
  return text
    // Connection-string user info, including percent-encoded passwords.
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/?#]+@/gi,
      "$1***@"
    )
    // Secrets passed as URL query/fragment parameters.
    .replace(
      /([?&#](?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|token|secret|client[-_]?secret|password|passwd|signature|sig)=)[^&#\s]*/gi,
      "$1[REDACTED]"
    )
    // Authorization header values in raw driver/fetch error messages.
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+={0,2}/gi, "$1 [REDACTED]")
    // Quoted assignments may contain spaces (mnemonics in particular).
    .replace(
      /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|bot[-_]?token|secret[-_]?token|token|client[-_]?secret|webhook[-_]?secret|password|passwd|authorization|private[-_]?key|mnemonic|seed[-_]?phrase|telegram[-_]?init[-_]?data|init[-_]?data|database[-_]?url|direct[-_]?url|redis[-_]?url|(?:alchemy[-_]?|base[-_]?)?rpc[-_]?url|sentry[-_]?dsn)["']?\s*[:=]\s*)(["'])[^"'\r\n]*\2/gi,
      "$1$2[REDACTED]$2"
    )
    // key=value, key: value, and JSON-like key/value fragments.
    .replace(
      /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|bot[-_]?token|secret[-_]?token|token|client[-_]?secret|webhook[-_]?secret|password|passwd|authorization|private[-_]?key|mnemonic|seed[-_]?phrase|telegram[-_]?init[-_]?data|init[-_]?data|database[-_]?url|direct[-_]?url|redis[-_]?url|(?:alchemy[-_]?|base[-_]?)?rpc[-_]?url|sentry[-_]?dsn)["'\s]*[:=]["'\s]*)([^"',;\s}\]]+)/gi,
      "$1[REDACTED]"
    )
    // Common self-identifying credentials that may appear without a label.
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{20,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, "[REDACTED_BOT_TOKEN]")
    // Provider API keys embedded in otherwise ordinary RPC URLs.
    .replace(
      /\b(https?:\/\/[^/\s]*(?:alchemy\.com\/v2|infura\.io\/v3)\/)[^/?#\s"'`]+/gi,
      "$1[REDACTED]"
    )
    .replace(
      /\b(https?:\/\/)[a-z0-9-]{16,}\.(quiknode\.pro)\b/gi,
      "$1[REDACTED].$2"
    );
}
