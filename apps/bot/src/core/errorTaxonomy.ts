/**
 * W-19: execution-error taxonomy → actionable user copy.
 *
 * Raw errors from the RPC / Privy / SDK ("nonce too low", "TRANSFER_FROM_FAILED",
 * axios stack traces…) used to reach users verbatim. This module classifies
 * them into a small set of kinds with copy that says (1) what happened,
 * (2) whether anything was sent on-chain, and (3) what to do next.
 *
 * Honesty rules:
 * - Broadcast-state first: "simulation failed/unavailable" errors are
 *   pre-broadcast (nothing sent); "reverted" errors are post-broadcast — the
 *   copy never claims "nothing was sent" once a tx may have left our hands,
 *   and any tx hash in the raw string is preserved for Etherscan.
 * - Unknown errors stay generic; we don't guess causes we can't verify.
 */

export type ExecutionErrorKind =
  | "simulation_unavailable"
  | "simulation_failed"
  | "reverted"
  | "insufficient_funds"
  | "slippage"
  | "nonce"
  | "policy"
  | "rate_limited"
  | "network"
  | "unknown";

const INSUFFICIENT_RE =
  /insufficient funds|exceeds balance|transfer amount exceeds|insufficient allowance|TRANSFER_FROM_FAILED|insufficient balance/i;
const SLIPPAGE_RE =
  /slippage|min.?out|minimum.*received|too little received|price impact|INSUFFICIENT_OUTPUT_AMOUNT/i;
const HASH_RE = /0x[0-9a-fA-F]{64}/;

export function classifyExecutionError(raw: string | undefined): ExecutionErrorKind {
  if (!raw) return "unknown";
  // Broadcast-state classification comes first — it determines whether we
  // may promise "nothing was sent".
  if (/simulation unavailable/i.test(raw)) return "simulation_unavailable";
  if (/simulation failed/i.test(raw)) return "simulation_failed";
  if (/reverted/i.test(raw)) return "reverted";
  if (INSUFFICIENT_RE.test(raw)) return "insufficient_funds";
  if (SLIPPAGE_RE.test(raw)) return "slippage";
  if (/nonce too low|replacement transaction underpriced|already known|same nonce/i.test(raw)) return "nonce";
  if (/policy|not allowed by|denied by wallet/i.test(raw)) return "policy";
  if (/rate limit|too many requests|429/i.test(raw)) return "rate_limited";
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network error|socket hang up|503|502/i.test(raw))
    return "network";
  return "unknown";
}

/** Actionable hint for the likely cause inside a pre-broadcast failure. */
function causeHint(raw: string): string {
  if (INSUFFICIENT_RE.test(raw)) return " Likely cause: insufficient balance for the trade plus gas — top up with /deposit.";
  if (SLIPPAGE_RE.test(raw)) return " Likely cause: price moved beyond your slippage tolerance — retry, or raise slippage in /settings.";
  return "";
}

/**
 * Friendly, actionable copy for a raw execution error. Keeps any tx hash so
 * post-broadcast failures stay verifiable on Etherscan.
 */
export function describeExecutionError(raw: string | undefined): string {
  const kind = classifyExecutionError(raw);
  const hash = raw?.match(HASH_RE)?.[0];
  const txLine = hash ? `\nTx: https://etherscan.io/tx/${hash}` : "";

  switch (kind) {
    case "simulation_unavailable":
      return "We couldn't verify this transaction is safe (simulation unavailable), so it was NOT sent. Try again in a moment.";
    case "simulation_failed":
      return `Simulation showed this transaction would fail, so it was NOT sent.${causeHint(raw ?? "")}`;
    case "reverted":
      return `The transaction reverted on-chain — your position is unchanged, but gas was spent.${causeHint(raw ?? "")}${txLine}`;
    case "insufficient_funds":
      return `Insufficient balance to cover this transaction plus gas. Top up with /deposit and try again.${txLine}`;
    case "slippage":
      return `Price moved more than your slippage tolerance allows. Retry, or raise slippage in /settings (higher slippage = worse worst-case price).${txLine}`;
    case "nonce":
      return "The network is still processing another transaction from your wallet. Wait ~30s and try again.";
    case "policy":
      return "Your wallet's security policy blocked this action. Check /settings, or contact support if this looks wrong.";
    case "rate_limited":
      return "Hitting a temporary rate limit. Wait a minute and try again.";
    case "network":
      return `Network hiccup talking to the chain. Your position is unchanged unless a tx hash is shown.${txLine} Try again shortly.`;
    default:
      return `Something went wrong executing this transaction.${txLine || " Nothing appears to have been sent — you can retry safely."}`;
  }
}
