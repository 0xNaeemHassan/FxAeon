/**
 * Session-signer broadcast policy (PLAN.md Pillar A §3.4).
 *
 * The allow-list is derived from the verified ADDRESSES registry; these tests
 * pin the fail-closed behaviour and prove the declarative policy artifact stays
 * in lockstep with the code-enforced set.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodeAbiParameters, encodeFunctionData, erc20Abi, parseAbi, type Address } from "viem";
import { ADDRESSES } from "@fxaeon/shared";
import { BRIDGE_OFT_BY_TOKEN, EID_BASE, EID_ETHEREUM } from "@aladdindao/fx-sdk";
import {
  ALLOWED_TARGETS,
  ALLOWED_TARGETS_BY_CHAIN,
  BASE_ALLOWED_TARGETS,
  ETHEREUM_SIGNING_TARGET_LABELS,
  checkRoute,
  assertRouteAllowed,
  resolvePolicyMode,
  SignerPolicyError,
  type PolicyTx,
} from "../src/core/signerPolicy.js";

const ROUTER = ADDRESSES.ROUTER as Address;
const FX_MINT_ROUTER = ADDRESSES.FX_MINT_ROUTER as Address;
const USDC = ADDRESSES.USDC as Address;
const WSTETH = ADDRESSES.WSTETH as Address;
const USER = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as Address;
const ATTACKER = "0x000000000000000000000000000000000000dEaD" as Address;
const BRIDGE_AMOUNT = 10n * 10n ** 18n;

const approve = (token: Address, spender: Address, amount = 1n): PolicyTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
  value: 0n,
});
const transfer = (token: Address, to: Address): PolicyTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 1n] }),
  value: 0n,
});
const transferFrom = (token: Address, from: Address, to: Address): PolicyTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [from, to, 1n] }),
  value: 0n,
});
const SDK_POLICY_ABI = parseAbi([
  "function openOrAddPositionFlashLoanV2((address,uint256,address,bytes,uint256,bytes),address,uint256,uint256,bytes) payable",
  "function closeOrRemovePositionFlashLoanV2((address,address,uint256,uint256[],uint256,bytes),address,uint256,uint256,uint256,bytes)",
  "function openOrAddShortPositionFlashLoan((address,uint256,address,bytes,uint256,bytes),address,uint256,uint256,bytes) payable",
  "function closeOrRemoveShortPositionFlashLoan((address,address,uint256,uint256[],uint256,bytes),address,uint256,uint256,uint256,bytes)",
  "function borrowFromLong((address,uint256,address,bytes,uint256,bytes),(address,uint256,uint256)) payable",
  "function repayToLong((address,uint256,address,bytes,uint256,bytes),(address,uint256,uint256))",
  "function repayToLongAndZapOut((address,uint256,address,bytes,uint256,bytes),(address,uint256,uint256),(address,address,uint256,uint256[],uint256,bytes))",
  "function depositToFxSave((address,uint256,address,bytes,uint256,bytes),address,uint256,address) payable",
  "function instantRedeemFromFxSave((address,address,uint256,uint256[],uint256,bytes),(address,address,uint256,uint256[],uint256,bytes),uint256,address)",
  "function deposit(uint256,address)",
  "function redeem(uint256,address,address)",
  "function requestRedeem(uint256)",
  "function claim(address)",
]);
const CONVERTER = ADDRESSES.MULTIPATH_CONVERTER as Address;
const CONVERTER_ABI = parseAbi([
  "function convert(address token,uint256 amount,uint256 encoding,uint256[] routes)",
]);

const A = 0x1fce71607d656d4f172c66f42cfe369b24d78b2810an;
const B = 0x1fce71607d656d4f172c66f42cfe369b24d78b2820an;
const C = 0x277090c5ae6b80a3c525f09d7ae464a8fa83d9c08804n;
const D = 0x2b9eae5948378e863978446d7aaac254c4b5ffa110an;
const E = 0x07d2239a830b7749bfbad93c0e68b104a5bf2cfd590001n;
const F = 0x040007d2239a830b7749bfbad93c0e68b104a5bf2cfd590001n;
const I = 0x01054062fa20b733978fcbcec244eb8825ae6cfed87c0cn;
const J = 0x254062fa20b733978fcbcec244eb8825ae6cfed87c0cn;

function routeWords(input: Address, output: Address): readonly [bigint, readonly bigint[]] {
  const normalizedInput = input.toLowerCase() === ADDRESSES.ETH.toLowerCase()
    ? ADDRESSES.WETH.toLowerCase()
    : input.toLowerCase();
  const normalizedOutput = output.toLowerCase() === ADDRESSES.ETH.toLowerCase()
    ? ADDRESSES.WETH.toLowerCase()
    : output.toLowerCase();
  if (normalizedInput === normalizedOutput) return [0n, []];
  const key = `${normalizedInput}>${normalizedOutput}`;
  const table = new Map<string, readonly [bigint, readonly bigint[]]>([
    [`${ADDRESSES.USDC.toLowerCase()}>${ADDRESSES.WSTETH.toLowerCase()}`, [4_194_303n, [F, D, A]]],
    [`${ADDRESSES.WETH.toLowerCase()}>${ADDRESSES.WSTETH.toLowerCase()}`, [3_145_727n, [D, A]]],
    [`${ADDRESSES.FXUSD.toLowerCase()}>${ADDRESSES.WSTETH.toLowerCase()}`, [5_242_879n, [J, F, D, A]]],
    [`${ADDRESSES.WSTETH.toLowerCase()}>${ADDRESSES.FXUSD.toLowerCase()}`, [5_242_879n, [B, C, E, I]]],
    [`${ADDRESSES.USDC.toLowerCase()}>${ADDRESSES.FXUSD.toLowerCase()}`, [2_097_151n, [I]]],
    [`${ADDRESSES.WSTETH.toLowerCase()}>${ADDRESSES.USDC.toLowerCase()}`, [4_194_303n, [B, C, E]]],
    [`${ADDRESSES.FXUSD.toLowerCase()}>${ADDRESSES.USDC.toLowerCase()}`, [2_097_151n, [J]]],
  ]);
  const route = table.get(key);
  if (!route) throw new Error(`missing synthetic FxRoute ${key}`);
  return route;
}

function convert(token: Address, amount: bigint, output: Address, tamperRoute = false): `0x${string}` {
  const [encoding, routes] = routeWords(token, output);
  const encodedRoutes = [...routes];
  if (tamperRoute && encodedRoutes.length > 0) encodedRoutes[0] += 1n;
  return encodeFunctionData({
    abi: CONVERTER_ABI,
    functionName: "convert",
    args: [token, amount, encoding, encodedRoutes],
  });
}

function callback(token: Address, output: Address, amount = 1n, target: Address = CONVERTER): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "bytes" }],
    [1n, amount, target, convert(token, amount, output)]
  );
}

const convertOut = (input: Address, token: Address, minOut = 1n) => {
  const [encoding, routes] = routeWords(input, token);
  return [token, CONVERTER, encoding, [...routes], minOut, "0x"] as const;
};

function openLong({
  token = USDC,
  amount = 1n,
  pool = ADDRESSES.WSTETH_LONG_POOL as Address,
  positionId = 0n,
  value = 0n,
  callbackTarget = CONVERTER,
  nestedAmount = amount,
  tamperRoute = false,
  signature = "0x" as `0x${string}`,
}: Partial<{
  token: Address;
  amount: bigint;
  pool: Address;
  positionId: bigint;
  value: bigint;
  callbackTarget: Address;
  nestedAmount: bigint;
  tamperRoute: boolean;
  signature: `0x${string}`;
}> = {}): PolicyTx {
  return {
    to: ROUTER,
    data: encodeFunctionData({
      abi: SDK_POLICY_ABI,
      functionName: "openOrAddPositionFlashLoanV2",
      args: [
        [token, amount, CONVERTER, convert(token, nestedAmount, WSTETH, tamperRoute), amount > 0n ? 1n : 0n, signature],
        pool,
        positionId,
        1n,
        callback(ADDRESSES.FXUSD as Address, WSTETH, 1n, callbackTarget),
      ],
    }),
    value,
  };
}

function openShort(positionId = 0n, amount = 1n): PolicyTx {
  return {
    to: ROUTER,
    data: encodeFunctionData({
      abi: SDK_POLICY_ABI,
      functionName: "openOrAddShortPositionFlashLoan",
      args: [
        [USDC, amount, CONVERTER, convert(USDC, amount, ADDRESSES.FXUSD as Address), amount > 0n ? 1n : 0n, "0x"],
        ADDRESSES.WSTETH_SHORT_POOL as Address,
        positionId,
        1n,
        callback(WSTETH, ADDRESSES.FXUSD as Address),
      ],
    }),
    value: 0n,
  };
}

function closePosition(side: "long" | "short", minOut = 1n): PolicyTx {
  const isShort = side === "short";
  return {
    to: ROUTER,
    data: encodeFunctionData({
      abi: SDK_POLICY_ABI,
      functionName: isShort
        ? "closeOrRemoveShortPositionFlashLoan"
        : "closeOrRemovePositionFlashLoanV2",
      args: [
        convertOut(isShort ? ADDRESSES.FXUSD as Address : WSTETH, USDC, minOut),
        (isShort ? ADDRESSES.WSTETH_SHORT_POOL : ADDRESSES.WSTETH_LONG_POOL) as Address,
        1n,
        1n,
        1n,
        callback(
          (isShort ? ADDRESSES.FXUSD : WSTETH) as Address,
          (isShort ? WSTETH : ADDRESSES.FXUSD) as Address
        ),
      ],
    }),
    value: 0n,
  };
}

function borrow(depositAmount = 1n, positionId = 0n, token: Address = WSTETH): PolicyTx {
  return {
    to: FX_MINT_ROUTER,
    data: encodeFunctionData({
      abi: SDK_POLICY_ABI,
      functionName: "borrowFromLong",
      args: [
        [token, depositAmount, CONVERTER, convert(token, depositAmount, WSTETH), depositAmount > 0n ? 1n : 0n, "0x"],
        [ADDRESSES.WSTETH_LONG_POOL as Address, positionId, 1n],
      ],
    }),
    value: 0n,
  };
}

function repay(repayAmount = 1n, withdrawAmount = 0n, zap = false): PolicyTx {
  const base = [
    [ADDRESSES.FXUSD as Address, repayAmount, CONVERTER, convert(ADDRESSES.FXUSD as Address, repayAmount, ADDRESSES.FXUSD as Address), repayAmount > 0n ? 1n : 0n, "0x"],
    [ADDRESSES.WSTETH_LONG_POOL as Address, 1n, withdrawAmount],
  ] as const;
  return {
    to: FX_MINT_ROUTER,
    data: zap
      ? encodeFunctionData({
        abi: SDK_POLICY_ABI,
        functionName: "repayToLongAndZapOut",
        args: [...base, convertOut(WSTETH, WSTETH)],
      })
      : encodeFunctionData({ abi: SDK_POLICY_ABI, functionName: "repayToLong", args: base }),
    value: 0n,
  };
}

function saveRouterDeposit(): PolicyTx {
  return {
    to: ROUTER,
    data: encodeFunctionData({
      abi: SDK_POLICY_ABI,
      functionName: "depositToFxSave",
      args: [[USDC, 1n, CONVERTER, convert(USDC, 1n, USDC), 1n, "0x"], USDC, 1n, USER],
    }),
    value: 0n,
  };
}

function saveInstantRedeem(): PolicyTx {
  return {
    to: ROUTER,
    data: encodeFunctionData({
      abi: SDK_POLICY_ABI,
      functionName: "instantRedeemFromFxSave",
      args: [convertOut(ADDRESSES.FXUSD as Address, USDC), convertOut(USDC, USDC), 1n, USER],
    }),
    value: 0n,
  };
}

function requestRedeem(amount = 1n): PolicyTx {
  return {
    to: ADDRESSES.FXSAVE,
    data: encodeFunctionData({ abi: SDK_POLICY_ABI, functionName: "requestRedeem", args: [amount] }),
    value: 0n,
  };
}

const unknownCall = (to: Address): PolicyTx => ({ to, data: "0xabcdef01", value: 0n });
const OFT_SEND_ABI = [{
  type: "function",
  name: "send",
  stateMutability: "payable",
  inputs: [
    { name: "sendParam", type: "tuple", components: [
      { name: "dstEid", type: "uint32" }, { name: "to", type: "bytes32" },
      { name: "amountLD", type: "uint256" }, { name: "minAmountLD", type: "uint256" },
      { name: "extraOptions", type: "bytes" }, { name: "composeMsg", type: "bytes" },
      { name: "oftCmd", type: "bytes" },
    ] },
    { name: "fee", type: "tuple", components: [
      { name: "nativeFee", type: "uint256" }, { name: "lzTokenFee", type: "uint256" },
    ] },
    { name: "refundAddress", type: "address" },
  ],
  outputs: [],
}] as const;
function oftSend(
  to: Address,
  sourceChainId: 1 | 8453,
  recipient: Address = USER,
  amount = BRIDGE_AMOUNT,
  nativeFee = 2n,
  extraOptions: `0x${string}` = "0x0003",
  minAmount = amount / 100_000_000_000_000n * 100_000_000_000_000n
): PolicyTx {
  const recipientBytes32 = `0x${recipient.slice(2).padStart(64, "0")}` as `0x${string}`;
  return {
    to,
    data: encodeFunctionData({
      abi: OFT_SEND_ABI,
      functionName: "send",
      args: [{
        dstEid: sourceChainId === 1 ? EID_BASE : EID_ETHEREUM,
        to: recipientBytes32,
        amountLD: amount,
        minAmountLD: minAmount,
        extraOptions,
        composeMsg: "0x",
        oftCmd: "0x",
      }, { nativeFee, lzTokenFee: 0n }, USER],
    }),
    value: nativeFee,
  };
}

function bridgeScope(sourceChainId: 1 | 8453, amount = BRIDGE_AMOUNT) {
  const oftTarget = BRIDGE_OFT_BY_TOKEN.fxUSD[sourceChainId] as Address;
  return {
    sourceChainId,
    tokenAddress: sourceChainId === 1 ? ADDRESSES.FXUSD as Address : oftTarget,
    oftTarget,
    amount,
  };
}

describe("signer policy — allow-list derivation", () => {
  it("grants signing authority only to SDK-emitted targets, not every registry entry", () => {
    for (const label of ETHEREUM_SIGNING_TARGET_LABELS) {
      expect(ALLOWED_TARGETS.has(ADDRESSES[label].toLowerCase())).toBe(true);
    }
    expect(ALLOWED_TARGETS.has(ADDRESSES.ETH.toLowerCase())).toBe(false);
    expect(ALLOWED_TARGETS.has(ADDRESSES.FEE_COLLECTOR.toLowerCase())).toBe(false);
    expect(ALLOWED_TARGETS.has(ADDRESSES.TREASURY.toLowerCase())).toBe(false);
    expect(ALLOWED_TARGETS.has(ADDRESSES.LIMIT_ORDER_MANAGER.toLowerCase())).toBe(false);
    expect(ALLOWED_TARGETS.has(ADDRESSES.MULTIPATH_CONVERTER.toLowerCase())).toBe(false);
    expect(ALLOWED_TARGETS.has(ADDRESSES.WSTETH_PRICE_ORACLE.toLowerCase())).toBe(false);
    expect(ALLOWED_TARGETS.has(ADDRESSES.WBTC_PRICE_ORACLE.toLowerCase())).toBe(false);
    expect(ALLOWED_TARGETS.has(ATTACKER.toLowerCase())).toBe(false);
  });

  it("the declarative signer.policy.json mirrors the enforced set exactly", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const policy = JSON.parse(
      readFileSync(join(here, "../policy/signer.policy.json"), "utf8")
    ) as { allowedTargets: { address: string }[] };
    const fileSet = new Set(policy.allowedTargets.map((t) => t.address.toLowerCase()));
    expect(fileSet).toEqual(ALLOWED_TARGETS);
  });

  it("uses isolated allow-lists per source chain", () => {
    const baseFxUsd = BRIDGE_OFT_BY_TOKEN.fxUSD[8453].toLowerCase();
    const baseFxSave = BRIDGE_OFT_BY_TOKEN.fxSAVE[8453].toLowerCase();
    expect([...BASE_ALLOWED_TARGETS].sort()).toEqual([baseFxUsd, baseFxSave].sort());
    expect(ALLOWED_TARGETS_BY_CHAIN[8453]).toBe(BASE_ALLOWED_TARGETS);
    expect(ALLOWED_TARGETS_BY_CHAIN[1]).toBe(ALLOWED_TARGETS);
    expect(ALLOWED_TARGETS.has(baseFxUsd)).toBe(false);
    expect(BASE_ALLOWED_TARGETS.has(ADDRESSES.ROUTER.toLowerCase())).toBe(false);
  });
});

describe("signer policy — checkRoute (pure)", () => {
  it("passes a realistic approve→router route (spender is the router)", () => {
    const route = [approve(USDC, ROUTER), openLong()];
    expect(checkRoute(route, { walletAddress: USER })).toEqual([]);
  });

  it("permits every shipped SDK action selector with its exact correlated route", () => {
    const longPool = ADDRESSES.WSTETH_LONG_POOL as Address;
    const shortPool = ADDRESSES.WSTETH_SHORT_POOL as Address;
    const fxUsd = ADDRESSES.FXUSD as Address;
    const fxSave = ADDRESSES.FXSAVE as Address;
    const basePool = ADDRESSES.FXUSD_BASE_POOL as Address;
    const direct = (to: Address, functionName: "deposit" | "redeem" | "claim", args: readonly unknown[]): PolicyTx => ({
      to,
      data: encodeFunctionData({
        abi: SDK_POLICY_ABI,
        functionName,
        args: args as never,
      }),
      value: 0n,
    });

    const routes: PolicyTx[][] = [
      [approve(USDC, ROUTER), openLong()],
      [approve(USDC, ROUTER), openShort()],
      [approve(longPool, ROUTER), closePosition("long")],
      [approve(shortPool, ROUTER), closePosition("short")],
      [approve(WSTETH, FX_MINT_ROUTER), borrow()],
      [approve(fxUsd, FX_MINT_ROUTER), approve(longPool, FX_MINT_ROUTER), repay()],
      [approve(fxUsd, FX_MINT_ROUTER), approve(longPool, FX_MINT_ROUTER), repay(1n, 1n, true)],
      [approve(USDC, ROUTER), saveRouterDeposit()],
      [approve(fxSave, ROUTER), saveInstantRedeem()],
      [approve(basePool, fxSave), direct(fxSave, "deposit", [1n, USER])],
      [direct(fxSave, "redeem", [1n, USER, USER])],
      [requestRedeem()],
      [direct(fxSave, "claim", [USER])],
    ];
    for (const route of routes) expect(checkRoute(route, { walletAddress: USER })).toEqual([]);
  });

  it("supports zero-input leverage adjustment and collateral-only withdrawal without opening approval gaps", () => {
    const longPool = ADDRESSES.WSTETH_LONG_POOL as Address;
    expect(checkRoute([
      approve(longPool, ROUTER),
      openLong({ amount: 0n, positionId: 1n }),
    ], { walletAddress: USER })).toEqual([]);
    expect(checkRoute([
      approve(longPool, FX_MINT_ROUTER),
      repay(0n, 1n),
    ], { walletAddress: USER })).toEqual([]);
    expect(checkRoute([openLong({ amount: 0n, positionId: 0n })], { walletAddress: USER })[0].reason)
      .toMatch(/invalid amount/i);
  });

  it("pins nested converter calldata, protocol-native callback targets and empty signatures", () => {
    expect(checkRoute([
      approve(USDC, ROUTER),
      openLong({ callbackTarget: ATTACKER }),
    ], { walletAddress: USER })[0].reason).toMatch(/protocol-native FxRoute/i);
    expect(checkRoute([
      approve(USDC, ROUTER),
      openLong({ nestedAmount: 2n }),
    ], { walletAddress: USER })[0].reason).toMatch(/converter token, amount/i);
    expect(checkRoute([
      approve(USDC, ROUTER),
      openLong({ signature: "0x12" }),
    ], { walletAddress: USER })[0].reason).toMatch(/signature payload/i);
    expect(checkRoute([
      approve(USDC, ROUTER),
      openLong({ tamperRoute: true }),
    ], { walletAddress: USER })[0].reason).toMatch(/shipped FxRoute table/i);
  });

  it("allows pinned SDK selectors and refuses opaque calls to trusted addresses", () => {
    expect(checkRoute([requestRedeem()], { walletAddress: USER })).toEqual([]);
    expect(checkRoute([unknownCall(ROUTER)], { walletAddress: USER })[0].reason).toMatch(/selector/i);
    expect(checkRoute([unknownCall(USDC)], { walletAddress: USER })[0].reason).toMatch(/selector/i);
  });

  it("uses the SDK-exact mint collateral set instead of the broader position token set", () => {
    expect(checkRoute([approve(USDC, FX_MINT_ROUTER), borrow(1n, 0n, USDC)], { walletAddress: USER })
      .some((violation) => /unsupported collateral/i.test(violation.reason))).toBe(true);
  });

  it("allows exactly one terminal SDK action per reviewed route", () => {
    expect(checkRoute([requestRedeem(), requestRedeem()], { walletAddress: USER })
      .some((violation) => /exactly one terminal action/i.test(violation.reason))).toBe(true);
    expect(checkRoute([approve(USDC, ROUTER), openLong(), requestRedeem()], { walletAddress: USER })
      .some((violation) => /exactly one terminal action/i.test(violation.reason))).toBe(true);
  });

  it("rejects a zero-output-floor close route", () => {
    const pool = ADDRESSES.WSTETH_SHORT_POOL as Address;
    expect(checkRoute([approve(pool, ROUTER), closePosition("short", 0n)], { walletAddress: USER })
      .some((violation) => /minimum output/i.test(violation.reason))).toBe(true);
  });

  it("blocks a tx whose target is outside the registry", () => {
    const v = checkRoute([unknownCall(ATTACKER)], { walletAddress: USER });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/not in the f\(x\) registry/);
  });

  it("blocks an approve to a non-allow-listed spender (exfiltration)", () => {
    const v = checkRoute([approve(USDC, ATTACKER)], { walletAddress: USER });
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/approval spender .* is not an SDK execution target/);
  });

  it("rejects approval to self or a broad registry address without an exact route need", () => {
    expect(checkRoute([approve(USDC, USER)], { walletAddress: USER })).toHaveLength(1);
    expect(checkRoute([approve(WSTETH, FX_MINT_ROUTER)], { walletAddress: USER }).length).toBeGreaterThan(0);
  });

  it("binds approval amount exactly to the action calldata", () => {
    expect(checkRoute([approve(USDC, ROUTER), openLong()], { walletAddress: USER })).toEqual([]);
    const oversized = { ...approve(USDC, ROUTER), data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, 2n] }) };
    expect(checkRoute([oversized, openLong()], { walletAddress: USER })[0].reason).toMatch(/exact amount/i);
    expect(checkRoute([openLong(), approve(USDC, ROUTER)], { walletAddress: USER })[0].reason)
      .toMatch(/exact amount/i);
  });

  it("binds native value to the encoded native-token amount", () => {
    const amount = 2n * 10n ** 18n;
    expect(checkRoute([openLong({ token: ADDRESSES.ETH as Address, amount, value: amount })], { walletAddress: USER })).toEqual([]);
    expect(checkRoute([openLong({ token: ADDRESSES.ETH as Address, amount, value: amount + 1n })], { walletAddress: USER })[0].reason)
      .toMatch(/native value/i);
    expect(checkRoute([{ ...requestRedeem(), value: 1n }], { walletAddress: USER })[0].reason)
      .toMatch(/native value/i);
  });

  it("rejects blanket position approvals and mismatched position ids", () => {
    const pool = ADDRESSES.WSTETH_LONG_POOL as Address;
    const blanketData = encodeFunctionData({
      abi: parseAbi(["function setApprovalForAll(address,bool)"]),
      functionName: "setApprovalForAll",
      args: [ROUTER, true],
    });
    expect(checkRoute([{ to: pool, data: blanketData, value: 0n }], { walletAddress: USER })[0].reason)
      .toMatch(/blanket/i);
    expect(checkRoute([approve(pool, ROUTER), openLong({ positionId: 2n })], { walletAddress: USER })[0].reason)
      .toMatch(/exact position/i);
    expect(checkRoute([approve(pool, ROUTER), openLong({ positionId: 1n })], { walletAddress: USER })).toEqual([]);
  });

  it("blocks transfers unless an exact withdrawal intent authorizes them", () => {
    expect(checkRoute([transfer(USDC, ATTACKER)], { walletAddress: USER })).toHaveLength(1);
    expect(checkRoute([transfer(USDC, USER)], { walletAddress: USER })).toHaveLength(1);
    expect(checkRoute([transfer(USDC, ROUTER)], { walletAddress: USER })).toHaveLength(1);
  });

  it("rejects transferFrom entirely because the shipped SDK never emits it", () => {
    expect(checkRoute([transferFrom(USDC, USER, ROUTER)], { walletAddress: USER })).toHaveLength(1);
    expect(checkRoute([transferFrom(USDC, USER, ATTACKER)], { walletAddress: USER })).toHaveLength(1);
  });

  it("allows only the exact intent-scoped ERC-20 withdrawal recipient", () => {
    expect(
      checkRoute([transfer(USDC, ATTACKER)], {
        walletAddress: USER,
        intentScopedWithdrawal: { recipient: ATTACKER, tokenAddress: USDC, amount: 1n },
      })
    ).toEqual([]);
    expect(
      checkRoute([transfer(USDC, ATTACKER)], {
        walletAddress: USER,
        intentScopedWithdrawal: {
          recipient: "0x1111111111111111111111111111111111111111",
          tokenAddress: USDC,
          amount: 1n,
        },
      }).some((violation) => /exactly one transaction/i.test(violation.reason))
    ).toBe(true);
    expect(
      checkRoute([transfer(USDC, ATTACKER), transfer(USDC, ATTACKER)], {
        walletAddress: USER,
        intentScopedWithdrawal: { recipient: ATTACKER, tokenAddress: USDC, amount: 1n },
      })[0].reason
    ).toMatch(/exactly one transaction/i);
  });

  it("allows an exact zero-value self-send for transaction cancellation", () => {
    const replacementScope = { to: ROUTER, data: "0x1234", value: 0n };
    expect(checkRoute([{ to: USER, data: "0x", value: 0n }], {
      walletAddress: USER,
      intentScopedReplacement: replacementScope,
    })).toEqual([]);
    expect(checkRoute([{ to: USER, data: "0x", value: 0n }], { walletAddress: USER })).toHaveLength(1);
    expect(checkRoute([{ to: USER, data: "0x", value: 1n }], {
      walletAddress: USER,
      intentScopedReplacement: replacementScope,
    })).toHaveLength(1);
    expect(checkRoute([
      { to: USER, data: "0x", value: 0n },
      { to: USER, data: "0x", value: 0n },
    ], { walletAddress: USER, intentScopedReplacement: replacementScope })[0].reason).toMatch(/exactly one transaction/i);
  });

  it("allows only the exact persisted calldata for a speed-up", () => {
    const original = transfer(USDC, ATTACKER);
    const scope = { to: original.to, data: original.data, value: original.value ?? 0n };
    expect(checkRoute([original], { walletAddress: USER, intentScopedReplacement: scope })).toEqual([]);
    expect(checkRoute([{ ...original, data: transfer(USDC, USER).data }], {
      walletAddress: USER,
      intentScopedReplacement: scope,
    })[0].reason).toMatch(/byte-match/i);
  });

  it("reports every violation with its tx index", () => {
    const v = checkRoute([requestRedeem(), approve(USDC, ATTACKER), unknownCall(ATTACKER)], {
      walletAddress: USER,
    });
    expect(v.map((x) => x.index)).toEqual([1, 2]);
  });

  it("allows only source-chain Base OFTs for a Base route", () => {
    const baseFxUsd = BRIDGE_OFT_BY_TOKEN.fxUSD[8453] as Address;
    expect(checkRoute([oftSend(baseFxUsd, 8453)], {
      walletAddress: USER,
      chainId: 8453,
      intentScopedBridge: bridgeScope(8453),
    })).toEqual([]);
    expect(checkRoute([unknownCall(ROUTER)], { walletAddress: USER, chainId: 8453 })).toHaveLength(1);
    expect(checkRoute([oftSend(baseFxUsd, 8453)], { walletAddress: USER, chainId: 1 })).toHaveLength(1);
  });

  it("requires exact bridge intent amount, recipient and native fee bounds", () => {
    const baseFxUsd = BRIDGE_OFT_BY_TOKEN.fxUSD[8453] as Address;
    const options = { walletAddress: USER, chainId: 8453 as const, intentScopedBridge: bridgeScope(8453) };
    expect(checkRoute([oftSend(baseFxUsd, 8453, ATTACKER)], options).some((v) => /recipient/i.test(v.reason)))
      .toBe(true);
    expect(checkRoute([oftSend(baseFxUsd, 8453, USER, BRIDGE_AMOUNT + 1n)], options).some((v) => /amount/i.test(v.reason)))
      .toBe(true);
    expect(checkRoute([oftSend(baseFxUsd, 8453), oftSend(baseFxUsd, 8453)], options).some((v) => /exactly one/i.test(v.reason)))
      .toBe(true);
    expect(checkRoute([oftSend(baseFxUsd, 8453, USER, BRIDGE_AMOUNT, 100_000_000_000_000_001n)], options).some((v) => /safety cap/i.test(v.reason)))
      .toBe(true);
    expect(checkRoute([
      oftSend(baseFxUsd, 8453, USER, BRIDGE_AMOUNT, 2n, "0x"),
    ], options).some((v) => /execution options/i.test(v.reason))).toBe(true);
    expect(checkRoute([
      oftSend(baseFxUsd, 8453, USER, BRIDGE_AMOUNT, 2n, "0x0003", BRIDGE_AMOUNT - 1n),
    ], options).some((v) => /minimum amount/i.test(v.reason))).toBe(true);
    expect(checkRoute([oftSend(baseFxUsd, 8453)], {
      ...options,
      intentScopedBridge: { ...bridgeScope(8453), tokenAddress: USDC },
    }).some((v) => /scope is invalid|canonical SDK pair/i.test(v.reason))).toBe(true);
    expect(checkRoute([oftSend(baseFxUsd, 8453)], { walletAddress: USER, chainId: 8453 })[0].reason)
      .toMatch(/exact bridge intent/i);
    expect(checkRoute([oftSend(baseFxUsd, 8453, ATTACKER)], options)[0].reason)
      .toMatch(/recipient/i);
    const wrongValue = { ...oftSend(baseFxUsd, 8453), value: 3n };
    expect(checkRoute([wrongValue], options).some((v) => /fee/i.test(v.reason)))
      .toBe(true);
    expect(checkRoute([unknownCall(baseFxUsd)], options).some((v) => /send/i.test(v.reason)))
      .toBe(true);
  });
});

describe("signer policy — assertRouteAllowed (modes)", () => {
  const bad = [approve(USDC, ATTACKER)];

  it("enforce mode throws SignerPolicyError on a violation", () => {
    expect(() => assertRouteAllowed(bad, { walletAddress: USER, mode: "enforce" })).toThrow(
      SignerPolicyError
    );
  });

  it("enforce mode returns [] for a clean route", () => {
    expect(assertRouteAllowed([requestRedeem()], { walletAddress: USER, mode: "enforce" })).toEqual(
      []
    );
  });

  it("observe mode returns violations without throwing", () => {
    const v = assertRouteAllowed(bad, { walletAddress: USER, mode: "observe" });
    expect(v).toHaveLength(1);
  });

  it("off mode is a no-op even for a malicious route", () => {
    expect(assertRouteAllowed(bad, { walletAddress: USER, mode: "off" })).toEqual([]);
  });

  it("resolvePolicyMode defaults to enforce", () => {
    const prev = process.env.SIGNER_POLICY_MODE;
    delete process.env.SIGNER_POLICY_MODE;
    expect(resolvePolicyMode()).toBe("enforce");
    process.env.SIGNER_POLICY_MODE = "observe";
    expect(resolvePolicyMode()).toBe("observe");
    process.env.SIGNER_POLICY_MODE = "off";
    expect(resolvePolicyMode()).toBe("off");
    if (prev === undefined) delete process.env.SIGNER_POLICY_MODE;
    else process.env.SIGNER_POLICY_MODE = prev;
  });
});
