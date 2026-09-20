/** Browser adapter for the optional same-origin Ethereum gas oracle. */

export interface EthereumGasFallbackSnapshot {
  source: "etherscan";
  chainId: 1;
  gasPriceWei: string;
  blockNumber?: string;
  fetchedAt: number;
  stale: boolean;
}

export interface EthereumGasFallbackOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Injectable clock for deterministic validation tests. */
  now?: () => number;
}

export const GAS_ORACLE_MAX_AGE_MS = 5 * 60_000;
export const GAS_ORACLE_MAX_FUTURE_MS = 60_000;
export const GAS_ORACLE_MAX_FAILURE_BACKOFF_MS = 5_000;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 10_000;
const MAX_GAS_PRICE_WEI = 1_000_000_000_000_000_000n;
const MAX_GAS_PRICE_DIGITS = 19;
const MAX_BLOCK_DIGITS = 16;

let inFlight: Promise<EthereumGasFallbackSnapshot> | undefined;
let failureUntil = 0;

export function resetEthereumGasFallbackForTests(): void {
  inFlight = undefined;
  failureUntil = 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshot(value: unknown, now: number): value is EthereumGasFallbackSnapshot {
  if (!isRecord(value)
    || value.source !== "etherscan"
    || value.chainId !== 1
    || typeof value.gasPriceWei !== "string"
    || value.gasPriceWei.length > MAX_GAS_PRICE_DIGITS
    || !/^\d+$/.test(value.gasPriceWei)
    || typeof value.fetchedAt !== "number"
    || !Number.isSafeInteger(value.fetchedAt)
    || value.fetchedAt > now + GAS_ORACLE_MAX_FUTURE_MS
    || value.fetchedAt < now - GAS_ORACLE_MAX_AGE_MS
    || typeof value.stale !== "boolean"
    || (value.blockNumber !== undefined
      && (typeof value.blockNumber !== "string"
        || value.blockNumber.length > MAX_BLOCK_DIGITS
        || !/^\d+$/.test(value.blockNumber)))) return false;
  try {
    return BigInt(value.gasPriceWei) > 0n && BigInt(value.gasPriceWei) <= MAX_GAS_PRICE_WEI;
  } catch {
    return false;
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const maxBytes = 16 * 1024;
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new Error("gas oracle response too large");
  if (!response.body) throw new Error("gas oracle response is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("gas oracle response too large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text) as unknown;
}

/**
 * Fetch only the reviewed relative route. No API key, chain, or upstream URL
 * is accepted from browser callers. A failed fallback stays an unavailable
 * fee and never becomes a zero value.
 */
export async function fetchEthereumGasFallback(
  options: EthereumGasFallbackOptions = {},
): Promise<EthereumGasFallbackSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const current = now();
  if (!Number.isSafeInteger(current) || current < 0) throw new Error("gas oracle clock is invalid");
  if (failureUntil > current) throw new Error("gas oracle temporarily unavailable");
  if (inFlight) return inFlight;
  const controller = new AbortController();
  const requestedTimeout = options.timeoutMs ?? 4_000;
  const timeoutMs = Number.isSafeInteger(requestedTimeout) && requestedTimeout >= MIN_TIMEOUT_MS
    ? Math.min(requestedTimeout, MAX_TIMEOUT_MS)
    : 4_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = (async (): Promise<EthereumGasFallbackSnapshot> => {
    try {
      const response = await fetchImpl("/api/gas", { method: "GET", redirect: "error", signal: controller.signal });
      if (!response.ok) throw new Error("gas oracle unavailable");
      const payload = await boundedJson(response);
      if (!isSnapshot(payload, now())) throw new Error("gas oracle returned invalid data");
      failureUntil = 0;
      return payload;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("gas oracle request timed out");
      failureUntil = now() + GAS_ORACLE_MAX_FAILURE_BACKOFF_MS;
      throw error instanceof Error ? error : new Error("gas oracle unavailable");
    }
  })();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      failureUntil = now() + GAS_ORACLE_MAX_FAILURE_BACKOFF_MS;
      reject(new Error("gas oracle request timed out"));
    }, timeoutMs);
  });
  const boundedRequest = Promise.race([request, deadline]);
  inFlight = boundedRequest;
  try {
    return await boundedRequest;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (inFlight === boundedRequest) inFlight = undefined;
  }
}
