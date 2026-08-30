import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = parsePort(process.env.ANVIL_PORT ?? "8547");
const rpcUrl = `http://127.0.0.1:${port}`;
const forkUrl = process.env.ANVIL_FORK_URL?.trim();

function parsePort(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error("ANVIL_PORT must be an integer between 1024 and 65535");
  }
  return parsed;
}

function assertForkUrl(value) {
  if (!value) throw new Error("ANVIL_FORK_URL is required (supply a fresh restricted HTTPS fork URL through your secret store)");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ANVIL_FORK_URL must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("ANVIL_FORK_URL must be a clean HTTPS endpoint without embedded credentials, query, or fragment");
  }
}

function redacted(value) {
  // Never print a provider key or URL, even if Anvil echoes its command line.
  let output = String(value);
  if (forkUrl) output = output.replaceAll(forkUrl, "[redacted fork URL]");
  // Anvil prints disposable account private keys in its default banner. Keep
  // those out of CI logs as well; all 32-byte hex values are non-authoritative
  // test artifacts and may include keys, hashes, or fork internals.
  output = output.replace(/0x[0-9a-f]{64}/gi, "[redacted 32-byte hex]");
  output = output.replace(/(https?:\/\/[^\s"'<>]+)(?=[\s"'<>]|$)/gi, (url) => {
    if (url.includes("127.0.0.1") || url.includes("localhost")) return url;
    return "[redacted external URL]";
  });
  return output;
}

function scrubChildEnvironment() {
  const childEnv = { ...process.env, ANVIL_RPC_URL: rpcUrl, FX_ANVIL_FORKED: "1" };
  // The integration test uses only the local fork. Do not unnecessarily pass
  // production provider, bot, wallet, or deployment credentials to it.
  for (const name of [
    "ANVIL_FORK_URL",
    "NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL",
    "NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL",
    "ALCHEMY_RPC_URL",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_TOKEN_SECRET",
    "PRIVY_APP_SECRET",
    "CLOUDFLARE_API_TOKEN",
  ]) delete childEnv[name];
  return childEnv;
}

function spawnWithRedaction(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const pipe = (stream, target) => {
    let pending = "";
    stream?.on("data", (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/(\r?\n)/);
      // Keep the unterminated line until its newline arrives so a private key
      // or provider URL split across stream chunks cannot bypass redaction.
      pending = lines.pop() ?? "";
      target.write(redacted(lines.join("")));
    });
    stream?.on("end", () => {
      if (pending) target.write(redacted(pending));
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`local Anvil RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`local Anvil RPC error: ${payload.error.message ?? "unknown error"}`);
  return payload.result;
}

async function waitForAnvil(child) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Anvil exited before its RPC endpoint became ready (exit ${child.exitCode})`);
    try {
      const chainId = await rpc("eth_chainId");
      if (chainId !== "0x1") throw new Error(`Anvil fork chain identity was ${String(chainId)}, expected Ethereum mainnet`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`timed out waiting for Anvil RPC: ${lastError instanceof Error ? lastError.message : "endpoint unavailable"}`);
}

function commandForPnpm() {
  const inherited = process.env.npm_execpath;
  if (inherited && existsSync(inherited)) return { command: process.execPath, args: [inherited] };
  return process.platform === "win32" ? { command: "pnpm.cmd", args: [] } : { command: "pnpm", args: [] };
}

let anvil;
let tests;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  tests?.kill();
  anvil?.kill();
}

process.once("SIGINT", () => {
  cleanup();
  process.exitCode = 130;
});
process.once("SIGTERM", () => {
  cleanup();
  process.exitCode = 143;
});

try {
  assertForkUrl(forkUrl);
  const anvilBin = process.env.ANVIL_BIN?.trim() || "anvil";
  const anvilArgs = [
    "--fork-url", forkUrl,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--chain-id", "1",
    "--accounts", "20",
    "--balance", "10000",
    "--no-rate-limit",
    "--quiet",
  ];
  if (process.env.ANVIL_FORK_BLOCK?.trim()) {
    if (!/^\d+$/.test(process.env.ANVIL_FORK_BLOCK.trim())) throw new Error("ANVIL_FORK_BLOCK must be a decimal block number");
    anvilArgs.push("--fork-block-number", process.env.ANVIL_FORK_BLOCK.trim());
  }

  anvil = spawnWithRedaction(anvilBin, anvilArgs, { cwd: root, env: scrubChildEnvironment() });
  const anvilError = new Promise((_, reject) => {
    anvil.once("error", (error) => reject(error?.code === "ENOENT"
      ? new Error("Anvil was not found; install Foundry and ensure ANVIL_BIN/anvil is on PATH")
      : new Error("Anvil could not be started")));
  });
  await Promise.race([waitForAnvil(anvil), anvilError]);

  const pnpm = commandForPnpm();
  tests = spawnWithRedaction(
    pnpm.command,
    [...pnpm.args, "--dir", join("apps", "mini-app"), "test:anvil"],
    { cwd: root, env: scrubChildEnvironment() },
  );
  const testExit = await new Promise((resolve, reject) => {
    tests.once("error", reject);
    tests.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = Number(testExit);
} catch (error) {
  process.stderr.write(`FxAeon Anvil tests could not run: ${redacted(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 2;
} finally {
  cleanup();
}
