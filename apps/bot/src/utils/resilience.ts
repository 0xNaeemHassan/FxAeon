/**
 * Resilience primitives for external calls (W-12).
 *
 * Every outbound dependency (Telegram Bot API, fx limit-order relay, RPC,
 * Privy) must go through timeout + retry-with-jitter and, for recurring
 * background work, a circuit breaker — one flaky upstream must never wedge a
 * worker loop or pile up unbounded promises. See docs/external-apis.md.
 */

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOpts {
  attempts?: number;
  baseDelayMs?: number;
  /** Errors matching this predicate are NOT retried (e.g. 4xx). */
  isFatal?: (err: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (opts.isFatal?.(err)) throw err;
      lastError = err;
      if (attempt < attempts) {
        const jitter = Math.floor(Math.random() * base * 0.5);
        await new Promise((r) => setTimeout(r, attempt * base + jitter));
      }
    }
  }
  throw lastError;
}

export type BreakerState = "closed" | "open" | "half-open";

/**
 * Minimal circuit breaker: opens after `failureThreshold` consecutive
 * failures, stays open for `cooldownMs`, then lets one probe through
 * (half-open). A probe success closes it; a probe failure re-opens it.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private probing = false;

  constructor(
    readonly name: string,
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 60_000
  ) {}

  get state(): BreakerState {
    if (this.failures < this.failureThreshold) return "closed";
    if (Date.now() - this.openedAt >= this.cooldownMs) return "half-open";
    return "open";
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === "open") {
      throw new Error(`circuit '${this.name}' is open — skipping call`);
    }
    if (state === "half-open") {
      if (this.probing) throw new Error(`circuit '${this.name}' is half-open — probe in flight`);
      this.probing = true;
    }
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      this.failures++;
      if (this.failures >= this.failureThreshold) this.openedAt = Date.now();
      throw err;
    } finally {
      this.probing = false;
    }
  }

  /** Test hook. */
  __reset(): void {
    this.failures = 0;
    this.openedAt = 0;
    this.probing = false;
  }
}
