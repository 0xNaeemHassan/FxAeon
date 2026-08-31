import type { FxChainId } from "./types";

export const ETHEREUM_CHAIN_ID = 1 as const;
export const BASE_CHAIN_ID = 8453 as const;

export const FX_SDK_MAIN_COMMIT =
  "53c0b9805a169e75ad375c92c241e1292b66405f" as const;

const ALCHEMY_HOST_BY_CHAIN: Record<FxChainId, string> = {
  1: "eth-mainnet.g.alchemy.com",
  8453: "base-mainnet.g.alchemy.com",
};

const SCREENSHOT_MODE = typeof process !== "undefined" && process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === "1";

function screenshotRpcEnv(): string | undefined {
  if (!SCREENSHOT_MODE || typeof process === "undefined") return undefined;
  const value = process.env.NEXT_PUBLIC_FX_ANVIL_RPC_URL;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function ethereumRpcEnv(): string | undefined {
  // Keep each access literal: Next statically inlines literal
  // process.env.NEXT_PUBLIC_* expressions, but cannot inline indexed env access
  // in a static export.
  if (typeof process === "undefined") return undefined;
  const value = process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function baseRpcEnv(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const value = process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requireRpcUrl(chainId: FxChainId): string {
  const localFork = screenshotRpcEnv();
  if (localFork) return assertLocalForkRpcUrl(localFork, "Screenshot fork RPC URL");
  const name = chainId === ETHEREUM_CHAIN_ID
    ? "NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL"
    : "NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL";
  const value = chainId === ETHEREUM_CHAIN_ID ? ethereumRpcEnv() : baseRpcEnv();
  if (!value) {
    throw new Error(`${name} is required for browser blockchain operations`);
  }
  return assertAlchemyRpcUrl(value, chainId, name);
}

/**
 * A local fork is available only to the explicit, disposable screenshot build.
 * Keeping this opt-in and localhost-only prevents production bundles from
 * accepting arbitrary HTTP endpoints while making real read-only fork captures
 * reproducible for documentation work.
 */
export function assertLocalForkRpcUrl(value: string, label = "Local fork RPC URL"): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new Error(`${label} must point to localhost without credentials, query, or fragment`);
  }
  return parsed.toString().replace(/\/$/, '');
}

/**
 * Keep the runtime and CSP provider boundaries identical. Browser RPC keys
 * are public credentials, but they must never be sent to an unexpected host
 * because of a copied proxy URL, typo, or compromised build variable.
 */
export function assertAlchemyRpcUrl(
  value: string,
  chainId: FxChainId,
  label = "RPC URL",
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  if (parsed.hostname !== ALCHEMY_HOST_BY_CHAIN[chainId]) {
    throw new Error(`${label} must use the reviewed Alchemy host for chain ${chainId}`);
  }
  if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} cannot include credentials, a custom port, query, or fragment`);
  }
  if (!/^\/v2\/[^/]+\/?$/.test(parsed.pathname)) {
    throw new Error(`${label} must use an Alchemy /v2 application endpoint`);
  }
  return parsed.toString();
}

export function assertSupportedChainId(chainId: number): asserts chainId is FxChainId {
  if (chainId !== ETHEREUM_CHAIN_ID && chainId !== BASE_CHAIN_ID) {
    throw new Error(`Unsupported FxAeon chain ${chainId}; use Ethereum or Base`);
  }
}
