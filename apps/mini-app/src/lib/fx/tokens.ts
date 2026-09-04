import { tokens as sdkTokens } from "@aladdindao/fx-sdk";
import { assertAddress } from "./validation";

export type FxSdkMarket = "ETH" | "BTC";
export type FxUiMarket = "wstETH" | "WBTC";
export type FxTokenKey =
  | "ETH"
  | "WETH"
  | "wstETH"
  | "stETH"
  | "WBTC"
  | "USDC"
  | "USDT"
  | "fxUSD"
  | "fxUSDBasePool"
  | "fxSAVE"
  | "FXN";

export interface FxTokenDefinition {
  key: FxTokenKey;
  address: `0x${string}`;
  decimals: number;
  native: boolean;
  markets: readonly FxSdkMarket[];
  /** fxSAVE itself is a bridge asset; Base-pool shares are an fxSAVE input. */
  bridgeable?: boolean;
}

const ETHEREUM = ["ETH"] as const satisfies readonly FxSdkMarket[];
const BOTH = ["ETH", "BTC"] as const satisfies readonly FxSdkMarket[];
const BTC = ["BTC"] as const satisfies readonly FxSdkMarket[];

/**
 * UI token metadata only. Transaction assets remain sourced from the official
 * SDK. FXN is a read-only Portfolio/price asset whose Ethereum identity is
 * fixed to the canonical token contract.
 */
export const FX_TOKENS: Readonly<Record<FxTokenKey, FxTokenDefinition>> = {
  ETH: { key: "ETH", address: assertAddress(sdkTokens.eth, "ETH") as `0x${string}`, decimals: 18, native: true, markets: ETHEREUM },
  WETH: { key: "WETH", address: assertAddress(sdkTokens.weth, "WETH") as `0x${string}`, decimals: 18, native: false, markets: ETHEREUM },
  wstETH: { key: "wstETH", address: assertAddress(sdkTokens.wstETH, "wstETH") as `0x${string}`, decimals: 18, native: false, markets: ETHEREUM },
  stETH: { key: "stETH", address: assertAddress(sdkTokens.stETH, "stETH") as `0x${string}`, decimals: 18, native: false, markets: ETHEREUM },
  WBTC: { key: "WBTC", address: assertAddress(sdkTokens.WBTC, "WBTC") as `0x${string}`, decimals: 8, native: false, markets: BTC },
  USDC: { key: "USDC", address: assertAddress(sdkTokens.usdc, "USDC") as `0x${string}`, decimals: 6, native: false, markets: BOTH },
  USDT: { key: "USDT", address: assertAddress(sdkTokens.usdt, "USDT") as `0x${string}`, decimals: 6, native: false, markets: BOTH },
  fxUSD: { key: "fxUSD", address: assertAddress(sdkTokens.fxUSD, "fxUSD") as `0x${string}`, decimals: 18, native: false, markets: BOTH, bridgeable: true },
  fxUSDBasePool: { key: "fxUSDBasePool", address: assertAddress(sdkTokens.fxUSDBasePool, "fxUSDBasePool") as `0x${string}`, decimals: 18, native: false, markets: BOTH },
  fxSAVE: { key: "fxSAVE", address: assertAddress("0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39", "fxSAVE") as `0x${string}`, decimals: 18, native: false, markets: BOTH, bridgeable: true },
  FXN: { key: "FXN", address: assertAddress("0x365accfca291e7d3914637abf1f7635db165bb09", "FXN") as `0x${string}`, decimals: 18, native: false, markets: BOTH },
};

export function tokenDefinition(key: FxTokenKey): FxTokenDefinition {
  return FX_TOKENS[key];
}

export function toSdkMarket(market: FxUiMarket): FxSdkMarket {
  return market === "wstETH" ? "ETH" : "BTC";
}

export function toUiMarket(market: FxSdkMarket): FxUiMarket {
  return market === "ETH" ? "wstETH" : "WBTC";
}

export function marketSupportsToken(market: FxSdkMarket, token: FxTokenKey): boolean {
  return FX_TOKENS[token].markets.includes(market);
}

export function tokenAddress(key: FxTokenKey): `0x${string}` {
  return FX_TOKENS[key].address;
}
