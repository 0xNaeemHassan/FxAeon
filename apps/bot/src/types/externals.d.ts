/**
 * Ambient type declarations for packages without types or not yet installed.
 * Lets tsc compile without the actual package present.
 */

declare module "@aladdindao/fx-sdk" {
  export interface FxSdkConfig {
    chainId: number;
    rpcUrl: string;
    signer?: unknown;
  }

  export class FxSdk {
    constructor(config: FxSdkConfig);
    getPositions(params: { owner: string }): Promise<unknown[]>;
    getFxSaveNav(): Promise<number>;
  }
}

declare module "@privy-io/chains" {
  export function addRpcUrlOverrideToChain<T>(chain: T, rpcUrl: string): T;
}
