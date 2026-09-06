import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const harness = readFileSync(new URL("./run_anvil_tests.mjs", import.meta.url), "utf8");
const browserProof = readFileSync(new URL("../apps/mini-app/e2e/fork/positions.browser.ts", import.meta.url), "utf8");

test("fork harness enables deterministic idle blocks for strict finality", () => {
  assert.match(harness, /ANVIL_BLOCK_TIME \?\? "1"/);
  assert.match(harness, /"--block-time", String\(blockTime\)/);
  assert.match(harness, /ANVIL_BLOCK_TIME must be a positive number/);
});

test("browser proof re-reviews interval-mined quote refreshes with a bounded retry", () => {
  assert.match(browserProof, /reviewAttempt < 3/);
  assert.match(browserProof, /Quote updated—review again\./);
  assert.match(browserProof, /firstSignatureObserved/);
  assert.match(browserProof, /Poll one non-rejecting state machine/);
  assert.doesNotMatch(browserProof, /const firstSignature = expect\.poll[\s\S]{0,500}Promise\.race/);
});
