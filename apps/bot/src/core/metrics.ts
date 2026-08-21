/**
 * In-process metrics (W-15) — counters, latency summaries, worker heartbeats.
 *
 * Deliberately minimal: the bot runs as a single Render instance, so
 * in-memory metrics surfaced via /health and the daily SLO digest cover the
 * observability need without a metrics stack (cost ceiling W-22).
 * Everything resets on restart — that is acceptable and documented.
 */

const MAX_SAMPLES = 500;

/**
 * Workers that main.ts always starts. Keep one canonical registry for the
 * health endpoint and operator digest so a newly added poller cannot silently
 * disappear from one of those views.
 */
export const REQUIRED_WORKERS = [
  "health-monitor",
  "limit-order-poller",
  "price-alert-poller",
  "automation-poller",
  "arb-poller",
  "deposit-watcher-poller",
] as const;

/** Longest interval is five minutes; two missed cycles is an alert. */
export const WORKER_STALE_SECONDS = 11 * 60;
/** Startup is delayed five seconds and the slowest worker first runs at 5m. */
export const WORKER_STARTUP_GRACE_SECONDS = WORKER_STALE_SECONDS;

export type WorkerStatus = "starting" | "healthy" | "stale" | "not-started";

/** Pure classification used by health responses and unit tests. */
export function classifyWorkerStatus(
  secondsSinceHeartbeat: number | null,
  uptimeSeconds: number
): WorkerStatus {
  if (secondsSinceHeartbeat === null) {
    return uptimeSeconds <= WORKER_STARTUP_GRACE_SECONDS ? "starting" : "not-started";
  }
  return secondsSinceHeartbeat > WORKER_STALE_SECONDS ? "stale" : "healthy";
}

const counters = new Map<string, number>();
const timings = new Map<string, number[]>();
const heartbeats = new Map<string, number>();
const startedAt = Date.now();

export function incr(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

/** Record a duration sample (ms). Keeps the most recent MAX_SAMPLES. */
export function observe(name: string, ms: number): void {
  let arr = timings.get(name);
  if (!arr) {
    arr = [];
    timings.set(name, arr);
  }
  arr.push(ms);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

/** Mark a background worker as alive right now. */
export function heartbeat(worker: string): void {
  heartbeats.set(worker, Date.now());
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface TimingSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  counters: Record<string, number>;
  timings: Record<string, TimingSummary>;
  /** Seconds since each worker's last heartbeat (null = never beat). */
  workers: Record<string, number | null>;
}

export function snapshot(knownWorkers: string[] = []): MetricsSnapshot {
  const timingOut: Record<string, TimingSummary> = {};
  for (const [name, arr] of timings) {
    const sorted = [...arr].sort((a, b) => a - b);
    timingOut[name] = {
      count: arr.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1] ?? 0,
    };
  }
  const workers: Record<string, number | null> = {};
  for (const w of new Set([...knownWorkers, ...heartbeats.keys()])) {
    const last = heartbeats.get(w);
    workers[w] = last === undefined ? null : Math.round((Date.now() - last) / 1000);
  }
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    counters: Object.fromEntries(counters),
    timings: timingOut,
    workers,
  };
}

/** Test hook. */
export function __resetMetrics(): void {
  counters.clear();
  timings.clear();
  heartbeats.clear();
}
