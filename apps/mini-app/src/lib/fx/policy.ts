import {
  BRIDGE_OFT_BY_TOKEN,
  type BridgeTokenId,
} from "@aladdindao/fx-sdk";
import { toFunctionSelector, type Address } from "viem";
import { FX_TOKENS } from "./tokens";
import type { FxChainId, OfficialFxMethod, PlannedRoute, ReviewedActionIntent, TransactionPolicy } from "./types";

const address = (value: string): Address => value as Address;

const ROUTER = address("0x33636D49FbefBE798e15e7F356E8DBef543CC708");
const FX_MINT_ROUTER = address("0xB753366082466c4B5984312f0c4Bb97554be067E");
const FX_SAVE = FX_TOKENS.fxSAVE.address;
const FXUSD_BASE_POOL = FX_TOKENS.fxUSDBasePool.address;
const LONG_POOLS = [
  address("0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8"),
  address("0xAB709e26Fa6B0A30c119D8c55B887DeD24952473"),
];
const SHORT_POOLS = [
  address("0x25707b9e6690B52C60aE6744d711cf9C1dFC1876"),
  address("0xA0cC8162c523998856D59065fAa254F87D20A5b0"),
];
const TOKEN_TARGETS = [
  FX_TOKENS.fxUSD.address,
  FX_SAVE,
  FX_TOKENS.wstETH.address,
  FX_TOKENS.WBTC.address,
  FX_TOKENS.stETH.address,
  FX_TOKENS.USDC.address,
  FX_TOKENS.USDT.address,
  FX_TOKENS.WETH.address,
  FXUSD_BASE_POOL,
];
const ETHEREUM_OFTS = Object.values(BRIDGE_OFT_BY_TOKEN).map((item) => address(item[1]));
const BASE_OFTS = Object.values(BRIDGE_OFT_BY_TOKEN).map((item) => address(item[8453]));
const APPROVAL_SPENDERS = [ROUTER, FX_MINT_ROUTER, FX_SAVE, ...ETHEREUM_OFTS];

const APPROVE = "0x095ea7b3";
const ROUTER_SELECTORS = [
  "0xef9e1aa7", // open/increase long
  "0xe8e9fc2a", // reduce/close long
  "0x99414c10", // open/increase short
  "0xad0acfdc", // reduce/close short
  "0x3ea34dc0", // fxSAVE deposit through Router
  "0x6d701088", // fxSAVE instant redeem through Router
] as const;
const MINT_ROUTER_SELECTORS = [
  "0x216d5108", // depositAndMint
  "0x0d8aea82", // repayAndWithdraw
  "0xbf4e5936", // repayAndWithdraw with zap-out
] as const;
const FX_SAVE_SELECTORS = [
  "0x6e553f65", // ERC-4626 deposit
  "0xba087652", // ERC-4626 redeem
  "0xaa2f892d", // requestRedeem
  "0x1e83409a", // redeem/claim
] as const;
const OFT_SEND = toFunctionSelector(
  "send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address)",
);

const POSITION_OPERATIONS: readonly OfficialFxMethod[] = [
  "increasePosition",
  "reducePosition",
  "adjustPositionLeverage",
];

const ACTION_MANIFESTS: Readonly<Record<OfficialFxMethod, {
  destinations: readonly Address[];
  selectors: Readonly<Record<string, readonly string[]>>;
  approvalSpenders: readonly Address[];
}>> = Object.freeze({
  getPositions: {
    destinations: [],
    selectors: {},
    approvalSpenders: [],
  },
  increasePosition: {
    destinations: [ROUTER],
    selectors: { [ROUTER.toLowerCase()]: [ROUTER_SELECTORS[0], ROUTER_SELECTORS[2]] },
    approvalSpenders: [ROUTER],
  },
  reducePosition: {
    destinations: [ROUTER],
    selectors: { [ROUTER.toLowerCase()]: [ROUTER_SELECTORS[1], ROUTER_SELECTORS[3]] },
    approvalSpenders: [ROUTER],
  },
  adjustPositionLeverage: {
    destinations: [ROUTER],
    // The pinned SDK uses the same native position router entry points for
    // leverage adjustment as the increase/reduce route family. Keep the
    // complete audited family here; calldata simulation remains authoritative
    // for the encoded position and target values.
    selectors: { [ROUTER.toLowerCase()]: ROUTER_SELECTORS.slice(0, 4) },
    approvalSpenders: [ROUTER],
  },
  depositAndMint: {
    destinations: [FX_MINT_ROUTER],
    selectors: { [FX_MINT_ROUTER.toLowerCase()]: MINT_ROUTER_SELECTORS.slice(0, 1) },
    approvalSpenders: [FX_MINT_ROUTER],
  },
  repayAndWithdraw: {
    destinations: [FX_MINT_ROUTER],
    selectors: { [FX_MINT_ROUTER.toLowerCase()]: MINT_ROUTER_SELECTORS.slice(1) },
    approvalSpenders: [FX_MINT_ROUTER],
  },
  getBridgeQuote: {
    destinations: [],
    selectors: {},
    approvalSpenders: [],
  },
  buildBridgeTx: {
    destinations: [...ETHEREUM_OFTS, ...BASE_OFTS],
    selectors: Object.freeze(Object.fromEntries([
      ...ETHEREUM_OFTS,
      ...BASE_OFTS,
    ].map((oft) => [oft.toLowerCase(), [OFT_SEND]]))),
    approvalSpenders: [...ETHEREUM_OFTS],
  },
  getFxSaveBalance: {
    destinations: [],
    selectors: {},
    approvalSpenders: [],
  },
  getFxSaveConfig: {
    destinations: [],
    selectors: {},
    approvalSpenders: [],
  },
  getFxSaveRedeemStatus: {
    destinations: [],
    selectors: {},
    approvalSpenders: [],
  },
  getFxSaveClaimable: {
    destinations: [],
    selectors: {},
    approvalSpenders: [],
  },
  getRedeemTx: {
    destinations: [FX_SAVE],
    selectors: { [FX_SAVE.toLowerCase()]: ["0x1e83409a"] },
    approvalSpenders: [FX_SAVE],
  },
  depositFxSave: {
    destinations: [ROUTER, FX_SAVE],
    selectors: {
      [ROUTER.toLowerCase()]: ["0x3ea34dc0"],
      [FX_SAVE.toLowerCase()]: ["0x6e553f65"],
    },
    approvalSpenders: [ROUTER, FX_SAVE],
  },
  withdrawFxSave: {
    destinations: [ROUTER, FX_SAVE],
    selectors: {
      [ROUTER.toLowerCase()]: ["0x6d701088"],
      [FX_SAVE.toLowerCase()]: ["0xba087652", "0xaa2f892d"],
    },
    approvalSpenders: [ROUTER, FX_SAVE],
  },
});

const POSITION_APPROVAL_DESTINATIONS = [...TOKEN_TARGETS, ...LONG_POOLS, ...SHORT_POOLS];
const MINT_APPROVAL_DESTINATIONS = [...TOKEN_TARGETS, ...LONG_POOLS];
const SAVE_APPROVAL_DESTINATIONS = [...TOKEN_TARGETS, FX_SAVE];

function approvalDestinationsFor(operation: OfficialFxMethod): readonly Address[] {
  if (POSITION_OPERATIONS.includes(operation)) return POSITION_APPROVAL_DESTINATIONS;
  if (operation === "depositAndMint" || operation === "repayAndWithdraw") return MINT_APPROVAL_DESTINATIONS;
  if (operation === "depositFxSave" || operation === "withdrawFxSave") return SAVE_APPROVAL_DESTINATIONS;
  if (operation === "buildBridgeTx") return TOKEN_TARGETS;
  return [];
}

function mapSelectors(entries: readonly Address[], selectors: readonly string[]): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(Object.fromEntries(entries.map((entry) => [entry.toLowerCase(), selectors])));
}

const APPROVAL_TARGETS = [
  ...TOKEN_TARGETS,
  ...LONG_POOLS,
  ...SHORT_POOLS,
];

/** Exact destinations emitted by the pinned SDK on Ethereum. */
export const ETHEREUM_CAPABILITY_TARGETS: readonly Address[] = Object.freeze([
  ROUTER,
  FX_MINT_ROUTER,
  FX_SAVE,
  ...APPROVAL_TARGETS,
  ...ETHEREUM_OFTS,
]);

/** Exact canonical OFT destinations emitted by the pinned SDK on Base. */
export const BASE_CAPABILITY_TARGETS: readonly Address[] = Object.freeze(BASE_OFTS);

export const ETHEREUM_CAPABILITY_SELECTORS = Object.freeze({
  [ROUTER.toLowerCase()]: ROUTER_SELECTORS,
  [FX_MINT_ROUTER.toLowerCase()]: MINT_ROUTER_SELECTORS,
  ...mapSelectors(APPROVAL_TARGETS, [APPROVE]),
  [FX_SAVE.toLowerCase()]: [APPROVE, ...FX_SAVE_SELECTORS],
  ...mapSelectors(ETHEREUM_OFTS, [OFT_SEND]),
});

export const BASE_CAPABILITY_SELECTORS = Object.freeze(
  mapSelectors(BASE_OFTS, [OFT_SEND]),
);

export function capabilityPolicy(params: {
  walletAddress: Address;
  chainId: FxChainId;
  operation?: OfficialFxMethod;
  maxValueWei?: bigint;
  expectedTokenApprovalAmount?: bigint;
  expectedPositionApprovalId?: number;
  allowActionBoundTokenApproval?: boolean;
  reviewedAction?: ReviewedActionIntent;
  approvalDestinations?: readonly Address[];
  tokenApprovalDestinations?: readonly Address[];
  positionApprovalDestinations?: readonly Address[];
}): TransactionPolicy {
  const operationManifest = params.operation ? ACTION_MANIFESTS[params.operation] : undefined;
  const allActionDestinations = params.chainId === 1
    ? ETHEREUM_CAPABILITY_TARGETS.filter((target) => !APPROVAL_TARGETS.some((item) => item.toLowerCase() === target.toLowerCase()))
    : BASE_CAPABILITY_TARGETS;
  const actionDestinations = operationManifest?.destinations ?? allActionDestinations;
  const actionSelectors = operationManifest?.selectors ?? (params.chainId === 1 ? ETHEREUM_CAPABILITY_SELECTORS : BASE_CAPABILITY_SELECTORS);
  const approvalDestinations = params.approvalDestinations
    ?? (operationManifest ? approvalDestinationsFor(params.operation!) : APPROVAL_TARGETS);
  const approvalSpenders = operationManifest?.approvalSpenders ?? (params.chainId === 1 ? APPROVAL_SPENDERS : []);
  const allowedDestinations = [...new Set([...approvalDestinations, ...actionDestinations])];
  return params.chainId === 1
    ? {
        walletAddress: params.walletAddress,
        chainId: 1,
        allowedDestinations,
        allowedSelectors: {
          ...mapSelectors(approvalDestinations, [APPROVE]),
          ...actionSelectors,
        },
        allowedActionDestinations: actionDestinations,
        allowedActionSelectors: actionSelectors,
        allowedApprovalDestinations: approvalDestinations,
        allowedTokenApprovalDestinations: params.tokenApprovalDestinations,
        allowedPositionApprovalDestinations: params.positionApprovalDestinations,
        allowedApprovalSpenders: approvalSpenders,
        expectedTokenApprovalAmount: params.expectedTokenApprovalAmount,
        expectedPositionApprovalId: params.expectedPositionApprovalId,
        allowActionBoundTokenApproval: params.allowActionBoundTokenApproval,
        reviewedAction: params.reviewedAction,
        maxValueWei: params.maxValueWei ?? (params.operation === "buildBridgeTx" ? undefined : 0n),
      }
    : {
        walletAddress: params.walletAddress,
        chainId: 8453,
        allowedDestinations,
        allowedSelectors: actionSelectors,
        allowedActionDestinations: actionDestinations,
        allowedActionSelectors: actionSelectors,
        allowedApprovalDestinations: approvalDestinations,
        allowedTokenApprovalDestinations: params.tokenApprovalDestinations,
        allowedPositionApprovalDestinations: params.positionApprovalDestinations,
        allowedApprovalSpenders: approvalSpenders,
        expectedTokenApprovalAmount: params.expectedTokenApprovalAmount,
        expectedPositionApprovalId: params.expectedPositionApprovalId,
        allowActionBoundTokenApproval: params.allowActionBoundTokenApproval,
        reviewedAction: params.reviewedAction,
        maxValueWei: params.maxValueWei ?? (params.operation === "buildBridgeTx" ? undefined : 0n),
      };
}

export function defaultTransactionPolicy(route: PlannedRoute): TransactionPolicy {
  if (route.policy) return route.policy;
  const quote = route.quote as { nativeFee?: unknown } | undefined;
  const bridgeFee = route.operation === "buildBridgeTx" && typeof quote?.nativeFee === "bigint"
    ? quote.nativeFee
    : undefined;
  return capabilityPolicy({
    walletAddress: route.walletAddress,
    chainId: route.chainId,
    operation: route.operation,
    maxValueWei: route.operation === "buildBridgeTx" ? bridgeFee : 0n,
  });
}

/**
 * Exact policy for an explicitly reviewed, non-canonical OFT bridge. This is
 * intentionally separate from the canonical manifest so an advanced address
 * can never expand the default product capability set.
 */
export function advancedBridgePolicy(params: {
  walletAddress: Address;
  chainId: FxChainId;
  sourceOftAddress: Address;
  ethereumApprovalTokenAddress?: Address;
  approvalRequired?: boolean;
}): TransactionPolicy {
  const sourceOft = address(params.sourceOftAddress);
  const approvalRequired = params.approvalRequired ?? params.chainId === 1;
  if (params.chainId === 1 && approvalRequired && !params.ethereumApprovalTokenAddress) {
    throw new Error("Ethereum advanced bridge policy requires its reviewed approval token");
  }
  if (params.chainId === 1 && !approvalRequired && params.ethereumApprovalTokenAddress) {
    throw new Error("A non-adapter Ethereum OFT cannot carry an approval token policy");
  }
  if (params.chainId === 8453 && approvalRequired) {
    throw new Error("Base advanced bridge policy cannot approve an OFTAdapter");
  }
  const approvalToken = params.ethereumApprovalTokenAddress ? address(params.ethereumApprovalTokenAddress) : undefined;
  const destinations = approvalToken ? [sourceOft, approvalToken] : [sourceOft];
  const selectors: Record<string, readonly string[]> = {
    [sourceOft.toLowerCase()]: [OFT_SEND],
  };
  if (approvalToken) selectors[approvalToken.toLowerCase()] = [APPROVE];
  return {
    walletAddress: params.walletAddress,
    chainId: params.chainId,
    allowedDestinations: destinations,
    allowedSelectors: selectors,
    allowedActionDestinations: [sourceOft],
    allowedActionSelectors: { [sourceOft.toLowerCase()]: [OFT_SEND] },
    allowedApprovalDestinations: approvalToken ? [approvalToken] : [],
    allowedTokenApprovalDestinations: approvalToken ? [approvalToken] : [],
    allowedPositionApprovalDestinations: [],
    allowedApprovalSpenders: approvalToken ? [sourceOft] : [],
  };
}

export function canonicalBridgeTarget(token: BridgeTokenId, chainId: FxChainId): Address {
  return address(BRIDGE_OFT_BY_TOKEN[token][chainId]);
}

/** Exact NFT pool implied by an official position request. */
export function positionPoolAddress(market: "ETH" | "BTC", type: "long" | "short"): Address {
  const index = market === "ETH" ? 0 : 1;
  return (type === "long" ? LONG_POOLS : SHORT_POOLS)[index];
}

/** Delta-collateral token implied by an official market/side request. */
export function positionCollateralTokenAddress(market: "ETH" | "BTC", type: "long" | "short"): Address {
  if (type === "short") return FX_TOKENS.fxUSD.address;
  return market === "ETH" ? FX_TOKENS.wstETH.address : FX_TOKENS.WBTC.address;
}

/** Debt token implied by an official market/side request. */
export function positionDebtTokenAddress(market: "ETH" | "BTC", type: "long" | "short"): Address {
  if (type === "long") return FX_TOKENS.fxUSD.address;
  return market === "ETH" ? FX_TOKENS.wstETH.address : FX_TOKENS.WBTC.address;
}

export { OFT_SEND, APPROVE };
