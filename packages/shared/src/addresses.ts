/**
 * SINGLE SOURCE OF TRUTH for f(x) Protocol mainnet addresses.
 *
 * Provenance (verified 2026-06-10, see docs/audit/AUDIT.md appendix):
 * - Core protocol entries match AladdinDAO fx-protocol-contracts
 *   ignition/deployments/ethereum/deployed_addresses.json
 *   (ROUTER = Router#Diamond, pool managers, FXUSD, FXUSD_BASE_POOL, PEG_KEEPER).
 * - Pools & tokens confirmed live on mainnet with matching token symbols
 *   (Blockscout).
 * - LIMIT_ORDER_MANAGER verified official (A2 resolved 2026-06-11): listed as
 *   LimitOrderManager#LimitOrderManagerProxy in AladdinDAO/fx-protocol-contracts
 *   ignition/deployments/upgrade-20251014/deployed_addresses.json and in the
 *   official f(x) docs ("LimitOrderManager contracts").
 *
 * Rules:
 * - Never add or change an address without a verification citation in the PR.
 * - Do NOT reintroduce a parallel registry (the old contracts.ts contained
 *   fabricated addresses with no code on mainnet — AUDIT.md P0-4).
 */
export const ADDRESSES = {
  // Core Protocol
  ROUTER: "0x33636D49FbefBE798e15e7F356E8DBef543CC708",
  // FxMintRouter (Diamond) — the deposit-and-mint / repay-and-withdraw entry
  // point used by fx-sdk depositAndMint()/repayAndWithdraw(). Verified
  // 2026-06-12: listed as Upgrade20251030#FxMintRouter in
  // AladdinDAO/fx-protocol-contracts ignition/deployments/upgrade-20251030/
  // deployed_addresses.json; verified Diamond source on Blockscout.
  FX_MINT_ROUTER: "0xB753366082466c4B5984312f0c4Bb97554be067E",
  LONG_POOL_MANAGER: "0x250893CA4Ba5d05626C785e8da758026928FCD24",
  SHORT_POOL_MANAGER: "0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D",
  
  // Pools
  WSTETH_LONG_POOL: "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8",
  WBTC_LONG_POOL: "0xAB709e26Fa6B0A30c119D8c55B887DeD24952473",
  WSTETH_SHORT_POOL: "0x25707b9e6690B52C60aE6744d711cf9C1dFC1876",
  WBTC_SHORT_POOL: "0xA0cC8162c523998856D59065fAa254F87D20A5b0",
  
  // Tokens & Managers
  LIMIT_ORDER_MANAGER: "0x112873b395B98287F3A4db266a58e2D01779Ad96",
  FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
  FXN: "0x365AccFCa291e7D3914637ABf1F7635dB165Bb09",
  FXSAVE: "0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39",
  VEFXN: "0xEC6B8A3F3605B083F7044C0F31f2cac0caf1d469",
  
  // Supporting
  FXUSD_BASE_POOL: "0x65C9A641afCEB9C0E6034e558A319488FA0FA3be",
  PEG_KEEPER: "0x50562fe7e870420F5AAe480B7F94EB4ace2fcd70",
  SPOT_PRICE_ORACLE: "0xc2312CaF0De62eC9b4ADC785C79851Cb989C9abc",
  GAUGE_REWARDER: "0x5Ac1A882E6CeDc58511b7e42b02BAB42E2c02956",
  TREASURY: "0x0084C2e1B1823564e597Ff4848a88D61ac63D703",
  FXETH_CREDIT_NOTE: "0x7c5350BaC0eB97F86A366Ee4F9619a560480F05A",
  FXBTC_CREDIT_NOTE: "0xB25a554033C59e33e48c5dc05A7192Fb1bbDdfc6",
  FXUSD_REGENERACY: "0xf729422D68c2cf00574fb5712972454cf402A9b1",

  // LayerZero V2 OFT adapters (Ethereum side) — used by /bridge to move fxUSD /
  // fxSAVE to Base. Source-of-truth is fx-sdk's BRIDGE_OFT_BY_TOKEN; mirrored
  // here so verify-addresses.mjs confirms they have mainnet bytecode. Verified
  // 2026-06: both have deployed code on Ethereum mainnet.
  FXUSD_OFT_ADAPTER: "0xA07d8cc424421cC2bce0544a65481376f010A438",
  FXSAVE_OFT_ADAPTER: "0xCaD2b9C980322f460db51CC8E45539F677C73F86",

  
  // ERC20 Tokens
  WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
  WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  STETH: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
} as const;

export const POOLS = {
  LONG: [ADDRESSES.WSTETH_LONG_POOL, ADDRESSES.WBTC_LONG_POOL],
  SHORT: [ADDRESSES.WSTETH_SHORT_POOL, ADDRESSES.WBTC_SHORT_POOL],
} as const;

export const MARKETS = ["wstETH", "WBTC"] as const;
export type Market = (typeof MARKETS)[number];
export type PoolAddress = (typeof ADDRESSES)[keyof typeof ADDRESSES];
