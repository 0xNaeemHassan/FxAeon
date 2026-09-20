export type NativeMaxEstimate = {
  status: 'current' | 'partial' | 'unavailable';
  nativeValueWei: bigint;
  totalNativeCostWei?: bigint;
  totalNativeCostScope?: string;
  validUntil: number;
  fee?: { stale?: boolean };
};

export type NativeMaxCalculationOptions<Route> = {
  balanceWei: bigint;
  /** A valid entered amount gives RPC estimation a fundable starting point. */
  initialCandidateWei?: bigint;
  buildRoutes: (amountWei: bigint) => Promise<readonly Route[]>;
  estimateRoutes: (routes: readonly Route[]) => Promise<readonly NativeMaxEstimate[]>;
  now?: () => number;
  maxIterations?: number;
  isCurrent?: () => boolean;
};

class NativeMaxUnavailableError extends Error {
  constructor() {
    super('current gas estimate is unavailable for one or more routes');
    this.name = 'NativeMaxUnavailableError';
  }
}

function usableEstimate(estimate: NativeMaxEstimate, now: () => number): boolean {
  return estimate.status === 'current'
    && !estimate.fee?.stale
    && estimate.totalNativeCostScope === 'execution-plus-value'
    && estimate.totalNativeCostWei !== undefined
    && estimate.totalNativeCostWei >= estimate.nativeValueWei
    && estimate.validUntil > now();
}

async function reserveFor<Route>(
  amountWei: bigint,
  options: NativeMaxCalculationOptions<Route>,
  now: () => number,
): Promise<bigint> {
  const routes = await options.buildRoutes(amountWei);
  if (routes.length === 0) throw new Error('native max route is empty');
  const estimates = await options.estimateRoutes(routes);
  if (estimates.length !== routes.length || estimates.some((estimate) => !usableEstimate(estimate, now))) {
    throw new NativeMaxUnavailableError();
  }
  return estimates.reduce((max, estimate) => {
    const reserve = estimate.totalNativeCostWei! - estimate.nativeValueWei;
    return reserve > max ? reserve : max;
  }, 0n);
}

/**
 * Find a fundable native amount using only complete, fresh route estimates.
 * The returned value is verified against a final route build at that exact
 * amount; a merely close iteration is never presented as a 100% maximum.
 */
export async function calculateNativeMax<Route>(options: NativeMaxCalculationOptions<Route>): Promise<bigint> {
  if (!Number.isSafeInteger(options.maxIterations ?? 8) || (options.maxIterations ?? 8) < 2 || (options.maxIterations ?? 8) > 16) {
    throw new RangeError('native max iterations must be an integer between 2 and 16');
  }
  if (options.balanceWei < 0n) throw new RangeError('native max balance must be non-negative');
  if (options.balanceWei <= 0n) throw new Error('wallet balance does not cover the verified gas reserve');
  const now = options.now ?? Date.now;
  const assertCurrent = () => {
    if (options.isCurrent && !options.isCurrent()) throw new Error('native max request is stale');
  };
  const maxIterations = options.maxIterations ?? 8;
  const entered = options.initialCandidateWei !== undefined
    && options.initialCandidateWei > 0n
    && options.initialCandidateWei < options.balanceWei
    ? options.initialCandidateWei
    : options.balanceWei / 2n;
  let candidate = entered > 0n ? entered : 1n;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    assertCurrent();
    let reserve: bigint;
    try {
      reserve = await reserveFor(candidate, options, now);
      assertCurrent();
    } catch (error) {
      if (error instanceof NativeMaxUnavailableError) throw error;
      // An underfunded estimate is expected for an overly optimistic amount;
      // back off until the candidate is fundable. Other failures still fail
      // closed after the bounded attempts.
      if (candidate <= 1n) throw error;
      candidate = candidate / 2n;
      continue;
    }
    if (reserve >= options.balanceWei) {
      if (candidate <= 1n) throw new Error('wallet balance does not cover the verified gas reserve');
      candidate = candidate / 2n;
      continue;
    }
    const next = options.balanceWei - reserve;
    if (next === candidate) {
      // Re-read at the exact candidate and require the same result while the
      // estimates are still fresh. This catches changing gas and expiry.
      const finalReserve = await reserveFor(candidate, options, now);
      assertCurrent();
      if (finalReserve >= options.balanceWei || options.balanceWei - finalReserve !== candidate) {
        throw new Error('native max gas reserve did not converge');
      }
      return candidate;
    }
    candidate = next;
  }
  throw new Error('native max gas reserve did not converge');
}
