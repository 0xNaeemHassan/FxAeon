import { getPublicClient } from "./clients";
import { defaultTransactionPolicy } from "./policy";
import { simulatePlannedRoute } from "./runner";
import type { FxPublicClient, PlannedRoute } from "./types";
import { validateRoute } from "./validation";

export interface PreparedReviewRoutes {
  viable: PlannedRoute[];
  failures: string[];
}

/**
 * Validate and simulate independent SDK alternatives concurrently. Route
 * order is preserved so the SDK remains the authority for presentation.
 */
export async function prepareRoutesForReview(
  routes: readonly PlannedRoute[],
  expectedWalletAddress: string,
  resolveClient: (chainId: PlannedRoute["chainId"]) => FxPublicClient = getPublicClient,
): Promise<PreparedReviewRoutes> {
  const walletAddress = expectedWalletAddress.toLowerCase();
  for (const route of routes) {
    if (route.walletAddress.toLowerCase() !== walletAddress) {
      throw new Error("The prepared route is not bound to the selected wallet.");
    }
  }

  const outcomes = await Promise.all(routes.map(async (route) => {
    const routeLabel = route.details?.routeType ?? "route";
    try {
      validateRoute(route, defaultTransactionPolicy(route));
      const simulation = await simulatePlannedRoute(route, resolveClient(route.chainId));
      return simulation.success
        ? { route }
        : { failure: `${routeLabel}: ${simulation.error}` };
    } catch (cause) {
      return {
        failure: `${routeLabel}: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }));

  return {
    viable: outcomes.flatMap((outcome) => "route" in outcome && outcome.route ? [outcome.route] : []),
    failures: outcomes.flatMap((outcome) => "failure" in outcome && outcome.failure ? [outcome.failure] : []),
  };
}

function canonicalReviewValue(value: unknown): string {
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalReviewValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalReviewValue(nested)}`)
    .join(",")}}`;
}

/**
 * Strict equality for everything the review binds: wallet/chain authority,
 * ordered transaction calldata/value/nonce, policy, and quote/details.
 */
export function routesMatchForSigning(left: PlannedRoute, right: PlannedRoute): boolean {
  return canonicalReviewValue(left) === canonicalReviewValue(right);
}

/** Pick the rebuilt form of the route the user selected without inventing order. */
export function selectRefreshedRoute(
  reviewedRoute: PlannedRoute,
  rebuiltRoutes: readonly PlannedRoute[],
  reviewedIndex: number,
): PlannedRoute {
  if (!rebuiltRoutes.length) throw new Error("No executable transaction route was returned.");

  const exact = rebuiltRoutes.find((candidate) => routesMatchForSigning(reviewedRoute, candidate));
  if (exact) return exact;

  const routeType = reviewedRoute.details?.routeType;
  if (routeType) {
    const sameType = rebuiltRoutes.filter((candidate) => candidate.details?.routeType === routeType);
    if (sameType.length === 1) return sameType[0];
  }

  return rebuiltRoutes[Math.min(Math.max(reviewedIndex, 0), rebuiltRoutes.length - 1)];
}
