import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const anvilPort = parsePort(process.env.ANVIL_PORT ?? '8550', 'ANVIL_PORT');
const serverPort = parsePort(process.env.FX_SCREENSHOT_PORT ?? '4322', 'FX_SCREENSHOT_PORT');
const managedRpcUrl = `http://127.0.0.1:${anvilPort}`;
const externalRpcUrl = process.env.FX_SCREENSHOT_ANVIL_RPC_URL?.trim();
const rpcUrl = externalRpcUrl ? assertLocalRpc(externalRpcUrl) : managedRpcUrl;
const forkUrl = [
  process.env.ANVIL_FORK_URL,
  process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL,
  process.env.ALCHEMY_RPC_URL,
].map((value) => value?.trim()).find(Boolean);
const redactedManifestPath = resolveRepoPath(
  process.env.FX_SCREENSHOT_REDACTED_MANIFEST,
  join('docs', 'fixtures', 'position-screenshot-manifest.json'),
  'FX_SCREENSHOT_REDACTED_MANIFEST',
);
const baseUrl = `http://127.0.0.1:${serverPort}`;
const expectedAssets = ['fxaeon-portfolio-positions.png', 'fxaeon-positions.png', 'fxaeon-trade-connected.png', 'fxaeon-positions-mobile.png'];
if (Number(new URL(rpcUrl).port) === serverPort) throw new Error('Anvil and screenshot server must use different ports');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'fxaeon-position-screenshot-'));
const privateManifestPath = join(temporaryDirectory, 'fixture.json');
const stagedManifestPath = join(temporaryDirectory, 'manifest.json');
const stagedAssetsPath = join(temporaryDirectory, 'assets');
const captureReportPath = join(temporaryDirectory, 'capture-report.json');

function parsePort(value, label) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error(`${label} must be an integer between 1024 and 65535`);
  }
  return parsed;
}

function assertLocalRpc(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== '/'
    || !url.port
    || Number(url.port) < 1024
  ) throw new Error('FX_SCREENSHOT_ANVIL_RPC_URL must be a credential-free localhost HTTP endpoint');
  return url.toString().replace(/\/$/, '');
}

function assertForkUrl(value) {
  if (!value) {
    throw new Error('ANVIL_FORK_URL or NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL is required when this command starts Anvil');
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('the upstream fork URL must be a clean HTTPS endpoint without query parameters');
  }
}

async function assertLoopbackPortAvailable(port) {
  const probe = createServer();
  await new Promise((resolveProbe, reject) => {
    probe.once('error', () => reject(new Error(`loopback port ${port} is already in use; choose another capture port`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolveProbe));
  });
}

function resolveRepoPath(configured, fallback, label) {
  const candidate = configured?.trim() || fallback;
  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const fromRoot = relative(root, resolved);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`${label} must resolve below the repository root`);
  }
  return resolved;
}

function redacted(value) {
  let output = String(value);
  if (forkUrl) output = output.replaceAll(forkUrl, '[redacted fork URL]');
  output = output.replace(/0x[0-9a-f]{64}/gi, '[redacted 32-byte hex]');
  output = output.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => (
    url.includes('127.0.0.1') || url.includes('localhost')
      ? url
      : '[redacted external URL]'
  ));
  return output;
}

function commandForPnpm() {
  const inherited = process.env.npm_execpath;
  if (inherited && existsSync(inherited) && /pnpm(?:\.c?js)?$/i.test(inherited)) return { command: process.execPath, args: [inherited] };
  return process.platform === 'win32'
    ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm.cmd'] }
    : { command: 'pnpm', args: [] };
}

function spawnWithRedaction(command, args, options = {}) {
  assertNotCancelled();
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Package-manager children must stay in a group owned by this capture.
    // On Unix their parent can exit before the fixture/browser descendants.
    detached: process.platform !== 'win32',
  });
  // Retain startup errors for the readiness loop rather than allowing an
  // unhandled EventEmitter error to bypass snapshot cleanup.
  child.on('error', (error) => { child.startupError = error; });
  const pipe = (stream, target) => {
    let pending = '';
    stream?.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/(\r?\n)/);
      pending = lines.pop() ?? '';
      target.write(redacted(lines.join('')));
    });
    stream?.on('end', () => {
      if (pending) target.write(redacted(pending));
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

async function waitForExit(child, label) {
  if (child.startupError) throw new Error(`${label} could not start: ${child.startupError.message}`);
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) throw new Error(`${label} exited with code ${child.exitCode}`);
    return;
  }
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  if (Number(exitCode) !== 0) throw new Error(`${label} exited with code ${exitCode}`);
}

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`local Anvil RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`local Anvil RPC error: ${payload.error.message ?? 'unknown error'}`);
  return payload.result;
}

async function waitForAnvil(child) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    assertNotCancelled();
    if (child?.startupError) throw new Error('Anvil could not be started; check ANVIL_BIN');
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`Anvil exited before becoming ready (exit ${child.exitCode})`);
    try {
      if (await rpc('eth_chainId') !== '0x1') throw new Error('local fork is not Ethereum mainnet');
      if (!/^anvil\//i.test(await rpc('web3_clientVersion'))) throw new Error('local endpoint is not Anvil');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  throw new Error(`timed out waiting for Anvil: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    assertNotCancelled();
    if (child.startupError) throw new Error('screenshot server could not be started');
    if (child.exitCode !== null) throw new Error(`screenshot server exited before becoming ready (exit ${child.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/positions`, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`timed out waiting for screenshot server: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

function childEnvironment(extra = {}) {
  const environment = {
    ...process.env,
    ...extra,
  };
  for (const name of [
    'ANVIL_FORK_URL',
    'ALCHEMY_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL',
    'NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_TOKEN_SECRET',
    'PRIVY_APP_SECRET',
    'CLOUDFLARE_API_TOKEN',
  ]) delete environment[name];
  const allowedLocalEndpoints = new Set(['ANVIL_RPC_URL', 'NEXT_PUBLIC_FX_LOCAL_FORK_RPC_URL', 'NEXT_PUBLIC_FX_ANVIL_RPC_URL', 'FX_SCREENSHOT_BASE_URL']);
  for (const name of Object.keys(environment)) {
    if (!allowedLocalEndpoints.has(name) && /(?:^|_)(?:SECRET|TOKEN|PRIVATE_KEY|MNEMONIC|API_KEY|FORK_URL|RPC_URL)$/i.test(name)) delete environment[name];
  }
  return environment;
}

function validatePrivateManifest() {
  if (!existsSync(privateManifestPath)) throw new Error('fixture generator did not write its private capture manifest');
  const manifest = JSON.parse(readFileSync(privateManifestPath, 'utf8'));
  const scenarios = new Set((manifest.positions ?? []).map((position) => `${position.market}:${position.side}`));
  if (
    manifest.proof !== 'fxaeon-position-screenshot-fixture'
    || manifest.chainId !== 1
    || typeof manifest.wallet !== 'string'
    || !/^0x[0-9a-f]{40}$/i.test(manifest.wallet)
    || scenarios.size !== 4
    || manifest.positions.length !== 4
    || ['ETH:long', 'ETH:short', 'BTC:long', 'BTC:short'].some((scenario) => !scenarios.has(scenario))
  ) throw new Error('fixture manifest is incomplete');
  return manifest;
}

function validateRedactedManifest() {
  const text = readFileSync(stagedManifestPath, 'utf8');
  if (/https?:\/\//i.test(text) || /private.?key|mnemonic|fork.?url|rpc.?url/i.test(text)) {
    throw new Error('redacted fixture manifest contains forbidden provider or signer material');
  }
  const manifest = JSON.parse(text);
  if (manifest.positions?.length !== 4 || !String(manifest.wallet).includes('…')) {
    throw new Error('redacted fixture manifest is incomplete');
  }
}

function assertCapturedAssets() {
  for (const asset of expectedAssets) {
    const assetPath = join(stagedAssetsPath, asset);
    if (!existsSync(assetPath)) {
      throw new Error(`capture did not create docs/assets/${asset}`);
    }
    const png = readFileSync(assetPath);
    if (png.length < 1_000 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`capture created an invalid PNG: ${asset}`);
  }
}

let anvil;
let server;
let activeChild;
let snapshot;
let interrupted = false;
let interruptionStop;
let cleanupPromise;
function assertNotCancelled() {
  if (interrupted) throw new Error('capture was interrupted');
}

function groupExists(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function stopChild(child) {
  if (!child?.pid) return;
  if (child.stopPromise) return child.stopPromise;
  child.stopPromise = (async () => {
    if (process.platform === 'win32') {
      // A live handle establishes PID ownership; never target an exited or
      // reused PID. /T stops the package manager and all of its descendants.
      if (child.exitCode !== null || child.signalCode !== null) return;
      const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await new Promise((resolveStop, reject) => {
        const timer = setTimeout(() => { taskkill.kill(); reject(new Error('timed out stopping the owned capture process tree')); }, 10_000);
        taskkill.once('error', (error) => { clearTimeout(timer); reject(error); });
        taskkill.once('exit', (code) => {
          clearTimeout(timer);
          if (code !== 0 && child.exitCode === null && child.signalCode === null) reject(new Error('could not stop the owned capture process tree'));
          else resolveStop();
        });
      });
      return;
    }
    // detached:true created this exact group. A completed pnpm parent does
    // not mean its TSX/Next/Chromium descendants have stopped using the fork.
    if (!groupExists(child.pid)) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && groupExists(child.pid)) await new Promise((resolveStop) => setTimeout(resolveStop, 50));
    if (groupExists(child.pid)) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      const forcedDeadline = Date.now() + 5_000;
      while (Date.now() < forcedDeadline && groupExists(child.pid)) await new Promise((resolveStop) => setTimeout(resolveStop, 50));
      if (groupExists(child.pid)) throw new Error('owned capture process group did not stop; fork snapshot was not restored');
    }
  })();
  return child.stopPromise;
}

async function stopAndRestore() {
  try {
    const stops = await Promise.allSettled([interruptionStop, stopChild(activeChild), stopChild(server)]);
    const failedStop = stops.find((result) => result.status === 'rejected');
    // Never report restoration while an owned process may still issue writes.
    if (failedStop) throw failedStop.reason;
    // External nodes are never destroyed. Restore the state captured before
    // donor funding, approvals, or position transactions after writers stop.
    if (snapshot) {
      const reverted = await rpc('evm_revert', [snapshot]);
      if (reverted !== true) throw new Error(`Anvil snapshot ${snapshot} restoration failed; do not reuse this external node until it is restored`);
      snapshot = undefined;
    }
  } finally {
    await stopChild(anvil);
  }
}

function cleanup() {
  cleanupPromise ??= (async () => {
    try {
      await stopAndRestore();
    } finally {
      const temporaryRoot = resolve(tmpdir());
      const resolvedTemporary = resolve(temporaryDirectory);
      if (resolvedTemporary.startsWith(`${temporaryRoot}\\`) || resolvedTemporary.startsWith(`${temporaryRoot}/`)) {
        rmSync(resolvedTemporary, { recursive: true, force: true });
      }
    }
  })();
  return cleanupPromise;
}

process.once('SIGINT', () => {
  interrupted = true;
  interruptionStop = stopChild(activeChild);
  void interruptionStop.catch(() => undefined);
  process.exitCode = 130;
});
process.once('SIGTERM', () => {
  interrupted = true;
  interruptionStop = stopChild(activeChild);
  void interruptionStop.catch(() => undefined);
  process.exitCode = 143;
});

try {
  await assertLoopbackPortAvailable(serverPort);
  if (!externalRpcUrl) {
    await assertLoopbackPortAvailable(anvilPort);
    assertForkUrl(forkUrl);
    const bundledAnvil = join(tmpdir(), 'fxaeon-foundry-v1.8.1', 'anvil.exe');
    const anvilBin = process.env.ANVIL_BIN?.trim() || (existsSync(bundledAnvil) ? bundledAnvil : 'anvil');
    const anvilArgs = [
      '--fork-url', forkUrl,
      '--host', '127.0.0.1',
      '--port', String(anvilPort),
      '--chain-id', '1',
      '--accounts', '20',
      '--balance', '5',
      '--no-rate-limit',
      '--quiet',
    ];
    if (process.env.ANVIL_FORK_BLOCK?.trim()) {
      if (!/^\d+$/.test(process.env.ANVIL_FORK_BLOCK.trim())) throw new Error('ANVIL_FORK_BLOCK must be a decimal block number');
      anvilArgs.push('--fork-block-number', process.env.ANVIL_FORK_BLOCK.trim());
    }
    anvil = spawnWithRedaction(anvilBin, anvilArgs, { cwd: root, env: childEnvironment() });
  }
  await waitForAnvil(anvil);
  snapshot = await rpc('evm_snapshot');
  if (typeof snapshot !== 'string' || !/^0x[0-9a-f]+$/i.test(snapshot)) throw new Error('Anvil did not provide a valid pre-fixture snapshot');
  assertNotCancelled();

  const pnpm = commandForPnpm();
  activeChild = spawnWithRedaction(
    pnpm.command,
    [...pnpm.args, '--dir', join('apps', 'mini-app'), 'exec', 'tsx', 'e2e/fixtures/create-position-screenshot-fixture.ts'],
    {
      cwd: root,
      env: childEnvironment({
        ANVIL_RPC_URL: rpcUrl,
        NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE: '1',
        NEXT_PUBLIC_FX_LOCAL_FORK_RPC_URL: rpcUrl,
        FX_SCREENSHOT_PRIVATE_MANIFEST: privateManifestPath,
        FX_SCREENSHOT_REDACTED_MANIFEST: stagedManifestPath,
        FX_SCREENSHOT_ORCHESTRATED: '1',
      }),
    },
  );
  await waitForExit(activeChild, 'position fixture generator');
  activeChild = undefined;
  assertNotCancelled();
  const manifest = validatePrivateManifest();
  validateRedactedManifest();

  activeChild = spawnWithRedaction(
    pnpm.command,
    [...pnpm.args, '--dir', join('apps', 'mini-app'), 'build'],
    {
      cwd: root,
      env: childEnvironment({
        NODE_ENV: 'production',
        NEXT_PUBLIC_PRIVY_APP_ID: '',
        NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: '',
        NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL: '',
        NEXT_PUBLIC_TELEGRAM_APP_URL: 'https://t.me/FxAeonBot',
        NEXT_PUBLIC_FX_SCREENSHOT_MODE: '1',
        NEXT_PUBLIC_FX_ANVIL_RPC_URL: rpcUrl,
        NEXT_PUBLIC_FX_LOCAL_FORK_RPC_URL: rpcUrl,
        NEXT_PUBLIC_FX_SCREENSHOT_WALLET_ADDRESS: manifest.wallet,
      }),
    },
  );
  await waitForExit(activeChild, 'screenshot build');
  activeChild = undefined;
  assertNotCancelled();

  server = spawnWithRedaction(process.execPath, [join(root, 'apps', 'mini-app', 'e2e', 'serve.mjs')], {
    cwd: root,
    env: childEnvironment({ PORT: String(serverPort), E2E_BUILD: '0' }),
  });
  await waitForServer(server);

  activeChild = spawnWithRedaction(process.execPath, [join(root, 'scripts', 'capture_docs_screenshots.mjs')], {
    cwd: root,
    env: childEnvironment({
      FX_SCREENSHOT_BASE_URL: baseUrl,
      FX_SCREENSHOT_POSITION_MANIFEST: privateManifestPath,
      FX_SCREENSHOT_CAPTURE_PROFILE: 'positions',
      FX_SCREENSHOT_OUTPUT_DIR: stagedAssetsPath,
      FX_SCREENSHOT_CAPTURE_REPORT: captureReportPath,
    }),
  });
  await waitForExit(activeChild, 'Playwright screenshot capture');
  activeChild = undefined;
  assertNotCancelled();
  assertCapturedAssets();
  const report = JSON.parse(readFileSync(captureReportPath, 'utf8'));
  if (report.profile !== 'positions' || report.captures?.length !== 4 || report.discoveryErrors?.length !== 0
    || new Set(report.captures.map((capture) => capture.file)).size !== 4
    || report.captures.some((capture) => !expectedAssets.includes(capture.file)
      || createHash('sha256').update(readFileSync(join(stagedAssetsPath, capture.file))).digest('hex') !== capture.sha256
      || readFileSync(join(stagedAssetsPath, capture.file)).readUInt32BE(16) !== capture.viewport?.width
      || readFileSync(join(stagedAssetsPath, capture.file)).readUInt32BE(20) !== capture.viewport?.height)) throw new Error('capture did not produce complete browser verification');
  // Publish only a fully successful capture whose node has been restored.
  await stopAndRestore();
  assertNotCancelled();
  const publishedManifest = JSON.parse(readFileSync(stagedManifestPath, 'utf8'));
  publishedManifest.capture = { ...report, snapshotRestored: true };
  writeFileSync(stagedManifestPath, `${JSON.stringify(publishedManifest, null, 2)}\n`, 'utf8');
  for (const capture of report.captures) {
    const destination = join(root, 'docs', 'assets', capture.file);
    mkdirSync(join(root, 'docs', 'assets'), { recursive: true });
    copyFileSync(join(stagedAssetsPath, capture.file), `${destination}.tmp`);
    renameSync(`${destination}.tmp`, destination);
  }
  mkdirSync(resolve(redactedManifestPath, '..'), { recursive: true });
  copyFileSync(stagedManifestPath, `${redactedManifestPath}.tmp`);
  renameSync(`${redactedManifestPath}.tmp`, redactedManifestPath);
  process.stdout.write(`Captured fork-backed position documentation at block ${manifest.forkBlock}\n`);
} catch (error) {
  process.stderr.write(`Position screenshot capture failed: ${redacted(error instanceof Error ? error.message : String(error))}\n`);
  if (!interrupted) process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) {
    process.stderr.write(`Capture cleanup failed: ${redacted(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}
