/**
 * Privy Policy Engine — the W-08 default-deny wallet policy.
 *
 * docs/architecture.md promises: "Policy Engine evaluates EVERY action before signing.
 * Default-deny: everything else REJECTED." This module makes that real.
 *
 * Rule set (everything not listed is DENIED by Privy's policy engine, including
 * personal_sign, eth_sign7702Authorization and exportPrivateKey):
 *  1. eth_sendTransaction → f(x) Router (open/close/adjust positions)
 *  2. eth_sendTransaction → fxSAVE vault (deposit/redeem)
 *  3. eth_sendTransaction → LimitOrderManager (cancelOrder / increaseNonce —
 *     signed limit orders can only be cancelled on-chain)
 *  4. eth_sendTransaction → collateral tokens, ONLY for approve() where the
 *     spender is the Router or fxSAVE (calldata-constrained)
 *  5. eth_signTypedData_v4 → ONLY the f(x) Limit Order Manager domain on mainnet
 *
 * Notes:
 * - We deliberately do NOT add Privy's recommended `method: '*'` forward-compat
 *   ALLOW rule: this wallet holds user funds and must stay opt-in.
 * - Conditions within a rule are ANDed; rules are ORed; DENY > ALLOW; no match = DENY.
 *   (docs.privy.io/controls/policies/overview)
 * - Verified against @privy-io/server-auth 1.32.5 type definitions
 *   (walletApi.createPolicy / createWallet / WalletApiPolicyRuleType).
 */

import type { PrivyClient, WalletApiPolicyRuleType } from "@privy-io/server-auth";
import { ADDRESSES } from "@fxbot/shared";
import { getConfig, features } from "../middleware/config.js";

export const POLICY_NAME = "FxAeon default-deny v1";

/** Minimal ERC-20 approve fragment for the calldata condition. */
const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** Tokens the bot ever needs to approve (trade collateral + fxUSD + USDC for fxSAVE). */
const APPROVABLE_TOKENS = [
  ADDRESSES.WSTETH,
  ADDRESSES.WBTC,
  ADDRESSES.FXUSD,
  ADDRESSES.STETH,
  ADDRESSES.USDC,
];

/**
 * The only contracts ever allowed to be approved as spender.
 * FX_MINT_ROUTER is the fx-sdk depositAndMint/repayAndWithdraw entry point
 * (verified official — see packages/shared/src/addresses.ts provenance note).
 */
const ALLOWED_SPENDERS = [ADDRESSES.ROUTER, ADDRESSES.FXSAVE, ADDRESSES.FX_MINT_ROUTER];

export function buildFxAeonPolicyRules(): WalletApiPolicyRuleType[] {
  return [
    {
      name: "Allow f(x) Router transactions",
      action: "ALLOW",
      method: "eth_sendTransaction",
      conditions: [
        { fieldSource: "ethereum_transaction", field: "to", operator: "eq", value: ADDRESSES.ROUTER },
      ],
    },
    {
      name: "Allow FxMintRouter transactions (deposit-and-mint / repay-and-withdraw)",
      action: "ALLOW",
      method: "eth_sendTransaction",
      conditions: [
        {
          fieldSource: "ethereum_transaction",
          field: "to",
          operator: "eq",
          value: ADDRESSES.FX_MINT_ROUTER,
        },
      ],
    },
    {
      name: "Allow fxSAVE vault transactions",
      action: "ALLOW",
      method: "eth_sendTransaction",
      conditions: [
        { fieldSource: "ethereum_transaction", field: "to", operator: "eq", value: ADDRESSES.FXSAVE },
      ],
    },
    {
      name: "Allow LimitOrderManager (on-chain order cancellation)",
      action: "ALLOW",
      method: "eth_sendTransaction",
      conditions: [
        {
          fieldSource: "ethereum_transaction",
          field: "to",
          operator: "eq",
          value: ADDRESSES.LIMIT_ORDER_MANAGER,
        },
      ],
    },
    {
      name: "Allow ERC-20 approve only for f(x) spenders",
      action: "ALLOW",
      method: "eth_sendTransaction",
      conditions: [
        { fieldSource: "ethereum_transaction", field: "to", operator: "in", value: [...APPROVABLE_TOKENS] },
        {
          fieldSource: "ethereum_calldata",
          field: "approve.spender",
          abi: ERC20_APPROVE_ABI,
          operator: "in",
          value: [...ALLOWED_SPENDERS],
        },
      ],
    },
    {
      name: "Allow EIP-712 signing only for the f(x) Limit Order Manager domain",
      action: "ALLOW",
      method: "eth_signTypedData_v4",
      conditions: [
        {
          fieldSource: "ethereum_typed_data_domain",
          field: "verifyingContract",
          operator: "eq",
          value: ADDRESSES.LIMIT_ORDER_MANAGER,
        },
        { fieldSource: "ethereum_typed_data_domain", field: "chainId", operator: "eq", value: "1" },
      ],
    },
  ];
}

let cachedPolicyId: string | null = null;

/**
 * Resolve the wallet policy ID, fail-closed.
 *
 * - If PRIVY_POLICY_ID is configured, verify it exists and is an Ethereum policy.
 * - Otherwise create the policy once and log the ID loudly so the operator can pin
 *   it via PRIVY_POLICY_ID (avoids accumulating duplicates across restarts —
 *   the in-process cache covers a single process lifetime only).
 */
export async function ensureFxAeonPolicy(privy: PrivyClient): Promise<string> {
  if (cachedPolicyId) return cachedPolicyId;

  const configured = getConfig().PRIVY_POLICY_ID;
  if (configured) {
    const policy = await privy.walletApi.getPolicy({ id: configured });
    if (policy.chainType !== "ethereum") {
      throw new Error(`PRIVY_POLICY_ID ${configured} is not an Ethereum policy (got ${policy.chainType})`);
    }
    if (policy.rules.length === 0) {
      throw new Error(`PRIVY_POLICY_ID ${configured} has no rules — refusing to create unguarded wallets`);
    }
    // Keep the pinned policy in sync with the code-defined rule set: when a
    // release adds rules (e.g. FxMintRouter for /mint), existing wallets must
    // gain them too — otherwise new features fail at signing for every wallet
    // created before the release. Rules are compared by name; sync replaces
    // the full rule set with the canonical one (code is the source of truth).
    const expected = buildFxAeonPolicyRules();
    const existingNames = new Set(policy.rules.map((r) => r.name));
    const missing = expected.filter((r) => !existingNames.has(r.name));
    if (missing.length > 0) {
      await privy.walletApi.updatePolicy({ id: policy.id, rules: expected });
      console.warn(
        `[walletPolicy] Updated pinned policy ${policy.id} with ${missing.length} new rule(s): ` +
          missing.map((r) => `"${r.name}"`).join(", ")
      );
    }
    cachedPolicyId = policy.id;
    return policy.id;
  }

  const created = await privy.walletApi.createPolicy({
    name: POLICY_NAME,
    version: "1.0",
    chainType: "ethereum",
    rules: buildFxAeonPolicyRules(),
  });
  console.warn(
    `[walletPolicy] Created Privy policy "${POLICY_NAME}" id=${created.id}. ` +
      `Set PRIVY_POLICY_ID=${created.id} in the environment to pin it and avoid duplicates.`
  );
  cachedPolicyId = created.id;
  return created.id;
}

export interface CreatedWallet {
  id: string;
  address: string;
  policyIds: string[];
}

/**
 * Create a policy-guarded embedded wallet for a user. Fail-closed:
 * - refuses to run without the wallet API enabled (no fake addresses, ever);
 * - refuses to return a wallet that somehow lacks the policy;
 * - idempotency key makes retries safe (same user → same wallet, no duplicates).
 */
export async function createPolicyGuardedWallet(
  privy: PrivyClient,
  privyUserId: string
): Promise<CreatedWallet> {
  if (!features.enablePrivyWalletApi) {
    throw new Error(
      "Privy wallet API is not configured (PRIVY_APP_ID/PRIVY_APP_SECRET/PRIVY_AUTHORIZATION_KEY required) — refusing to create a wallet"
    );
  }
  const policyId = await ensureFxAeonPolicy(privy);
  const wallet = await privy.walletApi.createWallet({
    chainType: "ethereum",
    policyIds: [policyId],
    owner: { userId: privyUserId },
    idempotencyKey: `fxaeon-wallet-${privyUserId}`,
  });
  if (!wallet.policyIds || !wallet.policyIds.includes(policyId)) {
    // Should be impossible; if Privy ever returns an unguarded wallet, stop the line.
    throw new Error(`wallet ${wallet.id} was created without policy ${policyId} attached — aborting`);
  }
  if (!wallet.address || !wallet.address.startsWith("0x") || wallet.address.length !== 42) {
    throw new Error(`wallet ${wallet.id} returned an invalid address`);
  }
  return { id: wallet.id, address: wallet.address, policyIds: wallet.policyIds };
}

/** Test hook — reset the in-process policy cache. */
export function __resetPolicyCacheForTests(): void {
  cachedPolicyId = null;
}
