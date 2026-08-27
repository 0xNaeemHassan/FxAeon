import {
  FxSdk,
  type FxSdkConfig,
} from "@aladdindao/fx-sdk";
import {
  ETHEREUM_CHAIN_ID,
  FX_SDK_MAIN_COMMIT,
  requireRpcUrl,
} from "./config";
import {
  OFFICIAL_FX_METHODS,
  type FxSdkFacade,
  type ScopeContractCheck,
} from "./types";

let ethereumSdk: FxSdk | undefined;

/**
 * Return the single Ethereum SDK instance used by the Mini App.
 *
 * fx-sdk's internal RpcClient is a process-wide singleton whose first RPC
 * configuration wins. A singleton here prevents an accidental bridge/source
 * configuration from replacing the canonical Ethereum SDK client.
 */
export function getFxSdk(): FxSdk {
  if (!ethereumSdk) {
    const config: FxSdkConfig = {
      chainId: ETHEREUM_CHAIN_ID,
      rpcUrl: requireRpcUrl(ETHEREUM_CHAIN_ID),
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
