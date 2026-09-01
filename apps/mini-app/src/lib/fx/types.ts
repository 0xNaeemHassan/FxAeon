import type {
  Address,
  Hex,
  PublicClient,
  TransactionReceipt,
} from "viem";
import type { FxSdk } from "@aladdindao/fx-sdk";

/** The two chains supported by the official bridge surface. */
export type FxChainId = 1 | 8453;

/** The exact public capability surface supported by fx-sdk-skill. */
export const OFFICIAL_FX_METHODS = [
  "getPositions",
  "increasePosition",
  "reducePosition",
  "adjustPositionLeverage",
  "depositAndMint",
  "repayAndWithdraw",
  "getBridgeQuote",
  "buildBridgeTx",
  "getFxSaveBalance",
  "getFxSaveConfig",
  "getFxSaveRedeemStatus",
  "getFxSaveClaimable",
  "getRedeemTx",
  "depositFxSave",
  "withdrawFxSave",
] as const;

export type OfficialFxMethod = (typeof OFFICIAL_FX_METHODS)[number];

/**
 * A transaction produced by the official SDK, normalized for a wallet
 * adapter. The SDK plans transactions; it never signs or broadcasts them.
 */
export interface PlannedTransaction {
  chainId: FxChainId;
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  /** SDK-provided nonce, when available. Bridge txs omit it. */
  nonce?: number;
  /** SDK metadata such as approveToken, approvePosition, or action. */
  type?: string;
  kind: "approval" | "action" | "unknown";
  /** Identifies the source operation for review and policy checks. */
  operation: OfficialFxMethod;
}

export interface RouteDetails {
  routeType?: string;
  positionId?: number;
  leverage?: number;
  executionPrice?: string;
  minOut?: string;
  colls?: string;
  debts?: string;
  /** User-entered values retained beside the immutable SDK route for review. */
  requestedAmount?: string;
  requestedLeverage?: number;
  slippagePercent?: number;
  /** Slippage echoed by the SDK result, when the method returns it. */
  sdkSlippagePercent?: number;
  /** Economic floors decoded from the action calldata and rebound in policy. */
  economicLimits?: readonly { label: string; value: string }[];
  /** Hashes bind converter encodings/routes between review and signing. */
  conversionPaths?: readonly { label: string; fingerprint: Hex }[];
}

/** A user-reviewable, ordered transaction route. */
export interface PlannedRoute {
  operation: OfficialFxMethod;
  chainId: FxChainId;
  walletAddress: Address;
  transactions: PlannedTransaction[];
  details?: RouteDetails;
  /** Read-only values returned by the SDK (for display only). */
  quote?: unknown;
  /** Optional exact policy for a reviewed advanced bridge contract. */
  policy?: TransactionPolicy;
}

/**
 * The immutable bridge facts that are reviewed before a wallet prompt.  The
 * SDK returns calldata, but a browser route must also retain the exact values
 * that were independently derived from the user's inputs so validation can
 * decode and bind the calldata again immediately before signing.
 */
export interface BridgeRouteQuote {
  nativeFee: bigint;
  lzTokenFee: bigint;
  sourceOftAddress: Address;
  destinationChainId: FxChainId;
  destinationEid: number;
  recipient: Address;
  recipientBytes32: Hex;
  amountLD: bigint;
  minAmountLD: bigint;
  /** Canonical LayerZero send bytes derived independently from the requested
   * official token key (or empty for a validated advanced OFT). */
  extraOptions: Hex;
  composeMsg: Hex;
  oftCmd: Hex;
  refundAddress: Address;
  /** The reviewed Ethereum-side ERC-20, when the source chain can require approval. */
  approvalTokenAddress?: Address;
  /** Optional display/reconciliation fields attached by the UI. */
  bridgeToken?: string;
  bridgeAmount?: bigint;
  deliveryLowerBound?: bigint;
  destinationTokenAddress?: Address;
  /** Latest destination block captured before the source wallet prompt. */
  destinationBaselineBlock?: bigint;
  /** Advanced OFT metadata snapshots; never inferred from editable fields at review time. */
  destinationOftAddress?: Address;
  sourceTokenAddress?: Address;
  sourceApprovalRequired?: boolean;
  destinationApprovalRequired?: boolean;
}

export type PlanStatus =
  | "planning"
  | "reviewing"
  | "awaiting-user"
  | "submitted"
  | "confirmed"
  | "failed"
  | "partial";

export interface TransactionStepResult {
  index: number;
  transaction: PlannedTransaction;
  hash?: Hex;
  status: "submitted" | "confirmed" | "failed";
  error?: string;
  receipt?: TransactionReceipt;
}

export interface TransactionExecutionResult {
  status: "confirmed" | "failed" | "partial";
  operation: OfficialFxMethod;
  chainId: FxChainId;
  walletAddress: Address;
  steps: TransactionStepResult[];
  error?: string;
}

/**
 * Keep the browser client boundary structural. The SDK currently carries a
 * slightly older nested viem type, so assigning a chain-specialized client to
 * viem's broad PublicClient alias can produce duplicate-package type errors.
 * These are exactly the read methods the runner needs.
 */
export type FxPublicClient = Pick<
  PublicClient,
  "simulateCalls" | "getTransactionCount" | "getTransactionReceipt" | "getTransaction" | "getBlockNumber" | "getChainId" | "getBalance" | "readContract"
  | "getBytecode" | "getLogs"
> & { chain?: { id?: number } };

/**
 * The façade deliberately exposes only the 15 official methods. Keeping this
 * type separate from FxSdk prevents pages from growing a second protocol API.
 */
export type FxSdkFacade = Pick<
  FxSdk,
  (typeof OFFICIAL_FX_METHODS)[number]
>;

/**
 * User-controlled facts captured before the SDK is called. Transaction
 * validation decodes the SDK calldata and binds these values again immediately
 * before signing. Protocol-derived quote/math fields intentionally remain the
 * SDK's responsibility.
 */
type ReviewedActionIntentBase =
  | {
      kind: "position-increase";
      poolAddress: Address;
      positionId: number;
      inputTokenAddress: Address;
      inputAmount: bigint;
      nativeInput: boolean;
      collateralTokenAddress: Address;
      debtTokenAddress: Address;
      positionType: "long" | "short";
      /** Exact leverage target supplied to the official SDK. */
      requestedLeverage?: number;
      /** Exact user slippage input supplied to the official SDK. */
      slippagePercent?: number;
    }
  | {
      kind: "position-reduce";
      poolAddress: Address;
      positionId: number;
      outputTokenAddress: Address;
      collateralTokenAddress: Address;
      debtTokenAddress: Address;
      positionType: "long" | "short";
      isClosePosition: boolean;
      /** Exact SDK reduction amount derived from the reviewed position state. */
      requestedAmount?: bigint;
      /** Exact user slippage input supplied to the official SDK. */
      slippagePercent?: number;
    }
  | {
      kind: "position-adjust";
      poolAddress: Address;
      positionId: number;
      collateralTokenAddress: Address;
      debtTokenAddress: Address;
      positionType: "long" | "short";
      /** Exact leverage target supplied to the official SDK. */
      requestedLeverage?: number;
      /** Exact user slippage input supplied to the official SDK. */
      slippagePercent?: number;
    }
  | {
      kind: "deposit-and-mint";
      poolAddress: Address;
      positionId: number;
      depositTokenAddress: Address;
      depositAmount: bigint;
      nativeInput: boolean;
      mintAmount: bigint;
    }
  | {
      kind: "repay-and-withdraw";
      poolAddress: Address;
      positionId: number;
      minimumRepayAmount: bigint;
      repayTokenAddress: Address;
      withdrawTokenAddress: Address;
      withdrawAmount: bigint;
      collateralTokenAddress: Address;
    }
  | {
      kind: "fxsave-deposit";
      tokenInAddress: Address;
      amount: bigint;
      receiver: Address;
      directBasePool: boolean;
      /** Present for routed deposits; direct base-pool deposits have no slippage input. */
      slippagePercent?: number;
    }
  | {
      kind: "fxsave-withdraw";
      tokenOutAddress: Address;
      amount: bigint;
      receiver: Address;
      instant: boolean;
      directBasePool: boolean;
      /** Present for instant withdrawals; queued/direct paths have no slippage input. */
      slippagePercent?: number;
    }
  | {
      kind: "fxsave-claim";
      receiver: Address;
    };

export type ReviewedActionIntent = ReviewedActionIntentBase & {
  /** Captured from the first decoded SDK plan and checked again before signing. */
  expectedEconomicLimits?: readonly bigint[];
  /** Captured hashes of converter direction/token/amount/minOut/encoding/routes. */
  expectedConversionFingerprints?: readonly Hex[];
  /** Cryptographic commitment to the complete reviewed protocol calldata.
   * This binds transformed amounts/leverage and every conversion floor/path,
   * including fields which cannot be independently reconstructed from a form
   * value immediately before signing. */
  expectedActionDataFingerprint?: Hex;
};

export interface TransactionPolicy {
  /** Every transaction must use this wallet as its sender. */
  walletAddress: Address;
  /** Every transaction in a route must be on this chain. */
  chainId: FxChainId;
  /** Optional exact destination allow-list for the selected capability. */
  allowedDestinations?: readonly Address[];
  /** Optional selector allow-list keyed by destination address. */
  allowedSelectors?: Readonly<Record<string, readonly string[]>>;
  /** Exact protocol action destinations for the selected SDK operation. */
  allowedActionDestinations?: readonly Address[];
  /** Exact protocol action selectors keyed by action destination. */
  allowedActionSelectors?: Readonly<Record<string, readonly string[]>>;
  /** Exact transaction destinations which may receive ERC-20/NFT approvals. */
  allowedApprovalDestinations?: readonly Address[];
  /** Exact ERC-20 contract destinations for approveToken steps. */
  allowedTokenApprovalDestinations?: readonly Address[];
  /** Exact ERC-721 pool destinations for approvePosition steps. */
  allowedPositionApprovalDestinations?: readonly Address[];
  /** Exact contracts permitted as ERC-20/NFT approval operators. */
  allowedApprovalSpenders?: readonly Address[];
  /** Exact ERC-20 approval amount derived from the reviewed user request. */
  expectedTokenApprovalAmount?: bigint;
  /** Exact ERC-721 position ID derived from the reviewed user request. */
  expectedPositionApprovalId?: number;
  /** A token approval is expected but its exact fee-adjusted amount is bound to decoded action calldata. */
  allowActionBoundTokenApproval?: boolean;
  /** Independently captured user intent used to decode and bind action calldata. */
  reviewedAction?: ReviewedActionIntent;
  /** Optional maximum native value per transaction. */
  maxValueWei?: bigint;
}

export interface WalletTransactionRequest {
  chainId: FxChainId;
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  nonce: number;
}

export interface TransactionRunnerCallbacks {
  /**
   * This callback must be wired to Privy sendTransaction with wallet UIs
   * enabled. It is intentionally named requestSignature to make the approval
   * boundary explicit in callers.
   */
  requestSignature: (request: WalletTransactionRequest) => Promise<Hex>;
  ensureChain?: (chainId: FxChainId) => Promise<void>;
  /** Optional custom simulation; return false or throw to fail closed. */
  simulate?: (
    route: PlannedRoute,
    client: FxPublicClient,
  ) => Promise<true | { success: true } | { success: false; error: string }>;
  /** Called before/after each state transition for UI progress. */
  onStep?: (step: TransactionStepResult) => void;
  onStatus?: (status: PlanStatus, detail?: string) => void;
  /** Reread SDK/chain state after the receipt and one-block boundary. */
  postConfirmRead?: (route: PlannedRoute, result: TransactionExecutionResult) => Promise<void>;
}

export interface TransactionRunnerOptions {
  /** Receipt wait timeout per step; defaults to 180 seconds. */
  receiptTimeoutMs?: number;
  /** Poll interval for receipt and block confirmation. */
  pollMs?: number;
  /** Wait for one additional block after the final transaction. */
  waitForNextBlock?: boolean;
  /** Disable only for deterministic unit tests; production must leave true. */
  simulate?: boolean;
}

export interface PendingHashRecord {
  id: string;
  operation: OfficialFxMethod;
  walletAddress: Address;
  chainId: FxChainId;
  hash: Hex;
  /** Reviewed transaction destination, verified again during recovery. */
  to: Address;
  nonce?: number;
  /** Hash of reviewed calldata; absent legacy entries stay unverified. */
  dataHash?: Hex;
  /** Reviewed native value as a JSON-safe decimal string. */
  valueWei?: string;
  /** Optional bridge facts retained only so delivery can be reverified after reload. */
  bridge?: PendingBridgeContext;
  submittedAt: number;
  /** Monotonic local event time used only to merge append-only journal hints. */
  updatedAt?: number;
  status: "pending" | "confirmed" | "failed";
}

export interface PendingBridgeContext {
  destinationChainId: FxChainId;
  sourceOftAddress: Address;
  destinationOftAddress: Address;
  recipient: Address;
  /** Decimal strings keep localStorage JSON-safe; every value is revalidated. */
  amountLD: string;
  minAmountLD: string;
  destinationBaselineBlock: string;
  bridgeToken?: string;
}

export interface BridgeApprovalParams {
  owner: Address;
  tokenAddress: Address;
  spender: Address;
  amount: bigint;
  chainId?: 1;
  operation?: "buildBridgeTx";
}

export interface BridgePlanParams {
  sourceChainId: FxChainId;
  destChainId: FxChainId;
  /** Canonical fxUSD/fxSAVE key or a validated 18-decimal OFT address. */
  token: string;
  amount: bigint;
  recipient: Address;
  refundAddress?: Address;
  sourceRpcUrl?: string;
  walletAddress: Address;
  includeApproval?: boolean;
  /** Optional known allowance; skips approval only when it already covers amount. */
  approvalAllowance?: bigint;
  /** Required for advanced OFT inputs whose underlying ERC-20 differs from the OFT address. */
  approvalTokenAddress?: Address;
  /** Reviewed destination OFT used for GUID-correlated delivery verification. */
  destinationOftAddress: Address;
  /** Destination latest block captured before the route can be signed. */
  destinationBaselineBlock: bigint;
}

export interface ScopeContractCheck {
  ok: boolean;
  missing: OfficialFxMethod[];
}
