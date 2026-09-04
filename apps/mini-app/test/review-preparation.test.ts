import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import {
  prepareRoutesForReview,
  routesMatchForSigning,
  selectRefreshedRoute,
} from "../src/lib/fx/reviewPreparation";
import type { FxPublicClient, PlannedRoute, TransactionPolicy } from "../src/lib/fx/types";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const DESTINATION = "0x2222222222222222222222222222222222222222" as Address;
const POLICY: TransactionPolicy = {
  walletAddress: WALLET,
  chainId: 1,
  allowedDestinations: [DESTINATION],
  allowedSelectors: { [DESTINATION.toLowerCase()]: ["0x12345678"] },
};

function route(routeType: string, nonce = 4, data = "0x12345678"): PlannedRoute {
  return {
    operation: "increasePosition",
    chainId: 1,
    walletAddress: WALLET,
    transactions: [{
      chainId: 1,
      from: WALLET,
      to: DESTINATION,
      data: data as `0x${string}`,
      value: 0n,
      nonce,
      kind: "action",
      operation: "increasePosition",
    }],
    details: { routeType, minOut: "100" },
    policy: POLICY,
  };
}

test("review simulations start concurrently and preserve SDK route order", async () => {
  let started = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = {
    chain: { id: 1 },
    simulateCalls: async () => {
      started += 1;
      await gate;
      return { results: [{ status: "success" }] };
    },
  } as unknown as FxPublicClient;

  const pending = prepareRoutesForReview(
    [route("first"), route("second")],
    WALLET,
    () => client,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(started, 2, "both RPC simulations should begin before either completes");
  release?.();

  const prepared = await pending;
  assert.deepEqual(prepared.viable.map((candidate) => candidate.details?.routeType), ["first", "second"]);
  assert.deepEqual(prepared.failures, []);
});

test("signing equality detects calldata, nonce, and economic limit changes", () => {
  const reviewed = route("native");
  assert.equal(routesMatchForSigning(reviewed, route("native")), true);
  assert.equal(routesMatchForSigning(reviewed, route("native", 5)), false);
  assert.equal(routesMatchForSigning(reviewed, route("native", 4, "0x12345679")), false);
  assert.equal(routesMatchForSigning(reviewed, { ...route("native"), details: { routeType: "native", minOut: "99" } }), false);
});

test("refresh keeps the selected route type when quote fields change", () => {
  const reviewed = route("second");
  const rebuilt = [
    { ...route("first"), details: { routeType: "first", minOut: "98" } },
    { ...route("second"), details: { routeType: "second", minOut: "97" } },
  ];
  assert.equal(selectRefreshedRoute(reviewed, rebuilt, 1), rebuilt[1]);
});
