#!/usr/bin/env node
/**
 * Verifies every address in packages/shared/src/addresses.ts has deployed
 * code on Ethereum mainnet. Intended for CI (needs ALCHEMY_RPC_URL or any
 * mainnet RPC via ETH_RPC_URL). Exits non-zero on any codeless address.
 */
import { readFileSync } from 'node:fs';

const RPC = process.env.ALCHEMY_RPC_URL || process.env.ETH_RPC_URL;
if (!RPC) {
  console.error('Set ALCHEMY_RPC_URL or ETH_RPC_URL');
  process.exit(2);
}

const src = readFileSync(new URL('../packages/shared/src/addresses.ts', import.meta.url), 'utf8');
const entries = [...src.matchAll(/([A-Z0-9_]+):\s*"(0x[0-9a-fA-F]{40})"/g)].map(m => [m[1], m[2]]);
if (entries.length === 0) {
  console.error('No addresses parsed — file moved?');
  process.exit(2);
}

// Native-asset sentinel (EIP-7528 style placeholder), intentionally has no code.
const NO_CODE_ALLOWLIST = new Set(['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'.toLowerCase()]);

let failed = 0;
for (const [name, addr] of entries) {
  if (NO_CODE_ALLOWLIST.has(addr.toLowerCase())) {
    console.log(`SKIP ${name} ${addr} (native asset sentinel)`);
    continue;
  }
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [addr, 'latest'] }),
  });
  const { result } = await res.json();
  const hasCode = typeof result === 'string' && result !== '0x';
  console.log(`${hasCode ? 'OK  ' : 'FAIL'} ${name} ${addr}`);
  if (!hasCode) failed++;
}
if (failed > 0) {
  console.error(`${failed} address(es) have no code on mainnet`);
  process.exit(1);
}
console.log(`All ${entries.length} addresses have code on mainnet.`);
