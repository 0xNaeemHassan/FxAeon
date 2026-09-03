import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  type Address,
  type Hex,
} from "viem";
import { erc20Abi } from "viem";
import { mainnet } from "viem/chains";
import { QueryObserver } from "@tanstack/react-query";
import {
  createWalletDataConfig,
  type WalletDataConfig,
} from "../src/lib/web3/config";
import {
  createWalletQueryClient,
  invalidateWalletQueries,
  moveBalanceQueryOptions,
  readWagmiWalletBalances,
  walletBalanceQueryKey,
  walletBalanceQueryOptions,
} from "../src/lib/web3/walletQueries";
import { FX_TOKENS } from "../src/lib/fx/tokens";
import { canonicalMoveSourceTokenAddress } from "../src/lib/moveBalances";

const wallet = "0x0000000000000000000000000000000000001234" as Address;
const otherWallet = "0x0000000000000000000000000000000000005678" as Address;

type MockRpcState = {
  remoteChainId: number;
  nativeBalances: Map<string, bigint>;
  tokenBalances: Map<string, bigint>;
  failedTokenAddresses: Set<string>;
  multicallTargets: string[];
  calls: string[];
  delayMs: number;
  failNative: boolean;
  blockNextNative: boolean;
  blockedNativeValue?: bigint;
  releaseBlockedNative?: () => void;
};

function quantity(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

function encodedBalance(value: bigint): Hex {
  return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: value });
}

function createMockClient(state: MockRpcState, chain = mainnet) {
  const provider = {
    request: async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      state.calls.push(method);
      if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (method === "eth_chainId") return quantity(BigInt(state.remoteChainId));
      if (method === "eth_getBalance") {
        const address = String(params?.[0] ?? "").toLowerCase();
        const nativeValue = state.nativeBalances.get(address) ?? 0n;
        if (state.failNative) throw new Error("mock native balance unavailable");
        if (state.blockNextNative) {
          state.blockNextNative = false;
          state.blockedNativeValue = nativeValue;
          await new Promise<void>((resolve) => { state.releaseBlockedNative = resolve; });
          return quantity(state.blockedNativeValue ?? nativeValue);
        }
        return quantity(nativeValue);
      }
      if (method === "eth_call") {
        const call = (params?.[0] ?? {}) as { data?: Hex };
        const data = call.data ?? "0x";
        const decoded = decodeFunctionData({ abi: multicall3Abi, data });
        if (decoded.functionName !== "aggregate3") return "0x";
        const calls = decoded.args[0];
        const results = calls.map((item) => {
          const target = item.target.toLowerCase();
          state.multicallTargets.push(target);
          if (state.failedTokenAddresses.has(target)) return { success: false, returnData: "0x" as Hex };
          return {
            success: true,
            returnData: encodedBalance(state.tokenBalances.get(target) ?? 0n),
          };
        });
        return encodeFunctionResult({
          abi: multicall3Abi,
          functionName: "aggregate3",
          result: results,
        });
      }
      throw new Error(`unexpected mock RPC method ${method}`);
    },
  };
  return createPublicClient({ chain, transport: custom(provider) });
}

function makeState(): MockRpcState {
  const tokenBalances = new Map<string, bigint>();
  Object.values(FX_TOKENS).forEach((token, index) => {
    if (!token.native) tokenBalances.set(token.address.toLowerCase(), BigInt(index + 1) * 10n ** 6n);
  });
  return {
    remoteChainId: 1,
    nativeBalances: new Map([[wallet.toLowerCase(), 900719925474099312345678n]]),
    tokenBalances,
    failedTokenAddresses: new Set(),
    multicallTargets: [],
    calls: [],
    delayMs: 0,
    failNative: false,
    blockNextNative: false,
  };
}

function configFor(state: MockRpcState): WalletDataConfig {
  const client = createMockClient(state);
  return createWalletDataConfig(() => client as never);
}

function resultFor(amountWei: bigint) {
  return { balances: [{ key: "ETH" as const, address: FX_TOKENS.ETH.address, decimals: 18, amountWei }], failedTokens: [] };
}

test("wallet data config is read-only and has no connector/discovery/storage surface", () => {
  const config = createWalletDataConfig(() => ({}) as never);
  assert.deepEqual(config.chains.map((chain) => chain.id), [1, 8453]);
  assert.deepEqual(config.connectors, []);
  assert.equal(config.storage, null);
  assert.equal(config._internal.ssr, false);
  assert.equal(config._internal.syncConnectedChain, false);
  assert.equal(config._internal.mipd, undefined);
  assert.equal("connect" in config, false);
  assert.equal("disconnect" in config, false);
  assert.equal(typeof config.getClient, "function");
});

test("reads exact native/ERC20 bigint balances while preserving partial token failures", async () => {
  const state = makeState();
  const usdc = FX_TOKENS.USDC.address.toLowerCase();
  state.tokenBalances.set(usdc, 900719925474099312345678n);
  state.failedTokenAddresses.add(FX_TOKENS.fxUSD.address.toLowerCase());
  const result = await readWagmiWalletBalances(configFor(state), wallet, 1);
  assert.equal(result.balances.find((balance) => balance.key === "ETH")?.amountWei, 900719925474099312345678n);
  assert.equal(result.balances.find((balance) => balance.key === "USDC")?.amountWei, 900719925474099312345678n);
  assert.ok(result.failedTokens.includes("fxUSD"));
  assert.ok(!result.balances.some((balance) => balance.key === "fxUSD"));
  state.failNative = true;
  const partialNative = await readWagmiWalletBalances(configFor(state), wallet, 1);
  assert.ok(partialNative.failedTokens.includes("ETH"));
  assert.ok(partialNative.balances.some((balance) => balance.key === "USDC" && balance.amountWei === 900719925474099312345678n));
});

test("rejects RPC chain mismatch before any native or ERC20 balance read", async () => {
  const state = makeState();
  state.remoteChainId = 8453;
  await assert.rejects(readWagmiWalletBalances(configFor(state), wallet, 1), /RPC endpoint returned chain 8453/);
  assert.equal(state.calls.filter((method) => method === "eth_getBalance" || method === "eth_call").length, 0);
});

test("blocks unsupported chains before consulting a client", async () => {
  const state = makeState();
  await assert.rejects(readWagmiWalletBalances(configFor(state), wallet, 8453), /available on Ethereum only/);
  assert.deepEqual(state.calls, []);
});

test("deduplicates concurrent observers and direct QueryClient calls by session/address/chain key", async () => {
  const state = makeState();
  state.delayMs = 10;
  const config = configFor(state);
  const queryClient = createWalletQueryClient();
  const options = walletBalanceQueryOptions(config, "session-a", wallet, 1);
  const observerA = new QueryObserver(queryClient, options);
  const observerB = new QueryObserver(queryClient, options);
  const unsubscribeA = observerA.subscribe(() => undefined);
  const unsubscribeB = observerB.subscribe(() => undefined);
  await Promise.all([
    observerA.refetch(),
    observerB.refetch(),
    queryClient.fetchQuery(options),
  ]);
  assert.equal(state.calls.filter((method) => method === "eth_getBalance").length, 1);
  assert.equal(state.calls.filter((method) => method === "eth_call").length, 1);
  unsubscribeA();
  unsubscribeB();
  const other = await queryClient.fetchQuery(walletBalanceQueryOptions(config, "session-a", otherWallet, 1));
  assert.ok(other.balances.length > 0);
  assert.equal(state.calls.filter((method) => method === "eth_getBalance").length, 2);
  assert.notDeepEqual(
    queryClient.getQueryData(walletBalanceQueryKey("session-a", wallet, 1)),
    queryClient.getQueryData(walletBalanceQueryKey("session-a", otherWallet, 1)),
  );
  queryClient.clear();
});

test("expires stale wallet data and retries a previously failed query", async () => {
  const state = makeState();
  const config = configFor(state);
  const queryClient = createWalletQueryClient();
  const options = walletBalanceQueryOptions(config, "session-a", wallet, 1);
  await queryClient.fetchQuery({ ...options, staleTime: 10 });
  const callsAfterFirstRead = state.calls.length;
  await queryClient.fetchQuery({ ...options, staleTime: 10 });
  assert.equal(state.calls.length, callsAfterFirstRead, "fresh balance query unexpectedly refetched");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await queryClient.fetchQuery({ ...options, staleTime: 10 });
  assert.ok(state.calls.length > callsAfterFirstRead, "stale balance query did not refetch");

  state.failNative = true;
  state.failedTokenAddresses = new Set(Object.values(FX_TOKENS).filter((token) => !token.native).map((token) => token.address.toLowerCase()));
  const failedOptions = { ...options, queryKey: walletBalanceQueryKey("session-failed", wallet, 1), retry: false };
  await assert.rejects(queryClient.fetchQuery(failedOptions), /temporarily unavailable/);
  state.failNative = false;
  state.failedTokenAddresses.clear();
  const recovered = await queryClient.fetchQuery(failedOptions);
  assert.ok(recovered.balances.length > 0, "failed wallet query did not retry after recovery");
  queryClient.clear();
});

test("isolates session and network cache entries and invalidates only the requested wallet/chain", async () => {
  const queryClient = createWalletQueryClient();
  const target = walletBalanceQueryKey("session-a", wallet, 1);
  const otherSession = walletBalanceQueryKey("session-b", wallet, 1);
  const otherAddress = walletBalanceQueryKey("session-a", otherWallet, 1);
  const otherChain = walletBalanceQueryKey("session-a", wallet, 8453);
  for (const key of [target, otherSession, otherAddress, otherChain]) queryClient.setQueryData(key, resultFor(1n));
  await invalidateWalletQueries(queryClient, wallet, 1);
  assert.equal(queryClient.getQueryState(target)?.isInvalidated, true);
  assert.equal(queryClient.getQueryState(otherSession)?.isInvalidated, true);
  assert.equal(queryClient.getQueryState(otherAddress)?.isInvalidated, false);
  assert.equal(queryClient.getQueryState(otherChain)?.isInvalidated, false);
  queryClient.clear();
});

test("move balance queries read canonical source token addresses on Ethereum and Base", async () => {
  const state = makeState();
  const config = configFor(state);
  const queryClient = createWalletQueryClient();
  state.multicallTargets = [];
  state.remoteChainId = 1;
  await queryClient.fetchQuery(moveBalanceQueryOptions(config, "session-a", wallet, 1));
  assert.deepEqual(
    [...new Set(state.multicallTargets)].sort(),
    ["fxUSD", "fxSAVE"].map((token) => canonicalMoveSourceTokenAddress(token as "fxUSD" | "fxSAVE", 1).toLowerCase()).sort(),
  );
  state.multicallTargets = [];
  state.remoteChainId = 8453;
  await queryClient.fetchQuery(moveBalanceQueryOptions(config, "session-a", wallet, 8453));
  assert.deepEqual(
    [...new Set(state.multicallTargets)].sort(),
    ["fxUSD", "fxSAVE"].map((token) => canonicalMoveSourceTokenAddress(token as "fxUSD" | "fxSAVE", 8453).toLowerCase()).sort(),
  );
  queryClient.clear();
});

test("in-flight pre-receipt reads are canceled before active refresh can replace them", async () => {
  const state = makeState();
  state.blockNextNative = true;
  const config = configFor(state);
  const queryClient = createWalletQueryClient();
  const options = walletBalanceQueryOptions(config, "session-a", wallet, 1);
  const observer = new QueryObserver(queryClient, options);
  const unsubscribe = observer.subscribe(() => undefined);
  const oldRead = observer.refetch();
  while (!state.releaseBlockedNative) await new Promise((resolve) => setTimeout(resolve, 1));
  state.nativeBalances.set(wallet.toLowerCase(), 777n);
  const refresh = invalidateWalletQueries(queryClient, wallet, 1);
  state.releaseBlockedNative();
  await refresh;
  await oldRead.catch(() => undefined);
  const current = queryClient.getQueryData(options.queryKey);
  assert.equal(current?.balances.find((balance) => balance.key === "ETH")?.amountWei, 777n);
  unsubscribe();
  queryClient.clear();
});

test("a later receipt refresh during an earlier read gets a trailing network read", async () => {
  const state = makeState();
  const config = configFor(state);
  const queryClient = createWalletQueryClient();
  const options = walletBalanceQueryOptions(config, "session-a", wallet, 1);
  const observer = new QueryObserver(queryClient, options);
  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();
  state.calls = [];
  state.delayMs = 15;
  const firstRefresh = invalidateWalletQueries(queryClient, wallet, 1);
  while (state.calls.filter((method) => method === "eth_getBalance").length < 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  state.nativeBalances.set(wallet.toLowerCase(), 777n);
  const trailingRefresh = invalidateWalletQueries(queryClient, wallet, 1);
  await Promise.all([firstRefresh, trailingRefresh]);
  const current = queryClient.getQueryData(options.queryKey);
  assert.equal(current?.balances.find((balance) => balance.key === "ETH")?.amountWei, 777n);
  assert.ok(state.calls.filter((method) => method === "eth_getBalance").length >= 2, "trailing refresh did not issue a second network read");
  unsubscribe();
  queryClient.clear();
});

test("canceled old balance reads cannot repopulate the current cache", async () => {
  const state = makeState();
  state.blockNextNative = true;
  const config = configFor(state);
  const queryClient = createWalletQueryClient();
  const key = walletBalanceQueryKey("session-a", wallet, 1);
  const oldQuery = queryClient.fetchQuery({
    ...walletBalanceQueryOptions(config, "session-a", wallet, 1),
    queryKey: key,
  });
  while (!state.releaseBlockedNative) await new Promise((resolve) => setTimeout(resolve, 1));
  await queryClient.cancelQueries({ queryKey: key });
  state.releaseBlockedNative();
  await assert.rejects(oldQuery);
  assert.equal(queryClient.getQueryData(key), undefined);
  const current = await queryClient.fetchQuery(walletBalanceQueryOptions(config, "session-b", wallet, 1));
  assert.ok(current.balances.length > 0);
  assert.equal(queryClient.getQueryData(key), undefined);
  queryClient.clear();
});
