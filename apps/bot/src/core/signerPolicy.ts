/**
 * Central session-signer policy — the broadcast allow-list (PLAN.md Pillar A §3.4).
 *
 * The session signer the user grants in the Mini App is powerful: it can sign
 * any transaction the bot hands to Privy. The ONLY thing standing between a
 * buggy/compromised route builder and the user's funds is this check. It runs
 * inside `executeRoute` — the single sanctioned broadcast path — so EVERY trade
 * (positions, earn, limit orders, automation, bridge) is screened before a
 * single byte reaches Privy.
 *
 * Invariants enforced (fail-closed):
 *  1. `tx.to` MUST be a contract in the verified f(x) ADDRESSES registry.
 *     The registry is the audited single-source-of-truth (verify-addresses.mjs
 *     confirms each has mainnet bytecode). A route that targets anything else
 *     — an attacker contract, an unknown aggregator — is refused.
 *  2. An ERC20 `approve` / `increaseAllowance` may only name a spender that is
 *     itself a registry contract (or the user's own wallet). This blocks the
 *     classic "approve attacker, drain later" exfiltration even if it targets a
 *     legitimate token contract.
 *  3. An ERC20 `transfer` / `transferFrom` may only send to a registry contract
 *     or the user's own wallet — never to an arbitrary recipient.
 *
 * The enforced allow-list is DERIVED FROM `ADDRESSES` at runtime, never from the
 * JSON policy file, so the two can never silently drift: `policy/signer.policy.json`
 * is documentation + the artifact PLAN.md asks for, and a unit test asserts it
 * mirrors the registry exactly.
 *
 * Mode (`SIGNER_POLICY_MODE`, default "enforce"):
 *  - "enforce" — a violation aborts the trade before broadcast (fail-closed).
 *  - "observe" — a violation is counted + surfaced but the trade proceeds.
 *    Operational safety valve: if a legitimate-but-new f(x) peripheral ever
 *    appears in a route, flip to "observe" for seconds, add the verified address
 *    to ADDRESSES, then flip back — rather than bricking trades. See docs/GAPS.md.
 *  - "off" — disabled (testing only).
 */
import { ADDRESSES } from "@fxbot/shared";
import { incr } from "./metrics.js";

export type PolicyMode = "enforce" | "observe" | "off";

// ERC20 selectors whose address argument must itself be allow-listed.
const SEL_APPROVE = "0x095ea7b3"; // approve(address,uint256)
const SEL_INCREASE_ALLOWANCE = "0x39509351"; // increaseAllowance(address,uint256)
const SEL_TRANSFER = "0xa9059cbb"; // transfer(address,uint256)
const SEL_TRANSFER_FROM = "0x23b872dd"; // transferFrom(address,address,uint256)

/** Authoritative allow-list: every verified f(x) registry address, lowercased. */
export const ALLOWED_TARGETS: ReadonlySet<string> = new Set(
  Object.values(ADDRESSES).map((a) => a.toLowerCase())
);

export interface PolicyTx {
  to: string;
  data: string;
  value?: bigint;
}

export interface PolicyViolation {
  index: number;
  to: string;
  reason: string;
}

export class SignerPolicyError extends Error {
  constructor(public readonly violations: PolicyViolation[]) {
    super(
      `signer policy refused ${violations.length} disallowed tx(s): ` +
        violations.map((v) => `#${v.index} ${v.reason}`).join("; ")
    );
    this.name = "SignerPolicyError";
  }
}

function selectorOf(data: string | undefined): string {
  return (data ?? "").slice(0, 10).toLowerCase();
}

/** Extract the address argument at 32-byte word `wordIndex` (0-based) from calldata. */
function addressArg(data: string, wordIndex: number): string | null {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const start = 8 + wordIndex * 64; // 8 hex chars = 4-byte selector
  const word = hex.slice(start, start + 64);
  if (word.length < 64) return null;
  // An ABI address word is left-padded to 32 bytes; the address is the low 20.
  const upper = word.slice(0, 24);
  if (!/^0+$/.test(upper)) return null; // not a clean address word → suspicious
  return ("0x" + word.slice(24)).toLowerCase();
}

export function resolvePolicyMode(): PolicyMode {
  const raw = (process.env.SIGNER_POLICY_MODE ?? "enforce").toLowerCase();
  if (raw === "observe") return "observe";
  if (raw === "off") return "off";
  return "enforce";
}

/**
 * Pure check — returns every violation in the route (does not throw).
 * `walletAddress` (the user's own wallet) is always an allowed spender/recipient.
 */
export function checkRoute(
  txs: readonly PolicyTx[],
  opts: { walletAddress?: string } = {}
): PolicyViolation[] {
  const self = opts.walletAddress?.toLowerCase();
  const allowed = (addr: string | null): boolean =>
    addr !== null && (ALLOWED_TARGETS.has(addr) || (self !== undefined && addr === self));

  const violations: PolicyViolation[] = [];
  txs.forEach((tx, index) => {
    const to = (tx.to ?? "").toLowerCase();
    if (!ALLOWED_TARGETS.has(to)) {
      violations.push({
        index,
        to,
        reason: `target ${tx.to} is not in the f(x) registry`,
      });
      return; // a disallowed target is already fatal; arg checks are moot.
    }
    const sel = selectorOf(tx.data);
    if (sel === SEL_APPROVE || sel === SEL_INCREASE_ALLOWANCE) {
      const spender = addressArg(tx.data, 0);
      if (!allowed(spender)) {
        violations.push({ index, to, reason: `approve spender ${spender ?? "<undecodable>"} is not allowed` });
      }
    } else if (sel === SEL_TRANSFER) {
      const recipient = addressArg(tx.data, 0);
      if (!allowed(recipient)) {
        violations.push({ index, to, reason: `transfer recipient ${recipient ?? "<undecodable>"} is not allowed` });
      }
    } else if (sel === SEL_TRANSFER_FROM) {
      const recipient = addressArg(tx.data, 1);
      if (!allowed(recipient)) {
        violations.push({ index, to, reason: `transferFrom recipient ${recipient ?? "<undecodable>"} is not allowed` });
      }
    }
  });
  return violations;
}

/**
 * Enforce the policy for a route. Throws `SignerPolicyError` in "enforce" mode
 * when there is any violation; in "observe" mode it counts + returns the
 * violations (caller logs); in "off" mode it is a no-op.
 */
export function assertRouteAllowed(
  txs: readonly PolicyTx[],
  opts: { walletAddress?: string; mode?: PolicyMode } = {}
): PolicyViolation[] {
  const mode = opts.mode ?? resolvePolicyMode();
  if (mode === "off") return [];
  const violations = checkRoute(txs, opts);
  if (violations.length === 0) {
    incr("policy.ok");
    return [];
  }
  incr("policy.violation", violations.length);
  if (mode === "observe") {
    incr("policy.observe");
    return violations;
  }
  incr("policy.reject");
  throw new SignerPolicyError(violations);
}
