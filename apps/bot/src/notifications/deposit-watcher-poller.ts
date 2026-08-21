/**
 * Deposit watcher poller.
 *
 * Each watcher persists three pieces of chain state:
 * - `fromBlock`: the activation block (never moves)
 * - `lastCheckedBlock`: the last block whose ERC-20 logs were fully scanned
 * - `ethBalanceBaselineWei`: the last observed native balance
 *
 * Keeping the cursor and balance in Postgres makes detection restart-safe.
 * Legacy rows are bootstrapped at the current head without treating an
 * already-funded wallet as a new deposit.
 */
import { prisma } from "@fxaeon/db";
import { ADDRESSES } from "@fxaeon/shared";
import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { botLogger } from "../middleware/logger.js";
import { heartbeat } from "../core/metrics.js";

const POLL_INTERVAL_MS = 30_000;
const WATCHER_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

const WATCHED_TOKENS: ReadonlyArray<{
  symbol: string;
  address: `0x${string}`;
}> = [
  { symbol: "fxUSD", address: ADDRESSES.FXUSD as `0x${string}` },
  { symbol: "wstETH", address: ADDRESSES.WSTETH as `0x${string}` },
  { symbol: "WBTC", address: ADDRESSES.WBTC as `0x${string}` },
  { symbol: "USDC", address: ADDRESSES.USDC as `0x${string}` },
  { symbol: "USDT", address: ADDRESSES.USDT as `0x${string}` },
  { symbol: "WETH", address: ADDRESSES.WETH as `0x${string}` },
];

let timer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let pollCount = 0;
let lastBlockChecked = 0n;

export function getDepositRpcUrl(
  processEnv: NodeJS.ProcessEnv = process.env
): string {
  const rpcUrl = processEnv.ALCHEMY_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error("ALCHEMY_RPC_URL is required for deposit watching");
  }
  return rpcUrl;
}

function getClient(): PublicClient {
  return createPublicClient({
    chain: mainnet,
    transport: http(getDepositRpcUrl()),
  });
}

interface ActiveWatcher {
  id: string;
  userId: string;
  walletAddress: `0x${string}`;
  telegramId: string;
  fromBlock: bigint;
  lastCheckedBlock: bigint | null;
  ethBalanceBaselineWei: bigint | null;
}

interface RuntimeWatcher extends ActiveWatcher {
  scanAfterBlock: bigint;
  baselineWei: bigint;
  observedBalanceWei: bigint;
}

async function getActiveWatchers(): Promise<ActiveWatcher[]> {
  const watchers = await prisma.depositWatcher.findMany({
    where: {
      firedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: { walletAddress: true, telegramId: true },
      },
    },
  });

  return watchers.map((watcher) => ({
    id: watcher.id,
    userId: watcher.userId,
    walletAddress: watcher.user.walletAddress as `0x${string}`,
    telegramId: watcher.user.telegramId,
    fromBlock: watcher.fromBlock,
    lastCheckedBlock: watcher.lastCheckedBlock,
    ethBalanceBaselineWei: watcher.ethBalanceBaselineWei,
  }));
}

/**
 * Capture the activation block and native-balance baseline before creating a
 * watcher. A deposit that predates this snapshot is intentionally not a new
 * deposit; the first scan begins at the following block.
 */
export async function activateDepositWatcher(
  userId: string,
  walletAddress: string,
  client: PublicClient = getClient()
) {
  const address = walletAddress as `0x${string}`;
  const fromBlock = await client.getBlockNumber();
  // Pin the balance read to the activation block. Reading both at "latest"
  // concurrently has a race where a deposit lands between the two calls,
  // enters the baseline, and is then excluded from the subsequent log scan.
  const ethBalanceBaselineWei = await client.getBalance({
    address,
    blockNumber: fromBlock,
  });

  return prisma.depositWatcher.create({
    data: {
      userId,
      fromBlock,
      lastCheckedBlock: fromBlock,
      ethBalanceBaselineWei,
      expiresAt: new Date(Date.now() + WATCHER_LIFETIME_MS),
    },
  });
}

async function bootstrapWatcher(
  client: PublicClient,
  watcher: ActiveWatcher,
  currentBlock: bigint
): Promise<RuntimeWatcher> {
  const observedBalanceWei = await client.getBalance({
    address: watcher.walletAddress,
    blockNumber: currentBlock,
  });

  // Old rows used zero as a placeholder rather than a real activation block.
  // Establish their activation at the current head so we neither scan from
  // genesis nor report an existing balance as a fresh deposit.
  const fromBlock = watcher.fromBlock > 0n ? watcher.fromBlock : currentBlock;
  const lastCheckedBlock =
    watcher.lastCheckedBlock ??
    (watcher.fromBlock > 0n && fromBlock > 0n ? fromBlock - 1n : currentBlock);
  const baselineWei = watcher.ethBalanceBaselineWei ?? observedBalanceWei;

  if (
    fromBlock !== watcher.fromBlock ||
    lastCheckedBlock !== watcher.lastCheckedBlock ||
    watcher.ethBalanceBaselineWei === null
  ) {
    await prisma.depositWatcher.update({
      where: { id: watcher.id },
      data: {
        fromBlock,
        lastCheckedBlock,
        ethBalanceBaselineWei: baselineWei,
      },
    });
  }

  return {
    ...watcher,
    fromBlock,
    lastCheckedBlock,
    ethBalanceBaselineWei: baselineWei,
    scanAfterBlock: lastCheckedBlock,
    baselineWei,
    observedBalanceWei,
  };
}

async function notifyAndMarkFired(
  watcher: RuntimeWatcher,
  message: string,
  sendDm: (telegramId: string, msg: string) => Promise<void>
): Promise<boolean> {
  try {
    // Send first. If the process dies between these operations, a duplicate is
    // preferable to permanently losing the only deposit notification.
    await sendDm(watcher.telegramId, message);
    await prisma.depositWatcher.update({
      where: { id: watcher.id },
      data: { firedAt: new Date() },
    });
    return true;
  } catch (error) {
    botLogger.warn(
      { watcherId: watcher.id, error: String(error) },
      "deposit-watcher: notification failed; retaining cursor for retry"
    );
    return false;
  }
}

/** Execute one complete, testable poll cycle. */
export async function pollDepositWatchersOnce(
  client: PublicClient,
  sendDm: (telegramId: string, msg: string) => Promise<void>
): Promise<void> {
  heartbeat("deposit-watcher-poller");
  pollCount++;
  const storedWatchers = await getActiveWatchers();
  if (storedWatchers.length === 0) return;

  const currentBlock = await client.getBlockNumber();
  const watchers: RuntimeWatcher[] = [];

  for (const watcher of storedWatchers) {
    try {
      watchers.push(await bootstrapWatcher(client, watcher, currentBlock));
    } catch (error) {
      botLogger.warn(
        { watcherId: watcher.id, error: String(error) },
        "deposit-watcher: unable to bootstrap watcher"
      );
    }
  }
  if (watchers.length === 0) return;

  const watchersByAddress = new Map<string, RuntimeWatcher[]>();
  for (const watcher of watchers) {
    const key = watcher.walletAddress.toLowerCase();
    const matches = watchersByAddress.get(key) ?? [];
    matches.push(watcher);
    watchersByAddress.set(key, matches);
  }

  const firstBlockToScan = watchers.reduce((minimum, watcher) => {
    const next = watcher.scanAfterBlock + 1n;
    return next < minimum ? next : minimum;
  }, currentBlock + 1n);

  const firedWatcherIds = new Set<string>();
  const failedWatcherIds = new Set<string>();
  const attemptedWatcherIds = new Set<string>();

  if (firstBlockToScan <= currentBlock) {
    const walletAddresses = [...watchersByAddress.keys()] as `0x${string}`[];

    // Do not advance any cursor unless every token query succeeds. Otherwise a
    // transient provider error could permanently skip a deposit in that range.
    for (const token of WATCHED_TOKENS) {
      const logs = await client.getLogs({
        address: token.address,
        event: ERC20_TRANSFER_EVENT,
        args: { to: walletAddresses },
        fromBlock: firstBlockToScan,
        toBlock: currentBlock,
      });

      for (const log of logs) {
        const to = log.args.to?.toLowerCase();
        const from = log.args.from?.toLowerCase();
        const value = log.args.value;
        const blockNumber = log.blockNumber;
        // Zero-value and self-transfer events do not fund the wallet and must
        // not consume a one-shot deposit watcher.
        if (
          !to ||
          blockNumber === null ||
          value === undefined ||
          value <= 0n ||
          from === to
        ) {
          continue;
        }

        for (const watcher of watchersByAddress.get(to) ?? []) {
          const watcherFirstBlock = watcher.scanAfterBlock + 1n;
          if (
            blockNumber < watcherFirstBlock ||
            blockNumber < watcher.fromBlock ||
            firedWatcherIds.has(watcher.id) ||
            attemptedWatcherIds.has(watcher.id)
          ) {
            continue;
          }

          attemptedWatcherIds.add(watcher.id);
          const transactionLine = log.transactionHash
            ? `Tx: https://etherscan.io/tx/${log.transactionHash}\n\n`
            : "";
          const delivered = await notifyAndMarkFired(
            watcher,
            `🔔 Deposit detected!\n\n${token.symbol} received at your wallet.\n` +
              transactionLine +
              "You're ready to use your funds in FxAeon.",
            sendDm
          );
          (delivered ? firedWatcherIds : failedWatcherIds).add(watcher.id);
        }
      }
    }
  }

  // Native ETH transfers have no event log. A persisted positive balance
  // delta catches EOAs, contracts, and internal transfers without inspecting
  // every transaction in every block.
  for (const watcher of watchers) {
    if (
      firedWatcherIds.has(watcher.id) ||
      failedWatcherIds.has(watcher.id) ||
      currentBlock < watcher.scanAfterBlock
    ) {
      continue;
    }

    if (watcher.observedBalanceWei > watcher.baselineWei) {
      attemptedWatcherIds.add(watcher.id);
      const delivered = await notifyAndMarkFired(
        watcher,
        "🔔 Deposit detected!\n\nETH received at your wallet.\n\n" +
          "You're ready to use your funds in FxAeon.",
        sendDm
      );
      (delivered ? firedWatcherIds : failedWatcherIds).add(watcher.id);
    }
  }

  // Persist progress independently per watcher. Notification failures retain
  // the previous cursor and baseline so the matching event is retried.
  for (const watcher of watchers) {
    if (
      firedWatcherIds.has(watcher.id) ||
      failedWatcherIds.has(watcher.id) ||
      currentBlock < watcher.scanAfterBlock
    ) {
      continue;
    }
    try {
      await prisma.depositWatcher.update({
        where: { id: watcher.id },
        data: {
          lastCheckedBlock: currentBlock,
          ethBalanceBaselineWei: watcher.observedBalanceWei,
        },
      });
    } catch (error) {
      botLogger.warn(
        { watcherId: watcher.id, error: String(error) },
        "deposit-watcher: unable to persist scan progress"
      );
    }
  }

  lastBlockChecked = currentBlock;
}

async function runPollCycle(
  client: PublicClient,
  sendDm: (telegramId: string, msg: string) => Promise<void>
): Promise<void> {
  if (pollInFlight) {
    botLogger.warn("deposit-watcher: previous poll still running; skipping overlap");
    return;
  }

  pollInFlight = true;
  try {
    await pollDepositWatchersOnce(client, sendDm);
  } catch (error) {
    botLogger.error({ error: String(error) }, "deposit-watcher: poll cycle failed");
  } finally {
    pollInFlight = false;
  }
}

/** Start the poller and run its first cycle immediately. */
export function startDepositWatcherPoller(
  sendDm: (telegramId: string, msg: string) => Promise<void>
): void {
  if (timer) return;
  const client = getClient();

  timer = setInterval(() => {
    void runPollCycle(client, sendDm);
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  void runPollCycle(client, sendDm);

  botLogger.info("deposit-watcher poller started (30s interval)");
}

export function stopDepositWatcherPoller(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  botLogger.info("deposit-watcher poller stopped");
}

export function getDepositWatcherStats(): {
  pollCount: number;
  lastBlockChecked: string;
  running: boolean;
} {
  return {
    pollCount,
    lastBlockChecked: lastBlockChecked.toString(),
    running: timer !== null,
  };
}
