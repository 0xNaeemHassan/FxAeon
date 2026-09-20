import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const harness = readFileSync(new URL("./run_anvil_tests.mjs", import.meta.url), "utf8");
const browserProof = readFileSync(new URL("../apps/mini-app/e2e/fork/positions.browser.ts", import.meta.url), "utf8");
const protocolProof = readFileSync(new URL("../apps/mini-app/test/anvil.integration.test.ts", import.meta.url), "utf8");
const earnProof = readFileSync(new URL("../apps/mini-app/test/earn.anvil.test.ts", import.meta.url), "utf8");

test("fork harness enables deterministic idle blocks for strict finality", () => {
  assert.match(harness, /ANVIL_BLOCK_TIME \?\? "1"/);
  assert.match(harness, /"--block-time", String\(blockTime\)/);
  assert.match(harness, /ANVIL_BLOCK_TIME must be a positive number/);
});

test("fork proofs validate the configured base through Anvil metadata", () => {
  for (const proof of [browserProof, protocolProof, earnProof]) {
    assert.match(proof, /anvil_metadata/);
    assert.match(proof, /forkedNetwork\?\.forkBlockNumber/);
    assert.match(proof, /forkHead >= forkBlock/);
    assert.doesNotMatch(proof, /assert\.equal\(forkHead,\s*BigInt\(process\.env\.ANVIL_FORK_BLOCK/);
  }
});

test("browser proof retries changed direct actions with bounded revalidation", () => {
  assert.match(browserProof, /attempt < 3/);
  assert.match(browserProof, /Details changed\. Check the updated action before continuing\./);
  assert.match(browserProof, /firstSignatureObserved/);
  assert.match(browserProof, /driveDirectAction/);
  assert.match(browserProof, /readReviewedTransactions/);
  assert.match(browserProof, /read-only action details must never request a signature/);
  assert.match(browserProof, /target differs from action details/);
  assert.match(browserProof, /calldata differs from action details/);
  assert.match(browserProof, /actual signatures must match the reviewed transaction count/);
  assert.match(browserProof, /no later step may sign before this receipt is delivered/);
  assert.doesNotMatch(browserProof, /Quote updated—review again\./);
});

test("browser proof accepts honest partial-empty state only after exhaustive close proof", () => {
  const allClosed = browserProof.indexOf("assert.equal(closedPositions.length, scenarios.length");
  const partialState = browserProof.indexOf("const partialEmpty =", allClosed);
  assert.ok(allClosed >= 0 && partialState > allClosed, "partial-empty acceptance must follow every canonical close assertion");
  assert.match(browserProof, /normal ready-empty presentation/);
});
