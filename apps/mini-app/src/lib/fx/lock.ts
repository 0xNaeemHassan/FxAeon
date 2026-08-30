import type { Address } from "viem";
import type { FxChainId } from "./types";

const localTails = new Map<string, Promise<void>>();
const LOCK_PREFIX = "fxaeon:tx-lock:v1:";
export type AssertLockOwned = () => void;

function keyFor(walletAddress: Address): string {
  // External EIP-1193 wallets expose one mutable selected network per wallet
  // provider. Two routes for the same wallet therefore cannot safely sign on
  // Ethereum and Base at the same time: either route may switch the provider
  // after the other's final chain check but before eth_sendTransaction.
  // Serialize the signing boundary per wallet across every supported chain.
  return walletAddress.toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withInTabLock<T>(key: string, run: (assertOwned: AssertLockOwned) => Promise<T>): Promise<T> {
  const previous = localTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  localTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    // The in-tab queue is authoritative for this tab. Cross-tab ownership is
    // checked by the outer Web Locks or storage-lease implementation.
    return await run(() => undefined);
  } finally {
    release();
    if (localTails.get(key) === tail) localTails.delete(key);
  }
}

async function withStorageLease<T>(key: string, run: (assertOwned: AssertLockOwned) => Promise<T>, ttlMs: number): Promise<T> {
  if (typeof window === "undefined") return run(() => undefined);
  let target: Storage;
  try {
    target = window.localStorage;
  } catch {
    throw new Error("Transaction lock storage is unavailable");
  }
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("This browser cannot provide a safe cross-tab transaction lock; update Telegram and try again");
  }
  const storageKey = `${LOCK_PREFIX}${key}`;
  const owner = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const claimSettleMs = 75;
  const contenders = new Set<string>([owner]);
  const activeOwners = new Set<string>();
  const channel = new BroadcastChannel(`${LOCK_PREFIX}${key}`);
  let active = false;
  if (channel) {
    channel.onmessage = (event: MessageEvent<{
      type?: "claim" | "busy" | "release";
      owner?: string;
      expiresAt?: number;
    }>) => {
      const message = event.data;
      if (!message?.owner || message.owner === owner) return;
      if (message.type === "claim") {
        if (active) {
          // Keep the channel open for the entire route. A late contender may
          // have read an expired lease just before this tab renewed/claimed;
          // explicitly tell it that an active owner exists.
          channel.postMessage({ type: "busy", owner, expiresAt: Date.now() + ttlMs });
        } else {
          contenders.add(message.owner);
        }
      } else if (message.type === "busy") {
        activeOwners.add(message.owner);
      } else if (message.type === "release") {
        contenders.delete(message.owner);
        activeOwners.delete(message.owner);
      }
    };
  }
  const deadline = Date.now() + Math.max(ttlMs, 10_000);
  try {
    while (Date.now() < deadline) {
      const now = Date.now();
      let current: { owner?: string; expiresAt?: number } | undefined;
      try {
        const raw = target.getItem(storageKey);
        if (raw) current = JSON.parse(raw) as { owner?: string; expiresAt?: number };
      } catch {
        // A cross-tab lock cannot be proven if storage reads fail. Keep the
        // financial flow fail-closed rather than signing concurrently.
        channel?.close();
        throw new Error("Transaction lock storage is unavailable");
      }
      if (current?.expiresAt && current.expiresAt > now) {
        await sleep(100);
        continue;
      }

      // Broadcast claims before writing. The short settle window lets tabs
      // that observed the same expired lease converge on one owner; a live
      // owner responds with `busy` and keeps a late tab from entering.
      contenders.clear();
      contenders.add(owner);
      activeOwners.clear();
      channel?.postMessage({ type: "claim", owner });
      await sleep(claimSettleMs + Math.floor(Math.random() * 25));
      if (activeOwners.size > 0) continue;
      const winner = [...contenders].sort()[0];
      if (winner !== owner) {
        await sleep(100);
        continue;
      }
      let acquired = false;
      try {
        // Re-read immediately before the claim to avoid overwriting a lease
        // acquired during the settle period.
        const latestRaw = target.getItem(storageKey);
        const latest = latestRaw ? JSON.parse(latestRaw) as { owner?: string; expiresAt?: number } : undefined;
        if (latest?.expiresAt && latest.expiresAt > Date.now()) continue;
        target.setItem(storageKey, JSON.stringify({ owner, expiresAt: Date.now() + ttlMs }));
        const verify = JSON.parse(target.getItem(storageKey) ?? "null") as { owner?: string } | null;
        if (verify?.owner !== owner) continue;
        // One final ownership settle catches a second claimant that wrote
        // between our set/verify and the start of the route.
        await sleep(claimSettleMs);
        const settled = JSON.parse(target.getItem(storageKey) ?? "null") as { owner?: string; expiresAt?: number } | null;
        if (settled?.owner !== owner || (settled.expiresAt ?? 0) <= Date.now()) continue;
        acquired = true;
      } catch {
        channel?.close();
        throw new Error("Transaction lock storage is unavailable");
      }
      if (!acquired) continue;
      active = true;

      /**
       * A WebView can suspend JavaScript while a wallet prompt is open. The
       * renewal interval cannot run during that suspension, so every route
       * step must synchronously revalidate ownership before signing. A stale,
       * missing, or malformed lease fails closed rather than allowing two
       * tabs to submit adjacent SDK transactions concurrently.
       */
      const assertOwned: AssertLockOwned = () => {
        let latest: { owner?: string; expiresAt?: number } | null = null;
        try {
          latest = JSON.parse(target.getItem(storageKey) ?? "null") as { owner?: string; expiresAt?: number } | null;
        } catch {
          throw new Error("Transaction lock storage is unavailable; refusing to sign");
        }
        if (latest?.owner !== owner || typeof latest.expiresAt !== "number" || latest.expiresAt <= Date.now()) {
          throw new Error("Transaction lock ownership was lost; refusing to sign");
        }
      };

      // Wallet prompts and multi-step receipt waits can legitimately take
      // longer than one lease. Renew while this tab remains the owner so
      // another tab cannot enter midway through an ordered SDK route.
      const renewEveryMs = Math.max(1_000, Math.floor(ttlMs / 3));
      const renew = setInterval(() => {
        try {
          const latest = JSON.parse(target.getItem(storageKey) ?? "null") as {
            owner?: string;
          } | null;
          if (latest?.owner === owner) {
            target.setItem(
              storageKey,
              JSON.stringify({ owner, expiresAt: Date.now() + ttlMs }),
            );
          }
        } catch {
          // BroadcastChannel still answers contenders with `busy`, and the
          // runner independently checks the pending nonce before every step.
        }
      }, renewEveryMs);
      try {
        // Route/simulation/wallet errors must propagate unchanged. They are
        // not evidence that the storage lease itself failed.
        assertOwned();
        return await run(assertOwned);
      } finally {
        active = false;
        channel?.postMessage({ type: "release", owner });
        clearInterval(renew);
        try {
          const latest = JSON.parse(target.getItem(storageKey) ?? "null") as { owner?: string } | null;
          if (latest?.owner === owner) target.removeItem(storageKey);
        } catch {
          // Lease expiry is the recovery mechanism if cleanup is blocked.
        }
      }
    }
    throw new Error("another transaction is already awaiting wallet approval in this tab or device");
  } finally {
    channel?.close();
  }
}

/**
 * Serialize transaction planning/signing per wallet across Ethereum and Base.
 * The chain remains an explicit route invariant, but it is deliberately not
 * part of the lock key because an external wallet's selected network is shared
 * mutable state. Web Locks is authoritative where available; localStorage is
 * an advisory cross-tab lease fallback and never a balance, receipt, or
 * authorization source of truth.
 */
export async function withWalletChainLock<T>(params: {
  walletAddress: Address;
  chainId: FxChainId;
  run: (assertOwned: AssertLockOwned) => Promise<T>;
  ttlMs?: number;
  /**
   * Financial signing in a browser must use the browser's authoritative Web
   * Locks implementation. A storage lease remains available only for
   * non-browser tests and callers that never cross a wallet-prompt boundary:
   * WebViews may suspend JavaScript while a prompt is open, which prevents a
   * lease heartbeat from proving exclusive ownership.
   */
  requireWebLocks?: boolean;
}): Promise<T> {
  const key = keyFor(params.walletAddress);
  return withInTabLock(key, async () => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks) {
      return locks.request(`${LOCK_PREFIX}${key}`, { mode: "exclusive" }, () => params.run(() => undefined));
    }
    if (params.requireWebLocks) {
      throw new Error(
        "This browser cannot safely serialize wallet approvals. Update Telegram or open FxAeon in a current browser and try again",
      );
    }
    return withStorageLease(key, params.run, params.ttlMs ?? 10 * 60_000);
  });
}
