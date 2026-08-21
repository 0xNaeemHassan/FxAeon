import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRpc } from "../src/api/health.js";

function mockRpc(chainId: string, timestampSeconds = Math.floor(Date.now() / 1_000)) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    const result = request.method === "eth_chainId"
      ? chainId
      : { timestamp: `0x${timestampSeconds.toString(16)}` };
    return {
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result }),
    } as Response;
  });
}

describe("RPC health network binding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a fresh head only on the expected chain", async () => {
    mockRpc("0x1");
    await expect(checkRpc("https://rpc.example", "ethereum", 1)).resolves.toMatchObject({
      status: "healthy",
      chainId: 1,
    });
  });

  it("fails a reachable provider that serves the wrong chain", async () => {
    mockRpc("0x2105");
    await expect(checkRpc("https://rpc.example", "ethereum", 1)).resolves.toEqual({
      status: "unhealthy",
      headLagSeconds: null,
      chainId: 8453,
    });
  });

  it("degrades a provider whose chain head is stale", async () => {
    mockRpc("0x2105", Math.floor(Date.now() / 1_000) - 90);
    await expect(checkRpc("https://base.example", "base", 8453)).resolves.toMatchObject({
      status: "degraded",
      chainId: 8453,
    });
  });

  it("distinguishes optional and required missing providers", async () => {
    await expect(checkRpc(undefined, "base", 8453)).resolves.toEqual({
      status: "skipped",
      headLagSeconds: null,
      chainId: null,
    });
    await expect(checkRpc(undefined, "base", 8453, true)).resolves.toEqual({
      status: "unhealthy",
      headLagSeconds: null,
      chainId: null,
    });
  });
});
