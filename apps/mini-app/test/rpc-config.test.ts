import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient } from "viem";
import { mainnet } from "viem/chains";
import { getRpcTransport } from "../src/lib/fx/clients";
import { assertAlchemyRpcUrl, assertInfuraRpcUrl, assertLocalForkRpcUrl, withConfiguredRpcFallback } from "../src/lib/fx/config";

test("accepts only the reviewed Alchemy host for each supported chain", () => {
  assert.equal(
    assertAlchemyRpcUrl("https://eth-mainnet.g.alchemy.com/v2/browser-key", 1),
    "https://eth-mainnet.g.alchemy.com/v2/browser-key",
  );
  assert.equal(
    assertAlchemyRpcUrl("https://base-mainnet.g.alchemy.com/v2/browser-key", 8453),
    "https://base-mainnet.g.alchemy.com/v2/browser-key",
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://base-mainnet.g.alchemy.com/v2/browser-key", 1),
    /reviewed Alchemy host/,
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://rpc.attacker.example/v2/browser-key", 8453),
    /reviewed Alchemy host/,
  );
});

test("validates optional Infura endpoints against supported chain hosts", () => {
  assert.equal(assertInfuraRpcUrl("https://mainnet.infura.io/v3/project", 1), "https://mainnet.infura.io/v3/project");
  assert.equal(assertInfuraRpcUrl("https://base-mainnet.infura.io/v3/project", 8453), "https://base-mainnet.infura.io/v3/project");
  assert.throws(() => assertInfuraRpcUrl("https://mainnet.infura.io/v3/project", 8453), /reviewed Infura host/);
  assert.throws(() => assertInfuraRpcUrl("https://evil.example/v3/project", 1), /reviewed Infura host/);
});

test("rejects credential-bearing and non-v2 RPC URLs", () => {
  assert.throws(
    () => assertAlchemyRpcUrl("http://eth-mainnet.g.alchemy.com/v2/key", 1),
    /HTTPS/,
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://user:pass@eth-mainnet.g.alchemy.com/v2/key", 1),
    /cannot include credentials/,
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://eth-mainnet.g.alchemy.com/v2/key?redirect=1", 1),
    /cannot include credentials/,
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://eth-mainnet.g.alchemy.com/", 1),
    /\/v2 application endpoint/,
  );
});

test("local fork URLs are limited to credential-free localhost endpoints", () => {
  assert.equal(assertLocalForkRpcUrl("http://127.0.0.1:8547"), "http://127.0.0.1:8547");
  assert.equal(assertLocalForkRpcUrl("http://localhost:8547/"), "http://localhost:8547");
  assert.throws(() => assertLocalForkRpcUrl("https://rpc.example/v2/key"), /localhost/);
  assert.throws(() => assertLocalForkRpcUrl("http://127.0.0.1:8547/?key=secret"), /credentials/);
});

test("only explicit localhost fork mode gets an extended bounded RPC timeout", () => {
  const previousMode = process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE;
  const previousScreenshot = process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE;
  const timeoutFor = (url: string) => (createPublicClient({
    chain: mainnet,
    transport: getRpcTransport([url], 1),
  }) as unknown as { transport: { timeout: number } }).transport.timeout;
  try {
    delete process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE;
    delete process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE;
    assert.equal(timeoutFor("http://127.0.0.1:8547"), 5_000);

    process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE = "1";
    assert.equal(timeoutFor("http://127.0.0.1:8547"), 60_000);
    assert.equal(timeoutFor("https://eth-mainnet.g.alchemy.com/v2/test"), 5_000, "test mode must not extend hosted RPC deadlines");
  } finally {
    if (previousMode === undefined) delete process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE;
    else process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE = previousMode;
    if (previousScreenshot === undefined) delete process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE;
    else process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE = previousScreenshot;
  }
});

test("configured SDK RPC fallback advances only on transport failures", async () => {
  const keys = ["NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL", "NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL", "NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL"] as const;
  const previous = keys.map((key) => process.env[key]);
  process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL = "https://eth-mainnet.g.alchemy.com/v2/primary";
  process.env.NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL = "https://eth-mainnet.g.alchemy.com/v2/secondary";
  process.env.NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL = "https://mainnet.infura.io/v3/tertiary";
  try {
    const attempted: string[] = [];
    const result = await withConfiguredRpcFallback(1, async (url) => {
      attempted.push(url);
      if (attempted.length === 1) throw Object.assign(new Error("request failed"), { name: "HttpRequestError" });
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(attempted.length, 2);
    assert.throws(() => assertInfuraRpcUrl("https://mainnet.infura.io/v3/project", 8453), /reviewed Infura host/);

    attempted.length = 0;
    await assert.rejects(withConfiguredRpcFallback(1, async (url) => {
      attempted.push(url);
      throw new Error("execution reverted");
    }), /execution reverted/);
    assert.equal(attempted.length, 1);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    });
  }
});

test("viem RPC transport fails over within one request and preserves contract reverts", async () => {
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("primary")) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const client = createPublicClient({
    chain: mainnet,
    transport: getRpcTransport([
      "https://eth-mainnet.g.alchemy.com/v2/primary",
      "https://mainnet.infura.io/v3/secondary",
    ], 1, fetchFn),
  });
  assert.equal(await client.getChainId(), 1);
  assert.deepEqual(calls, [
    "https://eth-mainnet.g.alchemy.com/v2/primary",
    "https://mainnet.infura.io/v3/secondary",
    "https://mainnet.infura.io/v3/secondary",
  ]);

  calls.length = 0;
  const revertingFetch: typeof fetch = async (input, init) => {
    calls.push(String(input));
    const payload = JSON.parse(String(init?.body)) as { id: number; method: string };
    const body = payload.method === "eth_chainId"
      ? { jsonrpc: "2.0", id: payload.id, result: "0x1" }
      : { jsonrpc: "2.0", id: payload.id, error: { code: -32000, message: "execution reverted" } };
    return new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const revertingClient = createPublicClient({
    chain: mainnet,
    transport: getRpcTransport([
      "https://eth-mainnet.g.alchemy.com/v2/primary",
      "https://mainnet.infura.io/v3/secondary",
    ], 1, revertingFetch),
  });
  await assert.rejects(revertingClient.call({ to: "0x0000000000000000000000000000000000001234" }));
  assert.deepEqual(calls, [
    "https://eth-mainnet.g.alchemy.com/v2/primary",
    "https://eth-mainnet.g.alchemy.com/v2/primary",
  ]);
});

test("the shared transport covers balances, calls, logs, receipts, and simulation reads", async () => {
  const primary = "https://eth-mainnet.g.alchemy.com/v2/primary-paths";
  const secondary = "https://mainnet.infura.io/v3/secondary-paths";
  const calls: Array<{ url: string; method: string }> = [];
  const hash = `0x${"1".repeat(64)}` as const;
  const address = "0x0000000000000000000000000000000000001234" as const;
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push({ url, method: payload.method });
    if (url === primary && payload.method !== "eth_chainId") throw new TypeError("fetch failed");
    const results: Record<string, unknown> = {
      eth_chainId: "0x1",
      eth_getBalance: "0x5",
      eth_call: "0x1234",
      eth_getLogs: [],
      eth_getTransactionReceipt: {
        transactionHash: hash, transactionIndex: "0x0", blockHash: hash, blockNumber: "0x1",
        from: address, to: address, cumulativeGasUsed: "0x5208", gasUsed: "0x5208",
        contractAddress: null, logs: [], logsBloom: `0x${"0".repeat(512)}`,
        status: "0x1", effectiveGasPrice: "0x1", type: "0x2",
      },
      eth_estimateGas: "0x5208",
    };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: results[payload.method] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const client = createPublicClient({ chain: mainnet, transport: getRpcTransport([primary, secondary], 1, fetchFn) });
  assert.equal(await client.getBalance({ address }), 5n);
  assert.equal((await client.call({ to: address })).data, "0x1234");
  assert.deepEqual(await client.getLogs({ address }), []);
  assert.equal((await client.getTransactionReceipt({ hash })).status, "success");
  assert.equal(await client.estimateGas({ account: address, to: address }), 21_000n);
  assert.deepEqual([...new Set(calls.map(({ method }) => method))].sort(), [
    "eth_call", "eth_chainId", "eth_estimateGas", "eth_getBalance", "eth_getLogs", "eth_getTransactionReceipt",
  ]);
  assert.equal(calls.filter(({ url }) => url === primary).length, 2, "the cooled-down primary is probed only once after its failure");
});
