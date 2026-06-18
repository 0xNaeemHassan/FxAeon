/**
 * Anvil MAINNET-FORK integration test for the bot's money path (Phase 4).
 *
 * tests/tx-executor.test.ts mocks the chain + Privy and notes: "the live-fork
 * pass is Phase 4 (Anvil)". This is that pass. It exercises the EXACT sanctioned
 * broadcast path — `executeRoute` in src/core/txExecutor.ts — end to end against
 * a real Ethereum mainnet state served by an Anvil fork:
 *
 *   idempotency  →  signer-policy allow-list  →  eth_simulateV1 (fail-closed)
 *     →  EIP-1559 fees from real feeHistory  →  broadcast  →  receipt watch
 *
 * What is REAL here (vs the unit test):
 *   - The viem PublicClient talks to the fork: simulateCalls (eth_simulateV1),
 *     getFeeHistory, getTransactionCount and getTransactionReceipt are real RPC.
 *   - simulateRoute, signerPolicy, fees, txState and broadcast.ts are the real
 *     production modules — nothing in the money path is stubbed.
 *   - Transactions are actually signed and mined: the happy path moves real
 *     WETH on the fork and we read the resulting balance back from chain state.
 *
 * What is substituted (and only this):
 *   - `@fxbot/db` prisma  → an in-memory TxRecord store, so idempotency and the
 *     persisted state machine behave exactly as in prod without a database.
 *   - `src/core/privy.js`  → the broadcast seam signs+sends with a funded Anvil
 *     dev key instead of calling Privy's hosted wallet API. broadcast.ts itself
 *     (the real send logic) is untouched.
 *
 * The suite self-skips (green) when no fork is reachable. See globalSetup.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  parseEther,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { ADDRESSES } from "@fxbot/shared";

// ── Fork discovery: probe at collection time so describe.skipIf can react ────
const RPC = process.env.FORK_RPC_URL || "http://127.0.0.1:8545";

async function probeChainId(url: string, timeoutMs = 3_000): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: ctrl.signal,
    });
    const json = (await res.json()) as { result?: string };
    return json.result ? Number(BigInt(json.result)) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Top-level await is supported in vitest ESM test files.
const FORK_CHAIN_ID = await probeChainId(RPC);
const FORK_UP = FORK_CHAIN_ID === 1;
if (!FORK_UP) {
  // eslint-disable-next-line no-console
  console.warn(
    `[fork] no mainnet fork at ${RPC} (chainId=${FORK_CHAIN_ID ?? "unreachable"}). ` +
      "Skipping money-path fork suite. Start anvil --fork-url <rpc> --port 8545 to run it."
  );
}

// The signer policy must be ENFORCING for the allow-list assertions to mean
// anything. Pin it before the modules under test read it.
process.env.SIGNER_POLICY_MODE = "enforce";

// ── In-memory prisma (real idempotency + state machine, no database) ─────────
const { txStore, prismaMock } = vi.hoisted(() => {
  interface Rec {
    id: string;
    idempotencyKey: string;
    status: string;
    type: string;
    userId: string;
    hash: string | null;
    data: unknown;
  }
  const store = new Map<string, Rec>();
  let seq = 0;
  const prisma = {
    txRecord: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
        if (where.idempotencyKey)
          return [...store.values()].find((r) => r.idempotencyKey === where.idempotencyKey) ?? null;
        if (where.id) return store.get(where.id) ?? null;
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<Rec, "id"> }) => {
        const id = `rec-${++seq}`;
        const rec = { id, ...data } as Rec;
        store.set(id, rec);
        return rec;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Rec> }) => {
        const rec = store.get(where.id);
        if (!rec) throw new Error(`txRecord ${where.id} not found`);
        Object.assign(rec, data);
        return rec;
      }),
    },
  };
  return { txStore: store, prismaMock: prisma };
});

vi.mock("@fxbot/db", () => ({ prisma: prismaMock, Prisma: {} }));

// ── Privy broadcast seam → sign + send with a funded Anvil dev key ───────────
// broadcast.ts (the real send logic) imports these two from core/privy.js. We
// replace ONLY the hosted-wallet calls; the EIP-1559 tx object broadcast.ts
// builds (nonce/gas/fees/type/chainId) flows straight through to the fork.
const { sendMock, signMock } = vi.hoisted(() => ({ sendMock: vi.fn(), signMock: vi.fn() }));
vi.mock("../../src/core/privy.js", () => ({
  sendWalletTransaction: (...a: unknown[]) => sendMock(...a),
  signWalletTransaction: (...a: unknown[]) => signMock(...a),
}));

// Imported AFTER the mocks above are registered (vi.mock is hoisted regardless,
// but keep the intent explicit).
import { executeRoute } from "../../src/core/txExecutor.js";
import { getEip1559Fees, MIN_PRIORITY_FEE_WEI, MAX_PRIORITY_FEE_WEI } from "../../src/core/fees.js";
import type { TradeTx } from "../../src/fx/index.js";

// Anvil's deterministic dev account #0 — funded with 10,000 ETH on every fork.
const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const WALLET_ADDRESS = ACCOUNT.address as `0x${string}`;

const WETH = ADDRESSES.WETH as `0x${string}`;
const WETH_ABI = parseAbi([
  "function deposit() payable",
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

const deposit = (value: bigint): TradeTx => ({
  to: WETH,
  data: encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" }),
  value,
});
const transfer = (to: `0x${string}`, amount: bigint): TradeTx => ({
  to: WETH,
  data: encodeFunctionData({ abi: WETH_ABI, functionName: "transfer", args: [to, amount] }),
  value: 0n,
});

let client: PublicClient;
let walletClient: WalletClient;

function baseParams(idempotencyKey: string, txs: TradeTx[], type = "open_long") {
  return {
    userId: "fork-user",
    walletId: "fork-wallet",
    walletAddress: WALLET_ADDRESS,
    idempotencyKey,
    txs,
    type,
    client,
    // Auto-mining anvil confirms instantly; poll fast with a generous ceiling.
    watch: { pollMs: 250, timeoutMs: 60_000 },
  };
}

const wethBalance = (addr: `0x${string}`) =>
  client.readContract({ address: WETH, abi: WETH_ABI, functionName: "balanceOf", args: [addr] });

describe.skipIf(!FORK_UP)("bot money path — Anvil mainnet fork", () => {
  beforeAll(() => {
    client = createPublicClient({ chain: mainnet, transport: http(RPC) });
    walletClient = createWalletClient({ account: ACCOUNT, chain: mainnet, transport: http(RPC) });

    // The Privy seam: forward the tx broadcast.ts built straight to the fork,
    // signed by the funded dev key. Returns { hash } like the real client.
    sendMock.mockImplementation(
      async (
        _walletId: string,
        tx: {
          to: `0x${string}`;
          data?: `0x${string}`;
          value?: `0x${string}`;
          nonce?: `0x${string}`;
          gasLimit: `0x${string}`;
          maxFeePerGas: `0x${string}`;
          maxPriorityFeePerGas: `0x${string}`;
        }
      ) => {
        const hash = await walletClient.sendTransaction({
          account: ACCOUNT,
          chain: mainnet,
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : 0n,
          gas: BigInt(tx.gasLimit),
          maxFeePerGas: BigInt(tx.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
          nonce: tx.nonce !== undefined ? Number(BigInt(tx.nonce)) : undefined,
        });
        return { hash };
      }
    );
    // Not exercised by the mev="off" money path; fail loudly if a test reaches it.
    signMock.mockRejectedValue(new Error("signWalletTransaction unexpected on the fork path"));
  });

  beforeEach(() => {
    txStore.clear();
    sendMock.mockClear();
  });

  it("is a real Ethereum mainnet fork (chainId 1)", async () => {
    expect(await client.getChainId()).toBe(1);
    const block = await client.getBlockNumber();
    expect(block).toBeGreaterThan(20_000_000n);
  });

  it("every f(x) registry target the money path touches has live bytecode", async () => {
    // These are the contracts a real open-position route resolves to; the signer
    // policy allow-list is DERIVED from this registry, so 'has code on mainnet'
    // is the ground truth behind the allow-list.
    for (const key of ["WETH", "ROUTER", "FX_MINT_ROUTER", "FXUSD", "LIMIT_ORDER_MANAGER"] as const) {
      const code = await client.getCode({ address: ADDRESSES[key] as `0x${string}` });
      expect(code, `${key} ${ADDRESSES[key]} should have bytecode`).toBeTruthy();
      expect(code).not.toBe("0x");
    }
  });

  it("derives clamped EIP-1559 fees from the fork's real feeHistory", async () => {
    const fees = await getEip1559Fees(client);
    expect(fees.maxPriorityFeePerGas).toBeGreaterThanOrEqual(MIN_PRIORITY_FEE_WEI);
    expect(fees.maxPriorityFeePerGas).toBeLessThanOrEqual(MAX_PRIORITY_FEE_WEI);
    expect(fees.maxFeePerGas).toBeGreaterThan(fees.maxPriorityFeePerGas);
    expect(fees.maxFeePerGas).toBeGreaterThanOrEqual(fees.nextBaseFee);
  });

  it("HAPPY PATH: policy → simulate → fees → broadcast → confirmed, with real on-chain settlement", async () => {
    const before = await wethBalance(WALLET_ADDRESS);
    const statuses: string[] = [];

    // A genuine 2-tx route: wrap 0.02 ETH, then move 0.01 WETH to self (self is
    // an allow-listed recipient). Both target WETH (in the f(x) registry).
    const res = await executeRoute({
      ...baseParams("fork:happy:1", [deposit(parseEther("0.02")), transfer(WALLET_ADDRESS, parseEther("0.01"))]),
      onStatus: (s) => statuses.push(s),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.status).toBe("confirmed");
    expect(res.deduped).toBe(false);
    expect(res.hashes).toHaveLength(2);
    for (const h of res.hashes) expect(h).toMatch(/^0x[0-9a-f]{64}$/);

    // The state machine advanced along the audited edges.
    expect(statuses).toEqual(["simulated", "broadcasting", "broadcast", "confirmed"]);

    // Both transactions actually mined on the fork as successes.
    for (const h of res.hashes) {
      const receipt = await client.getTransactionReceipt({ hash: h });
      expect(receipt.status).toBe("success");
    }

    // Real settlement: wrapping added 0.02 WETH (the self-transfer nets zero).
    const after = await wethBalance(WALLET_ADDRESS);
    expect(after - before).toBe(parseEther("0.02"));

    // The persisted record is terminal-confirmed with both hashes and no
    // dangling replaceable pending tx.
    const rec = txStore.get(res.recordId)!;
    expect(rec.status).toBe("confirmed");
    expect((rec.data as { hashes: string[] }).hashes).toHaveLength(2);
    expect((rec.data as { pending?: unknown }).pending).toBeUndefined();
  });

  it("is idempotent: a repeated key dedupes and never broadcasts twice", async () => {
    const key = "fork:idem:1";
    const route = [deposit(parseEther("0.01"))];

    const first = await executeRoute(baseParams(key, route));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error);
    expect(first.deduped).toBe(false);
    const sendsAfterFirst = sendMock.mock.calls.length;
    expect(sendsAfterFirst).toBe(1);

    const second = await executeRoute(baseParams(key, route));
    expect(second.ok).toBe(true);
    expect(second.deduped).toBe(true);
    expect(second.recordId).toBe(first.recordId);
    // Crucially: not a single additional broadcast.
    expect(sendMock.mock.calls.length).toBe(sendsAfterFirst);
  });

  it("FAIL-CLOSED: a route that fails simulation is never broadcast", async () => {
    // Transfer wildly more WETH than the account could ever hold → eth_simulateV1
    // reverts → the executor aborts before any send.
    const res = await executeRoute(
      baseParams("fork:revert:1", [transfer(WALLET_ADDRESS, parseEther("1000000"))])
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/simulation failed/i);
    expect(sendMock).not.toHaveBeenCalled();
    expect(txStore.get(res.recordId)!.status).toBe("failed");
  });

  it("SIGNER POLICY: a non-registry target is rejected before simulate or broadcast", async () => {
    // 0x…dead is not in the f(x) ADDRESSES registry → fail-closed in enforce mode.
    const rogue: TradeTx = {
      to: "0x000000000000000000000000000000000000dEaD",
      data: "0x",
      value: 0n,
    };
    const res = await executeRoute(baseParams("fork:policy:1", [rogue]));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected policy rejection");
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/signer policy/i);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
