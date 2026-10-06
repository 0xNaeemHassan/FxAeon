import {
  FxSdk,
  type BuildBridgeTxRequest,
  type FxSdkConfig,
} from "@aladdindao/fx-sdk";
import {
  ETHEREUM_CHAIN_ID,
  FX_SDK_MAIN_COMMIT,
  configuredRpcUrls,
} from "./config";
import { getRpcTransport } from "./clients";
import {
  OFFICIAL_FX_METHODS,
  type FxSdkFacade,
  type ScopeContractCheck,
} from "./types";

let ethereumSdk: FxSdk | undefined;

/** The app and SDK bundle different viem minor versions; keep this cast at the boundary. */
export function asFxSdkRpcTransport(transport: ReturnType<typeof getRpcTransport>): NonNullable<BuildBridgeTxRequest["sourceRpcTransport"]> {
  return transport as unknown as NonNullable<BuildBridgeTxRequest["sourceRpcTransport"]>;
}

/**
 * Return the single Ethereum SDK instance used by the Mini App.
 *
 * fx-sdk's internal RpcClient is a process-wide singleton whose first RPC
 * configuration wins. A singleton here prevents an accidental bridge/source
 * configuration from replacing the canonical Ethereum SDK client.
 */
export function getFxSdk(): FxSdk {
  if (!ethereumSdk) {
    const rpcUrls = configuredRpcUrls(ETHEREUM_CHAIN_ID);
    const config: FxSdkConfig = {
      chainId: ETHEREUM_CHAIN_ID,
      rpcUrl: rpcUrls[0],
      rpcUrls,
      rpcTransport: asFxSdkRpcTransport(getRpcTransport(rpcUrls, ETHEREUM_CHAIN_ID)),
    };
    ethereumSdk = new FxSdk(config);
  }
  return ethereumSdk;
}

/** Test hook; product code must never swap the SDK instance. */
export function resetFxSdkForTests(): void {
  ethereumSdk = undefined;
}

/**
 * A deliberately narrow façade. Pages should depend on this object rather
 * than importing protocol internals or inventing a second API surface.
 */
export function createFxSdkFacade(sdk: FxSdk = getFxSdk()): FxSdkFacade {
  return {
    getPositions: sdk.getPositions.bind(sdk),
    increasePosition: sdk.increasePosition.bind(sdk),
    reducePosition: sdk.reducePosition.bind(sdk),
    adjustPositionLeverage: sdk.adjustPositionLeverage.bind(sdk),
    depositAndMint: sdk.depositAndMint.bind(sdk),
    repayAndWithdraw: sdk.repayAndWithdraw.bind(sdk),
    getBridgeQuote: sdk.getBridgeQuote.bind(sdk),
    buildBridgeTx: sdk.buildBridgeTx.bind(sdk),
    getFxSaveBalance: sdk.getFxSaveBalance.bind(sdk),
    getFxSaveConfig: sdk.getFxSaveConfig.bind(sdk),
    getFxSaveRedeemStatus: sdk.getFxSaveRedeemStatus.bind(sdk),
    getFxSaveClaimable: sdk.getFxSaveClaimable.bind(sdk),
    getRedeemTx: sdk.getRedeemTx.bind(sdk),
    depositFxSave: sdk.depositFxSave.bind(sdk),
    withdrawFxSave: sdk.withdrawFxSave.bind(sdk),
  };
}

export function checkScopeContract(sdk: unknown = getFxSdk()): ScopeContractCheck {
  const target = sdk as Record<string, unknown>;
  const missing = OFFICIAL_FX_METHODS.filter(
    (method) => typeof target[method] !== "function",
  );
  return { ok: missing.length === 0, missing };
}

export { FX_SDK_MAIN_COMMIT };
