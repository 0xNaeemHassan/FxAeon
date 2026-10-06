import { getPublicClient } from "./clients";
import { normalizeFxProtocolError } from "./errorNormalization";
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
        failure: `${routeLabel}: ${normalizeFxProtocolError(
          cause,
          "This route could not be prepared. Check the inputs and try again.",
          route.operation,
        )}`,
      };
    }
  }));

  return {
    viable: outcomes.flatMap((outcome) => "route" in outcome && outcome.route ? [outcome.route] : []),
    failures: outcomes.flatMap((outcome) => "failure" in outcome && outcome.failure ? [outcome.failure] : []),
  };
}
