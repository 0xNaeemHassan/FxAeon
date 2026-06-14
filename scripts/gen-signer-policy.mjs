#!/usr/bin/env node
/**
 * Generate apps/bot/policy/signer.policy.json from the verified ADDRESSES
 * registry (packages/shared/src/addresses.ts) so the declarative policy
 * artifact can never drift from the code-enforced allow-list.
 *
 * The bot's signer policy (apps/bot/src/core/signerPolicy.ts) derives its
 * enforced allow-list from ADDRESSES at runtime; this file mirrors it for
 * documentation, review and CI diffing. A unit test asserts they match.
 *
 *   node scripts/gen-signer-policy.mjs           # write
 *   node scripts/gen-signer-policy.mjs --check    # verify up-to-date (CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ADDRESSES_TS = join(ROOT, "packages/shared/src/addresses.ts");
const OUT = join(ROOT, "apps/bot/policy/signer.policy.json");

// Parse the ADDRESSES object out of the source-of-truth TS file without a build.
function parseAddresses() {
  const src = readFileSync(ADDRESSES_TS, "utf8");
  const block = src.match(/export const ADDRESSES = \{([\s\S]*?)\n\} as const;/);
  if (!block) throw new Error("could not locate ADDRESSES object in addresses.ts");
  const entries = {};
  const re = /^\s*([A-Z0-9_]+):\s*"(0x[0-9a-fA-F]{40})"/gm;
  let m;
  while ((m = re.exec(block[1])) !== null) entries[m[1]] = m[2];
  if (Object.keys(entries).length === 0) throw new Error("parsed zero addresses");
  return entries;
}

function build() {
  const addresses = parseAddresses();
  const allowedTargets = Object.entries(addresses)
    .map(([label, address]) => ({ label, address: address.toLowerCase() }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return {
    $schema: "./signer.policy.schema.json",
    version: 1,
    chainId: 1,
    description:
      "Broadcast allow-list for the bot's session signer. Enforced in " +
      "apps/bot/src/core/signerPolicy.ts (mode: SIGNER_POLICY_MODE). Generated " +
      "from packages/shared/src/addresses.ts — do not edit by hand; run " +
      "`node scripts/gen-signer-policy.mjs`.",
    rules: {
      // tx.to must be one of allowedTargets.
      allowedTargetsOnly: true,
      // ERC20 approve/increaseAllowance spender must be a target or the user's wallet.
      erc20: {
        approve: "0x095ea7b3",
        increaseAllowance: "0x39509351",
        transfer: "0xa9059cbb",
        transferFrom: "0x23b872dd",
        spenderMustBeAllowed: true,
        recipientMustBeAllowed: true,
      },
    },
    allowedTargets,
  };
}

const generated = JSON.stringify(build(), null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    /* missing */
  }
  if (current !== generated) {
    console.error(
      "signer.policy.json is stale. Run: node scripts/gen-signer-policy.mjs"
    );
    process.exit(1);
  }
  console.log("signer.policy.json is up to date.");
} else {
  writeFileSync(OUT, generated);
  console.log(`wrote ${OUT}`);
}
