import {
  TransactionReceiptNotFoundError,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { assertPublicClientChain, getPublicClient } from "./clients";
import {
  readPendingHashJournal,
  updatePendingHashRecord,
} from "./journal";
import type {
  FxChainId,
  FxPublicClient,
  PendingHashRecord,
} from "./types";

export type RecoveryStatus = "pending" | "confirmed" | "failed";

export type RecoveryVerification =
  | "receipt"
  | "not-found"
  | "rpc-error"
  | "mismatch";

export type RecoveryViewModel = {
  record: PendingHashRecord;
  /** Derived from the chain receipt, never copied from record.status. */
  status: RecoveryStatus;
  verification: RecoveryVerification;
  explorerUrl: string;
  receiptBlockNumber?: bigint;
  message: string;
};

const MAX_TERMINAL_HISTORY_READS = 8;

type ReceiptClient = Pick<FxPublicClient, "getTransactionReceipt" | "getTransaction" | "getChainId"> & {
  chain?: { id?: number };
};

type Receipt = Awaited<ReturnType<ReceiptClient["getTransactionReceipt"]>>;
type MinedTransaction = Awaited<ReturnType<ReceiptClient["getTransaction"]>>;

const RECEIPT_NOT_FOUND_NAME = "TransactionReceiptNotFoundError";

/** Wallet filtering is case-insensitive, but never permissive about identity. */
export function filterJournalForWallet(
  records: readonly PendingHashRecord[],
  walletAddress: string | undefined,
): PendingHashRecord[] {
  if (!walletAddress || !isAddress(walletAddress)) return [];
  const normalized = walletAddress.toLowerCase();
  return records.filter((record) => record.walletAddress.toLowerCase() === normalized);
}

/**
 * Never age an unresolved transaction or a source-confirmed bridge out of
 * recovery merely because newer activity exists. Only completed non-bridge
 * history is capped; local status is still revalidated from chain receipts.
 */
export function selectRecoveryRecords(
  records: readonly PendingHashRecord[],
  walletAddress: string | undefined,
): PendingHashRecord[] {
  const walletRecords = filterJournalForWallet(records, walletAddress);
  const unresolved = walletRecords.filter((record) => record.status === "pending"
    || (record.operation === "buildBridgeTx" && record.status === "confirmed" && Boolean(record.bridge)));
  const unresolvedIds = new Set(unresolved.map((record) => record.id));
  const terminalHistory = walletRecords
    .filter((record) => !unresolvedIds.has(record.id))
    .slice(-MAX_TERMINAL_HISTORY_READS);
  return [...unresolved, ...terminalHistory]
    .sort((left, right) => left.submittedAt - right.submittedAt);
}

export function explorerTransactionUrl(chainId: FxChainId, hash: Hex): string {
  const host = chainId === 8453 ? "https://basescan.org" : "https://etherscan.io";
  return `${host}/tx/${hash}`;
}

function isReceiptNotFound(error: unknown): boolean {
  if (error instanceof TransactionReceiptNotFoundError) return true;
  if (!error || typeof error !== "object") return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  return name === RECEIPT_NOT_FOUND_NAME;
}

function pendingView(
  record: PendingHashRecord,
  verification: Exclude<RecoveryVerification, "receipt">,
  message: string,
): RecoveryViewModel {
  return {
    record,
    status: "pending",
    verification,
    explorerUrl: explorerTransactionUrl(record.chainId, record.hash),
    message,
  };
}

/**
 * Convert one receipt into a recovery view model. A receipt is accepted only
 * when both its hash and sender match the journal record. Local status is never
 * used as a fallback when a receipt is absent or an RPC request fails.
 */
export function viewModelFromReceipt(
  record: PendingHashRecord,
  receipt: Receipt,
): RecoveryViewModel {
  if (
    receipt.transactionHash.toLowerCase() !== record.hash.toLowerCase()
    || receipt.from.toLowerCase() !== record.walletAddress.toLowerCase()
    || !receipt.to
    || receipt.to.toLowerCase() !== record.to.toLowerCase()
  ) {
    return pendingView(
      record,
      "mismatch",
      "The receipt did not match this wallet and transaction. FxAeon left it unverified.",
    );
  }

  // Do not interpret a malformed or provider-specific status as a revert.
  // Only viem's two terminal receipt statuses can establish a terminal state.
  if (receipt.status !== "success" && receipt.status !== "reverted") {
    return pendingView(
      record,
      "mismatch",
      "The receipt status was not a terminal on-chain result. FxAeon left it unverified.",
    );
  }
  if (typeof receipt.blockNumber !== "bigint" || receipt.blockNumber < 0n) {
    return pendingView(
      record,
      "mismatch",
      "The receipt had no canonical block number. FxAeon left it unverified.",
    );
  }

  const status: RecoveryStatus = receipt.status === "success" ? "confirmed" : "failed";
  const message = status === "confirmed"
    ? "Confirmed on-chain. Re-plan any remaining SDK steps; FxAeon never resumes a later step from local storage."
    : "This transaction reverted on-chain. Re-plan the complete SDK action; later steps were not resumed.";

  return {
    record,
    status,
    verification: "receipt",
    explorerUrl: explorerTransactionUrl(record.chainId, record.hash),
    receiptBlockNumber: receipt.blockNumber,
    message,
  };
}

function minedTransactionMismatch(record: PendingHashRecord, transaction: MinedTransaction): string | null {
  if (!record.dataHash || record.valueWei === undefined || record.nonce === undefined) {
    return "This older recovery entry has no reviewed calldata, value, or nonce fingerprint. FxAeon left it unverified.";
  }
  const input = (transaction as { input?: Hex; data?: Hex }).input
    ?? (transaction as { input?: Hex; data?: Hex }).data;
  if (
    transaction.hash.toLowerCase() !== record.hash.toLowerCase()
    || transaction.from.toLowerCase() !== record.walletAddress.toLowerCase()
    || !transaction.to
    || transaction.to.toLowerCase() !== record.to.toLowerCase()
  ) return "The mined transaction identity did not match the reviewed recovery entry. FxAeon left it unverified.";
  if (!input || keccak256(input).toLowerCase() !== record.dataHash.toLowerCase()) {
    return "The mined calldata did not match the reviewed transaction. FxAeon left it unverified.";
  }
  if (transaction.value.toString() !== record.valueWei || transaction.nonce !== record.nonce) {
    return "The mined value or nonce did not match the reviewed transaction. FxAeon left it unverified.";
  }
  return null;
}

/**
 * Reconcile journal entries for exactly one selected wallet. Errors are
 * represented as still-unverified pending states. In particular, an RPC
 * outage must never turn a transaction into a false failure.
 */
export async function reconcileWalletJournal(params: {
  walletAddress: Address;
  records?: readonly PendingHashRecord[];
  getClient?: (chainId: FxChainId) => ReceiptClient;
}): Promise<RecoveryViewModel[]> {
  const records = selectRecoveryRecords(
    params.records ?? readPendingHashJournal(),
    params.walletAddress,
  );
  const getClient = params.getClient ?? getPublicClient;
  const verifiedClients = new Map<FxChainId, Promise<ReceiptClient>>();

  const clientFor = (chainId: FxChainId): Promise<ReceiptClient> => {
    const existing = verifiedClients.get(chainId);
    if (existing) return existing;
    const pending = (async () => {
      const client = getClient(chainId);
      await assertPublicClientChain(client, chainId);
      return client;
    })();
    verifiedClients.set(chainId, pending);
    return pending;
  };

  return Promise.all(records.map(async (record) => {
    let client: ReceiptClient;
    try {
      client = await clientFor(record.chainId);
      if (client.chain?.id !== undefined && client.chain.id !== record.chainId) {
        return pendingView(
          record,
          "mismatch",
          "The selected RPC is on a different chain. FxAeon did not trust this receipt.",
        );
      }
    } catch (error) {
      return pendingView(
        record,
        "rpc-error",
        "Chain read unavailable. Nothing was marked failed. Retry when the RPC provider is available again.",
      );
    }

    try {
      const receipt = await client.getTransactionReceipt({ hash: record.hash });
      const view = viewModelFromReceipt(record, receipt);
      if (view.verification !== "receipt") return view;
      let transaction: MinedTransaction;
      try {
        transaction = await client.getTransaction({ hash: record.hash });
      } catch {
        return pendingView(record, "rpc-error", "The receipt exists, but the mined transaction could not be read. Nothing was marked complete; retry when the RPC provider is available.");
      }
      const mismatch = minedTransactionMismatch(record, transaction);
      if (mismatch) return pendingView(record, "mismatch", mismatch);
      updatePendingHashRecord(record, view.status === "confirmed" ? "confirmed" : "failed");
      return view;
    } catch (error) {
      return pendingView(
        record,
        isReceiptNotFound(error) ? "not-found" : "rpc-error",
        isReceiptNotFound(error)
          ? "No receipt is available yet. Check again; local storage is not proof of completion."
          : "Chain read unavailable. Nothing was marked failed. Retry when the RPC provider is available again.",
      );
    }
  }));
}
