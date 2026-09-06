import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const harness = readFileSync(new URL("./run_anvil_tests.mjs", import.meta.url), "utf8");

test("fork harness enables deterministic idle blocks for strict finality", () => {
  assert.match(harness, /ANVIL_BLOCK_TIME \?\? "1"/);
  assert.match(harness, /"--block-time", String\(blockTime\)/);
  assert.match(harness, /ANVIL_BLOCK_TIME must be a positive number/);
});
