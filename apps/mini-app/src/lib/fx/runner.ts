import {
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { assertPublicClientChain, getPublicClient } from "./clients";
import { recordPendingHash, updatePendingHashRecord } from "./journal";
import { withWalletChainLock } from "./lock";
import { defaultTransactionPolicy } from "./policy";
import type {
  BridgeRouteQuote,
  FxPublicClient,
  PendingBridgeContext,
  PlannedRoute,
  TransactionExecutionResult,
  TransactionPolicy,
  TransactionRunnerCallbacks,
  TransactionRunnerOptions,
  TransactionStepResult,
  WalletTransactionRequest,
} from "./types";
import { assertNonceMatches, validateRoute } from "./validation";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHash(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("wallet returned an invalid transaction hash");
  return value as Hex;
}

function cloneReviewValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneReviewValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => [key, cloneReviewValue(nested)]),
  );
}

function clonePolicy(policy: TransactionPolicy): TransactionPolicy {
  return {
    ...policy,
    reviewedAction: policy.reviewedAction
      ? cloneReviewValue(policy.reviewedAction) as TransactionPolicy["reviewedAction"]
      : undefined,
    allowedDestinations: policy.allowedDestinations
      ? [...policy.allowedDestinations]
      : undefined,
    allowedApprovalSpenders: policy.allowedApprovalSpenders
      ? [...policy.allowedApprovalSpenders]
      : undefined,
    allowedSelectors: policy.allowedSelectors
      ? Object.fromEntries(
          Object.entries(policy.allowedSelectors)
            .map(([target, selectors]) => [target, [...selectors]]),
        )
      : undefined,
    allowedActionDestinations: policy.allowedActionDestinations
      ? [...policy.allowedActionDestinations]
      : undefined,
    allowedActionSelectors: policy.allowedActionSelectors
      ? Object.fromEntries(
          Object.entries(policy.allowedActionSelectors)
            .map(([target, selectors]) => [target, [...selectors]]),
        )
      : undefined,
    allowedApprovalDestinations: policy.allowedApprovalDestinations
      ? [...policy.allowedApprovalDestinations]
      : undefined,
    allowedTokenApprovalDestinations: policy.allowedTokenApprovalDestinations
      ? [...policy.allowedTokenApprovalDestinations]
      : undefined,
    allowedPositionApprovalDestinations: policy.allowedPositionApprovalDestinations
      ? [...policy.allowedPositionApprovalDestinations]
      : undefined,
  };
}

function pendingBridgeContext(route: PlannedRoute): PendingBridgeContext | undefined {
  if (route.operation !== "buildBridgeTx" || !route.quote || typeof route.quote !== "object") return undefined;
  const quote = route.quote as Partial<BridgeRouteQuote>;
  if (
    !quote.sourceOftAddress
    || !quote.destinationOftAddress
    || !quote.recipient
    || quote.amountLD === undefined
    || quote.minAmountLD === undefined
    || quote.destinationBaselineBlock === undefined
    || (quote.destinationChainId !== 1 && quote.destinationChainId !== 8453)
  ) return undefined;
  return {
    destinationChainId: quote.destinationChainId,
    sourceOftAddress: quote.sourceOftAddress,
    destinationOftAddress: quote.destinationOftAddress,
    recipient: quote.recipient,
    amountLD: quote.amountLD.toString(),
    minAmountLD: quote.minAmountLD.toString(),
    destinationBaselineBlock: quote.destinationBaselineBlock.toString(),
    bridgeToken: typeof quote.bridgeToken === "string" ? quote.bridgeToken.slice(0, 64) : undefined,
  };
}

export async function waitForReceipt(params: {
  client: Pick<PublicClient, "getTransactionReceipt">;
  hash: Hex;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<TransactionReceipt> {
  const timeoutMs = params.timeoutMs ?? 180_000;
  const pollMs = params.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  // A tiny timeout can elapse between computing the deadline and entering the
  // loop when the event loop is busy. Always make the immediate receipt probe;
  // the timeout bounds retries, not whether the already-mined result is read.
  let firstAttempt = true;
  while (firstAttempt || Date.now() < deadline) {
    firstAttempt = false;
    try {
      return await params.client.getTransactionReceipt({ hash: params.hash });
    } catch {
      // viem throws TransactionReceiptNotFoundError until the tx is mined.
    }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`transaction receipt timeout: ${params.hash}`);
}

export async function waitForNextBlock(params: {
  client: Pick<PublicClient, "getBlockNumber">;
  afterBlock: bigint;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<bigint> {
  const timeoutMs = params.timeoutMs ?? 120_000;
  const pollMs = params.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const block = await params.client.getBlockNumber();
    if (block > params.afterBlock) return block;
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`timed out waiting for a block after ${params.afterBlock}`);
}

/**
 * A receipt proves inclusion and status, but does not bind the transaction's
 * calldata, value, or nonce. Read the mined transaction back before marking a
 * step confirmed so a wallet/provider adapter that mutates the request cannot
 * silently turn a reviewed route into a different call.
 */
async function verifySubmittedTransaction(params: {
  client: Pick<PublicClient, "getTransaction">;
  hash: Hex;
  expected: {
    from: string;
    to: string;
    data: string;
    value: bigint;
    nonce: number;
  };
}): Promise<void> {
  const submitted = await params.client.getTransaction({ hash: params.hash });
  if (typeof submitted.hash !== "string" || submitted.hash.toLowerCase() !== params.hash.toLowerCase()) {
    throw new Error("mined transaction hash does not match the submitted transaction");
  }
  const input = (submitted as { input?: string; data?: string }).input
    ?? (submitted as { input?: string; data?: string }).data;
  if (!input || input.toLowerCase() !== params.expected.data.toLowerCase()) {
    throw new Error("mined transaction calldata does not match the reviewed transaction");
  }
  if (
    submitted.from.toLowerCase() !== params.expected.from.toLowerCase()
    || !submitted.to
    || submitted.to.toLowerCase() !== params.expected.to.toLowerCase()
  ) {
    throw new Error("mined transaction sender or destination does not match the reviewed transaction");
  }
  if (submitted.value !== params.expected.value) {
    throw new Error("mined transaction native value does not match the reviewed transaction");
  }
  if (submitted.nonce !== params.expected.nonce) {
    throw new Error("mined transaction nonce does not match the reviewed transaction");
  }
}

/** Fail-closed ordered eth_simulateV1 gate. */
export async function simulatePlannedRoute(
  route: PlannedRoute,
  client: FxPublicClient,
): Promise<{ success: true } | { success: false; error: string; failedTxIndex?: number }> {
  try {
    const result = await client.simulateCalls({
      account: route.walletAddress,
      calls: route.transactions.map((transaction) => ({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      })),
    });
    // A truncated/empty response is not proof that the ordered route is
    // executable. Some RPCs return a partial result when a later call cannot
    // be simulated; fail closed instead of signing an unreviewed step.
    if (!Array.isArray(result.results) || result.results.length !== route.transactions.length) {
      return {
        success: false,
        error: `simulation returned ${Array.isArray(result.results) ? result.results.length : 0} results for ${route.transactions.length} transactions`,
      };
    }
    for (let index = 0; index < result.results.length; index += 1) {
      const item = result.results[index];
      if (item.status !== "success") {
        const error = (item as { error?: { message?: string } }).error?.message ?? "execution reverted";
        return { success: false, error, failedTxIndex: index };
      }
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `simulation unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function makeFailureResult(
  route: PlannedRoute,
  steps: TransactionStepResult[],
  error: string,
): TransactionExecutionResult {
  const hasConfirmedStep = steps.some((step) => step.status === "confirmed");
  return {
    status: hasConfirmedStep ? "partial" : "failed",
    operation: route.operation,
    chainId: route.chainId,
    walletAddress: route.walletAddress,
    steps,
    error,
  };
}

/**
 * Execute one SDK-provided route through an injected Privy wallet callback.
 * No private key, delegated signer, raw broadcast, or server authority is
 * used here. Each step is explicitly approved and receipt-confirmed before
 * the following SDK step can be submitted.
 */
export async function runTransactionRoute(params: {
  route: PlannedRoute;
  callbacks: TransactionRunnerCallbacks;
  policy?: TransactionPolicy;
  publicClient?: FxPublicClient;
  options?: TransactionRunnerOptions;
}): Promise<TransactionExecutionResult> {
  // Snapshot the reviewed route before acquiring the cross-tab lock. A
  // mutable page object must not be able to change calldata or recipients
  // while another route is finishing its receipt wait.
  const route: PlannedRoute = {
    ...params.route,
    transactions: params.route.transactions.map((transaction) => ({ ...transaction })),
    details: params.route.details
      ? cloneReviewValue(params.route.details) as PlannedRoute["details"]
      : undefined,
    quote: cloneReviewValue(params.route.quote),
    policy: params.route.policy ? clonePolicy(params.route.policy) : undefined,
  };
  const policy = clonePolicy(params.policy ?? defaultTransactionPolicy(route));
  const options = params.options ?? {};
  validateRoute(route, policy);
  const client = params.publicClient ?? getPublicClient(route.chainId);
  if (client.chain?.id !== undefined && client.chain.id !== route.chainId) {
    throw new Error("public client chain does not match the transaction route");
  }
  // Observer callbacks update UI only. They must never prevent journaling,
  // receipt waiting, failure-stop behavior, or a later authoritative reread.
  const notifyStatus = (status: Parameters<NonNullable<TransactionRunnerCallbacks["onStatus"]>>[0], detail?: string): void => {
    try { params.callbacks.onStatus?.(status, detail); } catch { /* UI observers are non-authoritative */ }
  };
  const notifyStep = (step: TransactionStepResult): void => {
    try { params.callbacks.onStep?.({ ...step }); } catch { /* UI observers are non-authoritative */ }
  };

  return withWalletChainLock({
    walletAddress: route.walletAddress,
    chainId: route.chainId,
    // Browser signing fails closed without Web Locks. A localStorage lease
    // cannot stay authoritative when a Telegram WebView suspends JavaScript
    // during an external wallet prompt.
    requireWebLocks: typeof window !== "undefined",
    run: async (assertLockOwned) => {
      // Revalidate after waiting for another in-flight route. This is cheap
      // and protects callers that hand us mutable route/policy objects.
      validateRoute(route, policy);
      await assertPublicClientChain(client, route.chainId);
      notifyStatus("planning");
      if (options.simulate !== false) {
        notifyStatus("reviewing", "Checking the ordered route on-chain");
        const simulation = params.callbacks.simulate
          ? await params.callbacks.simulate(route, client)
          : await simulatePlannedRoute(route, client);
        if (simulation !== true && !simulation.success) {
          const detail = "error" in simulation ? simulation.error : "simulation failed";
          notifyStatus("failed", detail);
          return makeFailureResult(route, [], detail);
        }
      }

      const steps: TransactionStepResult[] = [];

      /**
       * Refresh protocol state only after at least one submitted transaction
       * has a receipt and the following block boundary has been observed.
       * This applies to partially completed routes too: an approval may have
       * succeeded before the user rejects, or the protocol action reverts.
       */
      const runPostConfirmRead = async (
        result: TransactionExecutionResult,
      ): Promise<void> => {
        const refreshStatus = result.status === "confirmed"
          ? "confirmed"
          : result.status === "partial"
            ? "partial"
            : "failed";
        const latestReceipt = [...steps]
          .reverse()
          .find((candidate) => candidate.receipt)?.receipt;
        if (!latestReceipt) return;

        let postConfirmReadSafe = options.waitForNextBlock === false;
        if (options.waitForNextBlock !== false) {
          try {
            await waitForNextBlock({
              client,
              afterBlock: latestReceipt.blockNumber,
              timeoutMs: options.receiptTimeoutMs,
              pollMs: options.pollMs,
            });
            postConfirmReadSafe = true;
          } catch (error) {
            // A mined transaction cannot be undone. Keep that truth visible,
            // but never present a state read as fresh until a later block is
            // independently observed.
            notifyStatus(
              refreshStatus,
              `receipt confirmed; post-confirm block wait unavailable: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        if (!postConfirmReadSafe) {
          notifyStatus(
            refreshStatus,
            "transaction receipt confirmed; retry the state read after a new block is observed",
          );
          return;
        }

        try {
          await params.callbacks.postConfirmRead?.(route, result);
        } catch (error) {
          notifyStatus(
            refreshStatus,
            `transaction receipt confirmed; post-confirm state read failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };

      for (let index = 0; index < route.transactions.length; index += 1) {
        const transaction = route.transactions[index];
        const step: TransactionStepResult = {
          index,
          transaction,
          status: "submitted",
        };
        steps.push(step);
        const label = `transaction ${index + 1} of ${route.transactions.length}`;
        try {
          // Storage leases can expire while a Telegram WebView is suspended
          // inside another tab's wallet prompt. Revalidate immediately before
          // each reviewed step and again after nonce reconciliation, directly
          // before the Privy signing boundary.
          assertLockOwned();
          await params.callbacks.ensureChain?.(route.chainId);
          // Re-probe the read endpoint immediately before nonce authority is
          // accepted. Static viem chain metadata is not an eth_chainId proof.
          await assertPublicClientChain(client, route.chainId);
          notifyStatus("awaiting-user", label);
          const pendingNonce = Number(await client.getTransactionCount({
            address: route.walletAddress,
            blockTag: "pending",
          }));
          const nonce = assertNonceMatches(transaction, pendingNonce);
          assertLockOwned();
          const request: WalletTransactionRequest = {
            chainId: route.chainId,
            from: route.walletAddress,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
            nonce,
          };
          const hash = normalizeHash(await params.callbacks.requestSignature(request));
          step.hash = hash;
          const pendingRecord = recordPendingHash({
            operation: route.operation,
            walletAddress: route.walletAddress,
            chainId: route.chainId,
            hash,
            to: transaction.to,
            nonce,
            data: transaction.data,
            value: transaction.value,
            bridge: transaction.kind === "action" ? pendingBridgeContext(route) : undefined,
          });
          notifyStep(step);
          notifyStatus("submitted", `${label}: ${hash}`);

          const receipt = await waitForReceipt({
            client,
            hash,
            timeoutMs: options.receiptTimeoutMs,
            pollMs: options.pollMs,
          });
          if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
            throw new Error(`${label} receipt hash does not match the submitted transaction`);
          }
          if (typeof receipt.blockNumber !== "bigint" || receipt.blockNumber < 0n) {
            throw new Error(`${label} receipt is missing a canonical block number`);
          }
          if (receipt.status !== "success" && receipt.status !== "reverted") {
            throw new Error(`${label} receipt does not contain a terminal on-chain status`);
          }
          // Once the submitted hash has a receipt, the chain may already have
          // mutated even if a later sender/destination/calldata verification
          // fails. Preserve that receipt on the failed step so the shared
          // failure path waits for the next block and rereads official state.
          step.receipt = receipt;
          if (
            receipt.from.toLowerCase() !== transaction.from.toLowerCase()
            || !receipt.to
            || receipt.to.toLowerCase() !== transaction.to.toLowerCase()
          ) {
            throw new Error(`${label} receipt sender or destination does not match the reviewed transaction`);
          }
          await verifySubmittedTransaction({
            client,
            hash,
            expected: {
              from: transaction.from,
              to: transaction.to,
              data: transaction.data,
              value: transaction.value,
              nonce,
            },
          });
          if (receipt.status !== "success") {
            updatePendingHashRecord(pendingRecord, "failed");
            step.status = "failed";
            step.error = `${label} reverted on-chain: ${hash}`;
            notifyStep(step);
            notifyStatus("failed", step.error);
            const failure = makeFailureResult(route, steps, step.error);
            await runPostConfirmRead(failure);
            return failure;
          }
          updatePendingHashRecord(pendingRecord, "confirmed");
          step.status = "confirmed";
          notifyStep(step);
          notifyStatus("confirmed", `${label}: ${hash}`);
        } catch (error) {
          step.status = "failed";
          step.error = error instanceof Error ? error.message : String(error);
          notifyStep(step);
          notifyStatus("failed", step.error);
          const failure = makeFailureResult(route, steps, step.error);
          await runPostConfirmRead(failure);
          return failure;
        }
      }

      const result: TransactionExecutionResult = {
        status: "confirmed",
        operation: route.operation,
        chainId: route.chainId,
        walletAddress: route.walletAddress,
        steps,
      };
      await runPostConfirmRead(result);
      notifyStatus("confirmed", "All route steps confirmed");
      return result;
    },
  });
}
