import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { OFFICIAL_FX_METHODS } from "../src/lib/fx/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCOPE_FILE = join(HERE, "..", "..", "..", "fx-scope.lock.json");

const EXPECTED_METHODS = [
  "getPositions",
  "increasePosition",
  "reducePosition",
  "adjustPositionLeverage",
  "depositAndMint",
  "repayAndWithdraw",
  "getBridgeQuote",
  "buildBridgeTx",
  "getFxSaveBalance",
  "getFxSaveConfig",
  "getFxSaveRedeemStatus",
  "getFxSaveClaimable",
  "getRedeemTx",
  "depositFxSave",
  "withdrawFxSave",
] as const;

test("the client exposes exactly the 15 official fx-sdk capabilities", () => {
  assert.deepEqual([...OFFICIAL_FX_METHODS], [...EXPECTED_METHODS]);
  assert.equal(new Set(OFFICIAL_FX_METHODS).size, EXPECTED_METHODS.length);
});

test("the checked-in scope lock agrees with the runtime capability contract", () => {
  const lock = JSON.parse(readFileSync(SCOPE_FILE, "utf8")) as {
    sdkPackage: string;
    sdkCommit: string;
    methods: string[];
  };
  assert.equal(lock.sdkPackage, "@aladdindao/fx-sdk@1.0.5");
  assert.equal(lock.sdkCommit, "53c0b9805a169e75ad375c92c241e1292b66405f");
  assert.deepEqual([...lock.methods].sort(), [...EXPECTED_METHODS].sort());
});
