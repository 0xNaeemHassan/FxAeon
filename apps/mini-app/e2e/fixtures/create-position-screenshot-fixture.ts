import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { mainnet } from 'viem/chains';
import { tokenAddress, type UiMarket, type UiSide } from '../../src/app/trade/fxUi';
import { clearPendingHashJournalForTests } from '../../src/lib/fx/journal';
import { positionPoolAddress } from '../../src/lib/fx/policy';
import { runTransactionRoute, waitForReceipt } from '../../src/lib/fx/runner';
import { planIncreasePosition } from '../../src/lib/fx/service';
import type { FxPublicClient } from '../../src/lib/fx/types';

type PositionScenario = {
  market: UiMarket;
  side: UiSide;
  graphSubgraph: string;
};

const SCENARIOS: readonly PositionScenario[] = [
  { market: 'ETH', side: 'long', graphSubgraph: 'fx-v2-wsteth/3.0.0' },
  { market: 'ETH', side: 'short', graphSubgraph: 'fx-v2-wsteth-short/v0.1.0' },
  { market: 'BTC', side: 'long', graphSubgraph: 'fx-v2-wbtc/3.0.0' },
  { market: 'BTC', side: 'short', graphSubgraph: 'fx-v2-wbtc-short/v2.0.0' },
] as const;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

const POSITION_POOL_ABI = [
  {
    type: 'function',
    name: 'getNextPositionId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint32' }],
  },
  {
    type: 'function',
    name: 'getPosition',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'rawColls', type: 'uint256' },
      { name: 'rawDebts', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
] as const;

const REVIEWED_USDC_DONORS = [
  // Compound III USDC, Binance 8, and Circle treasury. These accounts are
  // impersonated only inside the disposable fork and never sign on mainnet.
  '0xc3d688b66703497daa19211eedff47f25384cdc3',
  '0xf977814e90da44bfa03b6295a0616a897441acec',
  '0x55fe002aeff02f77364de339a1292923a15844b8',
] as const satisfies readonly Address[];

const rpcUrl = assertLocalRpc(process.env.ANVIL_RPC_URL);
const privateManifestPath = requirePath('FX_SCREENSHOT_PRIVATE_MANIFEST');
const redactedManifestPath = requirePath('FX_SCREENSHOT_REDACTED_MANIFEST');
const amountPerPosition = parseUnits(process.env.FX_SCREENSHOT_POSITION_USDC?.trim() || '1000', 6);
const writtenManifests: string[] = [];
let fixtureSnapshot: string | undefined;

function assertLocalRpc(value: string | undefined): string {
  if (!value) throw new Error('ANVIL_RPC_URL is required');
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
  ) throw new Error('ANVIL_RPC_URL must be a credential-free localhost HTTP endpoint');
  return url.toString().replace(/\/$/, '');
}

function requirePath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return resolve(value);
}

async function rpc<T = unknown>(method: string, params: readonly unknown[] = []): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Anvil RPC returned HTTP ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(`Anvil RPC error: ${payload.error.message ?? 'unknown error'}`);
  return payload.result as T;
}

function hexQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

async function fundWithUsdc(publicClient: FxPublicClient, recipient: Address, amount: bigint): Promise<void> {
  const usdc = tokenAddress('USDC');
  let donor: Address | undefined;
  for (const candidate of REVIEWED_USDC_DONORS) {
    const balance = await publicClient.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [candidate],
    });
    if (balance >= amount) {
      donor = candidate;
      break;
    }
  }
  assert.ok(donor, 'no reviewed USDC donor has enough balance at this fork block');

  await rpc('anvil_impersonateAccount', [donor]);
  try {
    await rpc('anvil_setBalance', [donor, hexQuantity(10n * 10n ** 18n)]);
    const hash = await rpc<Hex>('eth_sendTransaction', [{
      from: donor,
      to: usdc,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [recipient, amount],
      }),
      value: '0x0',
    }]);
    const receipt = await waitForReceipt({ client: publicClient, hash, timeoutMs: 120_000, pollMs: 100 });
    assert.equal(receipt.status, 'success', 'fork-local USDC funding reverted');
  } finally {
    await rpc('anvil_stopImpersonatingAccount', [donor]);
  }
}

function redactedWallet(address: Address): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // The orchestrator supplies unique staging paths. Never overwrite an
  // unrelated manifest or remove a pre-existing file during error recovery.
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  writtenManifests.push(path);
}

async function main(): Promise<void> {
  assert.equal(process.env.FX_SCREENSHOT_ORCHESTRATED, '1', 'run pnpm docs:screenshots:positions so node state is snapshotted and restored after capture');
  assert.notEqual(privateManifestPath, redactedManifestPath, 'private and redacted manifest paths must differ');
  assert.ok(amountPerPosition > 0n && amountPerPosition <= parseUnits('1000000', 6), 'fixture size must be greater than zero and at most 1,000,000 USDC per position');
  clearPendingHashJournalForTests();
  const chainId = await rpc<string>('eth_chainId');
  assert.equal(chainId, '0x1', 'screenshot fixture must run on an Ethereum mainnet fork');
  assert.match(await rpc<string>('web3_clientVersion'), /^anvil\//i, 'fixture RPC must be a local Anvil node');
  fixtureSnapshot = await rpc<string>('evm_snapshot');
  assert.match(fixtureSnapshot, /^0x[0-9a-f]+$/i, 'fixture snapshot must be valid');
  const forkBlock = Number(BigInt(await rpc<string>('eth_blockNumber')));
  const accounts = await rpc<Address[]>('eth_accounts');
  assert.ok(accounts.length > 0, 'Anvil did not expose a disposable unlocked account');
  const wallet = accounts[0];
  const publicClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) }) as unknown as FxPublicClient;

  await fundWithUsdc(publicClient, wallet, amountPerPosition * BigInt(SCENARIOS.length));
  const positions: Array<{
    market: UiMarket;
    side: UiSide;
    pool: Address;
    positionId: number;
    graphSubgraph: string;
    rawCollateral: string;
    rawDebt: string;
  }> = [];

  for (const scenario of SCENARIOS) {
    const pool = positionPoolAddress(scenario.market, scenario.side);
    const positionId = Number(await publicClient.readContract({
      address: pool,
      abi: POSITION_POOL_ABI,
      functionName: 'getNextPositionId',
    }));
    assert.ok(Number.isSafeInteger(positionId) && positionId > 0, `${scenario.market} ${scenario.side} returned an invalid next position ID`);

    const routes = await planIncreasePosition({
      market: scenario.market,
      type: scenario.side,
      positionId: 0,
      leverage: scenario.side === 'short' ? 0.5 : 2,
      inputTokenAddress: tokenAddress('USDC'),
      amount: amountPerPosition,
      slippage: 1,
      userAddress: wallet,
    });
    assert.ok(routes.length > 0, `${scenario.market} ${scenario.side} returned no reviewed SDK route`);

    const result = await runTransactionRoute({
      route: routes[0],
      publicClient,
      callbacks: {
        requestSignature: (request) => rpc<Hex>('eth_sendTransaction', [{
          from: request.from,
          to: request.to,
          data: request.data,
          value: hexQuantity(request.value),
          nonce: hexQuantity(BigInt(request.nonce)),
        }]),
      },
      options: {
        receiptTimeoutMs: 120_000,
        pollMs: 100,
        waitForNextBlock: false,
      },
    });
    assert.equal(result.status, 'confirmed', `${scenario.market} ${scenario.side} SDK route failed: ${result.error ?? 'unknown error'}`);
    assert.ok(result.steps.length > 0, 'the confirmed route must contain execution evidence');
    assert.equal(result.steps.every((step) => step.status === 'confirmed' && step.receipt?.status === 'success'), true);
    await rpc('anvil_mine', ['0x1']);

    const owner = await publicClient.readContract({
      address: pool,
      abi: POSITION_POOL_ABI,
      functionName: 'ownerOf',
      args: [BigInt(positionId)],
    });
    assert.equal(owner.toLowerCase(), wallet.toLowerCase(), `${scenario.market} ${scenario.side} owner mismatch`);
    const [rawCollateral, rawDebt] = await publicClient.readContract({
      address: pool,
      abi: POSITION_POOL_ABI,
      functionName: 'getPosition',
      args: [BigInt(positionId)],
    });
    assert.ok(rawCollateral > 0n && rawDebt > 0n, `${scenario.market} ${scenario.side} did not retain live collateral and debt`);
    const nextPositionId = Number(await publicClient.readContract({ address: pool, abi: POSITION_POOL_ABI, functionName: 'getNextPositionId' }));
    assert.ok(nextPositionId > positionId, `${scenario.market} ${scenario.side} position counter did not advance`);
    positions.push({
      ...scenario,
      pool,
      positionId,
      rawCollateral: rawCollateral.toString(),
      rawDebt: rawDebt.toString(),
    });
    process.stdout.write(`Created fork position ${scenario.market} ${scenario.side} #${positionId}\n`);
  }

  const walletCommitment = createHash('sha256').update(wallet.toLowerCase()).digest('hex');
  const common = {
    schemaVersion: 1,
    proof: 'fxaeon-position-screenshot-fixture',
    chainId: 1,
    forkBlock,
    amountPerPositionUsdc: amountPerPosition.toString(),
    executionSurface: 'node-runner',
    assertions: {
      productionSdkExecution: true,
      ownershipVerified: true,
      nonzeroCollateralAndDebtVerified: true,
    },
  } as const;
  await writeJson(privateManifestPath, {
    ...common,
    wallet,
    positions,
  });
  await writeJson(redactedManifestPath, {
    ...common,
    wallet: redactedWallet(wallet),
    walletCommitment,
    positions: positions.map(({ rawCollateral: _rawCollateral, rawDebt: _rawDebt, ...position }) => position),
  });
  process.stdout.write(`Wrote redacted screenshot fixture manifest for ${positions.length} positions\n`);
}

void main().catch(async (error) => {
  if (fixtureSnapshot) {
    try {
      assert.equal(await rpc<boolean>('evm_revert', [fixtureSnapshot]), true, 'fixture failure snapshot could not be restored');
    } catch {
      process.stderr.write('Fixture rollback failed; the parent orchestrator must restore its pre-fixture snapshot.\n');
    }
  }
  await Promise.all(writtenManifests.map((path) => rm(path, { force: true })));
  process.stderr.write(`Position screenshot fixture failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => clearPendingHashJournalForTests());
