/**
 * Narrow, read-only Ethereum gas oracle for the static Pages application.
 *
 * This route deliberately accepts no user supplied upstream parameters. The
 * Etherscan key is read only from the Pages secret binding and is never part
 * of a response, error, or log message.
 */

export interface GasFunctionEnv {
  ETHERSCAN_API_KEY?: string;
}

export interface PagesFunctionContext<Env> {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type PagesFunction<Env> = (
  context: PagesFunctionContext<Env>,
) => Response | Promise<Response>;

export const ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api";
export const ETHEREUM_CHAIN_ID = "1";
export const REQUEST_TIMEOUT_MS = 4_000;
export const MAX_RESPONSE_BYTES = 16 * 1024;
export const CACHE_TTL_MS = 15_000;
export const STALE_MAX_AGE_MS = 60_000;
/** Keep malformed upstream numbers from forcing huge bigint allocations. */
export const MAX_GAS_PRICE_WEI = 1_000_000_000_000_000_000n;
export const MAX_GAS_PRICE_WHOLE_DIGITS = 12;
export const MAX_BLOCK_DIGITS = 16;
export const FAILURE_BACKOFF_MS = 5_000;
export const MAX_API_KEY_LENGTH = 256;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 10_000;

type GasOracleFailureCode = "binding_missing" | "binding_invalid" | "upstream_timeout"
  | "upstream_fetch_failed" | "upstream_auth_failed" | "upstream_http_failed"
  | "upstream_response_invalid" | "upstream_payload_rejected" | "upstream_gas_price_invalid"
  | "upstream_timestamp_invalid" | "internal_failure";

class GasOracleFailure extends Error {
  constructor(readonly code: GasOracleFailureCode, message: string) {
    super(message);
    this.name = "GasOracleFailure";
  }
}

const LOG_SUPPRESSION_MS = FAILURE_BACKOFF_MS;
const lastFailureLogAt = new Map<GasOracleFailureCode, number>();

/** Emit only a fixed allowlisted category, at most once per backoff window. */
function logGasOracleFailure(code: GasOracleFailureCode): void {
  const now = Date.now();
  const previous = lastFailureLogAt.get(code);
  if (previous !== undefined && now - previous < LOG_SUPPRESSION_MS) return;
  lastFailureLogAt.set(code, now);
  console.warn(`[gas-oracle] ${code}`);
}

function failureCode(error: unknown): GasOracleFailureCode {
  return error instanceof GasOracleFailure ? error.code : "internal_failure";
}

interface GasOracleResult {
  LastBlock?: unknown;
  ProposeGasPrice?: unknown;
  SafeGasPrice?: unknown;
  FastGasPrice?: unknown;
}

export interface EthereumGasSnapshot {
  source: "etherscan";
  chainId: 1;
  gasPriceWei: string;
  blockNumber?: string;
  fetchedAt: number;
  stale: boolean;
}

interface CacheEntry {
  snapshot: EthereumGasSnapshot;
  expiresAt: number;
  staleUntil: number;
}

export interface EtherscanGasFetchOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cache?: boolean;
}

let cacheEntry: CacheEntry | undefined;
let inFlight: Promise<EthereumGasSnapshot> | undefined;
let failureUntil = 0;
let failureError: Error | undefined;
let cacheGeneration = 0;

/** Reset only the module cache; useful to keep contract tests independent. */
export function resetGasOracleCacheForTests(): void {
  cacheGeneration += 1;
  cacheEntry = undefined;
  inFlight = undefined;
  failureUntil = 0;
  failureError = undefined;
  lastFailureLogAt.clear();
}

function parseDecimalGwei(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,9})?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  if (whole.length > MAX_GAS_PRICE_WHOLE_DIGITS) return undefined;
  const wei = BigInt(whole) * 1_000_000_000n
    + BigInt((fraction + "000000000").slice(0, 9));
  return wei > 0n && wei <= MAX_GAS_PRICE_WEI ? wei : undefined;
}

function parseBlock(value: unknown): string | undefined {
  if (typeof value !== "string" || !new RegExp(`^\\d{1,${MAX_BLOCK_DIGITS}}$`).test(value)) return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function queryIsAllowed(request: Request): boolean {
  const url = new URL(request.url);
  // The browser adapter uses exactly this relative path. Reject all query
  // parameters so this endpoint remains a fixed Ethereum oracle and cannot
  // grow an accidental forwarding surface.
  return [...url.searchParams.keys()].length === 0;
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new GasOracleFailure("upstream_response_invalid", "upstream response too large");
  }
  // Pages' upstream Response streams are not guaranteed to expose the same
  // reader lifecycle as browser streams. Read the small, fixed oracle payload
  // through the portable Response.text() contract and enforce the byte bound
  // after decoding as a second line of defence when Content-Length is absent.
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new GasOracleFailure("upstream_response_invalid", "upstream response too large");
  }
  return text;
}

function timeoutError(): Error {
  return new GasOracleFailure("upstream_timeout", "upstream request timed out");
}

async function requestUpstream(
  apiKey: string,
  options: Required<Pick<EtherscanGasFetchOptions, "fetchImpl" | "now" | "timeoutMs">>,
): Promise<EthereumGasSnapshot> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError());
      reject(timeoutError());
    }, options.timeoutMs);
  });
  const request = (async (): Promise<EthereumGasSnapshot> => {
    const upstream = new URL(ETHERSCAN_API_URL);
    upstream.searchParams.set("chainid", ETHEREUM_CHAIN_ID);
    upstream.searchParams.set("module", "gastracker");
    upstream.searchParams.set("action", "gasoracle");
    upstream.searchParams.set("apikey", apiKey);
    let response: Response;
    try {
      // Cloudflare Workerd requires the global fetch function to be called
      // unbound. Calling it as `options.fetchImpl(...)` sets `this` to options
      // and fails with an Illegal invocation error in production.
      const fetchImpl = options.fetchImpl;
      response = await fetchImpl(upstream, { method: "GET", redirect: "manual", signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError();
      throw new GasOracleFailure("upstream_fetch_failed", "upstream request failed");
    }
    if (!response.ok) throw new GasOracleFailure(
      response.status === 401 || response.status === 403 ? "upstream_auth_failed" : "upstream_http_failed",
      "upstream returned an HTTP error",
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES)) as unknown;
    } catch (error) {
      if (error instanceof GasOracleFailure) throw error;
      throw new GasOracleFailure("upstream_response_invalid", "upstream returned invalid data");
    }
    if (!isRecord(parsed) || parsed.status !== "1" || !isRecord(parsed.result)) {
      const upstreamText = [parsed && isRecord(parsed) ? parsed.message : null,
        parsed && isRecord(parsed) ? parsed.result : null]
        .filter((value): value is string => typeof value === "string")
        .join(" ").toLowerCase();
      if (/invalid\s+api\s+key|api\s+key\s+(?:is\s+)?(?:missing|invalid)|missing\s+api\s+key/.test(upstreamText)) {
        throw new GasOracleFailure("upstream_auth_failed", "upstream rejected its credential");
      }
      throw new GasOracleFailure("upstream_payload_rejected", "upstream returned no gas data");
    }
    const result = parsed.result as GasOracleResult;
    const gasPriceWei = parseDecimalGwei(result.ProposeGasPrice)
      ?? parseDecimalGwei(result.SafeGasPrice);
    if (gasPriceWei === undefined) throw new GasOracleFailure("upstream_gas_price_invalid", "upstream returned an invalid gas price");
    const fetchedAt = options.now();
    if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) throw new GasOracleFailure("upstream_timestamp_invalid", "upstream returned an invalid timestamp");
    const blockNumber = parseBlock(result.LastBlock);
    return {
      source: "etherscan",
      chainId: 1,
      gasPriceWei: gasPriceWei.toString(),
      ...(blockNumber === undefined ? {} : { blockNumber }),
      fetchedAt,
      stale: false,
    };
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function fetchEtherscanGasOracle(
  apiKey: string | undefined,
  options: EtherscanGasFetchOptions = {},
): Promise<EthereumGasSnapshot> {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) throw new GasOracleFailure("binding_missing", "Etherscan gas oracle is not configured");
  if (key.length > MAX_API_KEY_LENGTH) throw new GasOracleFailure("binding_invalid", "Etherscan gas oracle binding is invalid");
  const requestedTimeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const resolved = {
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? Date.now,
    timeoutMs: Number.isSafeInteger(requestedTimeout) && requestedTimeout >= MIN_TIMEOUT_MS
      ? Math.min(requestedTimeout, MAX_TIMEOUT_MS)
      : REQUEST_TIMEOUT_MS,
  };
  const useCache = options.cache ?? true;
  const now = resolved.now();
  if (useCache && cacheEntry && cacheEntry.expiresAt > now) return cacheEntry.snapshot;
  if (useCache && failureUntil > now) {
    if (cacheEntry && cacheEntry.staleUntil > now) return { ...cacheEntry.snapshot, stale: true };
    throw failureError ?? new Error("gas oracle temporarily unavailable");
  }
  if (useCache && inFlight) return inFlight;
  const generation = cacheGeneration;
  const request = requestUpstream(key, resolved).then((snapshot) => {
    if (useCache && generation === cacheGeneration) {
      cacheEntry = {
        snapshot,
        expiresAt: snapshot.fetchedAt + CACHE_TTL_MS,
        staleUntil: snapshot.fetchedAt + STALE_MAX_AGE_MS,
      };
      failureUntil = 0;
      failureError = undefined;
    }
    return snapshot;
  });
  if (!useCache) return request;
  inFlight = request;
  try {
    return await request;
  } catch (error) {
    if (useCache && generation === cacheGeneration) {
      failureUntil = resolved.now() + FAILURE_BACKOFF_MS;
      failureError = error instanceof Error ? error : new Error("gas oracle unavailable");
    }
    if (cacheEntry && cacheEntry.staleUntil > resolved.now()) {
      return { ...cacheEntry.snapshot, stale: true };
    }
    throw error;
  } finally {
    if (inFlight === request) inFlight = undefined;
  }
}

export const onRequestGet: PagesFunction<GasFunctionEnv> = async ({ request, env }) => {
  try {
    if (!queryIsAllowed(request)) return jsonResponse({ error: "unsupported query" }, 400);
    const rawKey: unknown = env?.ETHERSCAN_API_KEY;
    if (rawKey === undefined || rawKey === null || rawKey === "") {
      logGasOracleFailure("binding_missing");
      return jsonResponse({ error: "gas oracle unavailable" }, 503);
    }
    if (typeof rawKey !== "string") {
      logGasOracleFailure("binding_invalid");
      return jsonResponse({ error: "gas oracle unavailable" }, 503);
    }
    const apiKey = rawKey.trim();
    if (!apiKey) {
      logGasOracleFailure("binding_missing");
      return jsonResponse({ error: "gas oracle unavailable" }, 503);
    }
    if (apiKey.length > MAX_API_KEY_LENGTH) {
      logGasOracleFailure("binding_invalid");
      return jsonResponse({ error: "gas oracle unavailable" }, 503);
    }
    const snapshot = await fetchEtherscanGasOracle(apiKey);
    return jsonResponse(snapshot);
  } catch (error) {
    logGasOracleFailure(failureCode(error));
    if (cacheEntry && cacheEntry.staleUntil > Date.now()) {
      return jsonResponse({ ...cacheEntry.snapshot, stale: true });
    }
    // Cloudflare Pages reserves 502/504 for its own gateway errors and can
    // replace those response bodies with a plain-text error page. Keep this
    // optional upstream failure inside the JSON API contract with 503 so the
    // browser can reliably select its bounded RPC fallback.
    return jsonResponse({ error: error instanceof Error && error.message.includes("timed out")
      ? "gas oracle timed out"
      : "gas oracle unavailable" }, 503);
  }
};

export const onRequest: PagesFunction<GasFunctionEnv> = async ({ request, env }) => {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET" } });
  }
  // Keep an unexpected platform/runtime failure inside the JSON contract. The
  // browser can then use its bounded RPC fallback instead of receiving a
  // provider-generated HTML/plain-text 502 response.
  try {
    return await onRequestGet({ request, env });
  } catch {
    return jsonResponse({ error: "gas oracle unavailable" }, 503);
  }
};
