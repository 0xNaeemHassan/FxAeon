/**
 * Vitest globalSetup for the Anvil mainnet-fork money-path suite.
 *
 * Goal: make `pnpm --filter @fxaeon/bot test:fork` "just work" in CI and locally
 * without forcing every developer to babysit an anvil process.
 *
 * Behaviour (all best-effort, never fatal):
 *   1. If FORK_RPC_URL already answers eth_chainId === 1, reuse it (an operator
 *      or a sibling process already has an anvil fork up). Nothing to start.
 *   2. Otherwise, if the `anvil` binary is on PATH AND a real upstream RPC is
 *      configured (FORK_BACKEND_RPC_URL | MAINNET_RPC_URL | ALCHEMY_RPC_URL),
 *      spawn `anvil --fork-url <upstream>` on 127.0.0.1:<port>, wait until it
 *      serves a chainId-1 fork, and export FORK_RPC_URL + ALCHEMY_RPC_URL so the
 *      worker processes inherit them.
 *   3. If neither is possible, do nothing. The test file probes the RPC at
 *      collection time and `describe.skipIf`s itself out with a clear message,
 *      so the suite is a no-op (green, skipped) rather than a failure.
 *
 * The teardown only kills an anvil instance THIS setup started.
 */
import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_PORT = Number(process.env.FORK_PORT ?? 8545);
const DEFAULT_URL = process.env.FORK_RPC_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`;

function upstreamRpc(): string | undefined {
  return (
    process.env.FORK_BACKEND_RPC_URL ||
    process.env.MAINNET_RPC_URL ||
    // ALCHEMY_RPC_URL is the bot's own mainnet RPC env; only use it as a fork
    // backend if it isn't already pointing at the local fork.
    (process.env.ALCHEMY_RPC_URL && !/127\.0\.0\.1|localhost/.test(process.env.ALCHEMY_RPC_URL)
      ? process.env.ALCHEMY_RPC_URL
      : undefined)
  );
}

async function chainId(url: string, timeoutMs = 2_500): Promise<number | null> {
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

async function anvilOnPath(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("anvil", ["--version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

let started: ChildProcess | null = null;

export async function setup(): Promise<void> {
  // 1) Reuse an already-running fork.
  if ((await chainId(DEFAULT_URL)) === 1) {
    process.env.FORK_RPC_URL = DEFAULT_URL;
    process.env.ALCHEMY_RPC_URL = DEFAULT_URL;
     
    console.log(`[fork] reusing live fork at ${DEFAULT_URL}`);
    return;
  }

  // 2) Try to start one ourselves.
  const upstream = upstreamRpc();
  if (!upstream || !(await anvilOnPath())) {
     
    console.log(
      "[fork] no fork available (no FORK_RPC_URL, and cannot start anvil — " +
        "set FORK_BACKEND_RPC_URL/MAINNET_RPC_URL and install foundry). Fork suite will skip."
    );
    return;
  }

  const port = DEFAULT_PORT;
   
  console.log(`[fork] starting anvil --fork-url <upstream> on 127.0.0.1:${port}`);
  started = spawn(
    "anvil",
    ["--fork-url", upstream, "--port", String(port), "--host", "127.0.0.1", "--silent"],
    { stdio: "ignore", detached: false }
  );
  started.on("error", () => {
    started = null;
  });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await chainId(url)) === 1) {
      process.env.FORK_RPC_URL = url;
      process.env.ALCHEMY_RPC_URL = url;
       
      console.log(`[fork] anvil ready at ${url}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
   
  console.warn("[fork] anvil did not become ready in time — fork suite will skip.");
}

export async function teardown(): Promise<void> {
  if (started && !started.killed) {
    started.kill("SIGTERM");
    started = null;
  }
}
