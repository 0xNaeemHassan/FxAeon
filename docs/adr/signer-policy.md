# ADR: Default-deny session-signer policy

Date: 2026-06-15  
Status: Accepted  
Implementation: `apps/bot/src/core/signerPolicy.ts`, `apps/bot/src/core/txExecutor.ts`

## Context

A user may grant FxAeon's Privy authorization key session-signer authority over an embedded wallet. A buggy or compromised backend can then ask Privy to sign a transaction. SDK output, callback input, contract addresses, nested conversion payloads, and route construction must therefore be constrained before broadcast.

Relying only on a hosted provider policy would create an off-repository control that can drift from reviewed code. A broad allowlist derived from every address in the application registry would also grant signing authority to contracts that the shipped SDK never calls.

## Decision

Enforce a default-deny, chain-scoped policy inside `executeRoute`, the sanctioned server broadcast path.

### Exact signing targets

Ethereum signing authority is derived from an explicit list of SDK-emitted target labels whose address values come from `packages/shared/src/addresses.ts`. Registry membership by itself does not grant signing authority. The direct-call set is:

- the f(x) Router, FxMintRouter, and fxSAVE vault;
- fxUSD, fxSAVE, the fxUSD Base Pool token, wstETH, WBTC, stETH, USDC, USDT, and WETH;
- the wstETH/WBTC long and short position pools; and
- the Ethereum fxUSD and fxSAVE OFT adapters.

The native-ETH sentinel, MultiPathConverter, limit-order manager, treasury, fee collector, and every other registry entry are not top-level signing targets. MultiPathConverter is accepted only as a decoded nested target inside the pinned protocol-native router payloads described below.

Base allows only the SDK-pinned fxUSD and fxSAVE OFTs, and only inside an exact bridge intent. Trust never carries from one chain to another.

### Exact selectors and semantics

Every live direct call must use canonical ABI calldata and one of these pinned selectors:

| Target | Permitted selector(s) | Required bindings |
|---|---|---|
| Supported ERC-20/share token | `approve(address,uint256)` (`0x095ea7b3`) | Zero native value; positive, non-unlimited amount; exact SDK spender; any approval emitted in a normal route must match one later action's token, spender, and amount. ERC-20 `transfer` is allowed only by the exact withdrawal exception below. |
| Position pool | `approve(address,uint256)` (`0x095ea7b3`) | Router or FxMintRouter operator; positive position ID; any approval emitted in a normal route must match one later action's pool, operator, and position ID. `setApprovalForAll` is rejected. |
| f(x) Router | `openOrAddPositionFlashLoanV2` (`0xef9e1aa7`), `closeOrRemovePositionFlashLoanV2` (`0xe8e9fc2a`), `openOrAddShortPositionFlashLoan` (`0x99414c10`), `closeOrRemoveShortPositionFlashLoan` (`0xad0acfdc`), `depositToFxSave` (`0x3ea34dc0`), `instantRedeemFromFxSave` (`0x6d701088`) | Market/pool/side and token compatibility, position ID, amount, minimum output, authenticated-wallet receiver, MultiPathConverter, nested route payload, and native value as applicable. |
| FxMintRouter | `borrowFromLong` (`0x216d5108`), `repayToLong` (`0x0d8aea82`), `repayToLongAndZapOut` (`0xbf4e5936`) | Long-pool/token compatibility, existing/new position rules, mint/repay/withdraw amounts, converter and output token, minimum output, approval requirements, and native value. |
| fxSAVE vault | ERC-4626 `deposit` (`0x6e553f65`), ERC-4626 `redeem` (`0xba087652`), `requestRedeem` (`0xaa2f892d`), `claim` (`0x1e83409a`) | Positive amount where required, authenticated wallet as receiver/owner where encoded, exact Base Pool approval for direct deposit, and zero native value. `fxUSDBasePool` withdrawal is the direct ERC-4626 `redeem` path; it is not `requestRedeem` and creates no cooldown claim. |
| Chain-specific OFT/OFT adapter | LayerZero `send` (`0xc7c7f5b3`) | Canonical fxUSD/fxSAVE token-OFT pair and token-specific execution options; exact source chain and opposite-chain endpoint; same-wallet recipient/refund address; exact intent amount; SDK four-decimal credited minimum; empty compose/command payloads; zero LZ-token fee; encoded native-fee equality; and a 0.1 ETH native-fee ceiling. |

Unknown selectors, malformed/non-canonical calldata, arbitrary token transfers, blanket position approvals, unmatched approvals, and arbitrary payable value fail before simulation and signing.

An approval is correlated one-for-one with a matching later need in the same SDK route. A pre-existing sufficient allowance may make an approval unnecessary; the policy does not require a redundant approval transaction.

### Protocol-native conversion routes

Position quote construction asks fx-sdk only for `FxRoute`, and the returned route type must be exactly `FxRoute` v1. `FxRoute 2` and every other type are rejected. Remote Odos or Velora payloads are not accepted for delegated execution.

The policy does not merely accept a converter target. It pins the exact product-relevant route table shipped by `@aladdindao/fx-sdk@1.0.5`. Native ETH is normalized to WETH for lookup. A same-token conversion is accepted only with encoding `0` and an empty route array. Every other conversion must be one of the 22 directed rows below and match both the encoding and every packed word in order; extra, missing, or changed words fail closed.

Packed-word legend (the identifiers are documentation shorthand only):

| ID | Exact integer value |
|---|---|
| A | `0x1fce71607d656d4f172c66f42cfe369b24d78b2810a` |
| B | `0x1fce71607d656d4f172c66f42cfe369b24d78b2820a` |
| C | `0x277090c5ae6b80a3c525f09d7ae464a8fa83d9c08804` |
| D | `0x2b9eae5948378e863978446d7aaac254c4b5ffa110a` |
| E | `0x07d2239a830b7749bfbad93c0e68b104a5bf2cfd590001` |
| F | `0x040007d2239a830b7749bfbad93c0e68b104a5bf2cfd590001` |
| G | `0x022afaf111e0b1f6c2869832dbfa5f42d20c0cbfc71c04` |
| H | `0x014afaf111e0b1f6c2869832dbfa5f42d20c0cbfc71c04` |
| I | `0x01054062fa20b733978fcbcec244eb8825ae6cfed87c0c` |
| J | `0x254062fa20b733978fcbcec244eb8825ae6cfed87c0c` |
| K | `0x2ee266b2329c21fe928a87ed8d5c9a659688052af0d401` |
| L | `0x04002ee266b2329c21fe928a87ed8d5c9a659688052af0d401` |

| Exact directed pair | Encoding | Exact ordered packed words |
|---|---:|---|
| stETH → wstETH | `0x1fffff` (2,097,151) | A |
| wstETH → stETH | `0x1fffff` (2,097,151) | B |
| wstETH → WETH | `0x2fffff` (3,145,727) | B, C |
| wstETH → USDC | `0x3fffff` (4,194,303) | B, C, E |
| wstETH → USDT | `0x4fffff` (5,242,879) | B, C, E, G |
| wstETH → fxUSD | `0x4fffff` (5,242,879) | B, C, E, I |
| WETH → wstETH | `0x2fffff` (3,145,727) | D, A |
| WETH → fxUSD | `0x2fffff` (3,145,727) | E, I |
| USDC → wstETH | `0x3fffff` (4,194,303) | F, D, A |
| USDC → fxUSD | `0x1fffff` (2,097,151) | I |
| USDC → WBTC | `0x1fffff` (2,097,151) | K |
| USDT → wstETH | `0x4fffff` (5,242,879) | H, F, D, A |
| USDT → WBTC | `0x2fffff` (3,145,727) | H, K |
| USDT → fxUSD | `0x2fffff` (3,145,727) | H, I |
| WBTC → USDC | `0x1fffff` (2,097,151) | L |
| WBTC → USDT | `0x2fffff` (3,145,727) | L, G |
| WBTC → fxUSD | `0x2fffff` (3,145,727) | L, I |
| fxUSD → USDC | `0x1fffff` (2,097,151) | J |
| fxUSD → USDT | `0x2fffff` (3,145,727) | J, G |
| fxUSD → wstETH | `0x4fffff` (5,242,879) | J, F, D, A |
| fxUSD → WETH | `0x2fffff` (3,145,727) | J, F |
| fxUSD → WBTC | `0x2fffff` (3,145,727) | J, K |

Token names in this table resolve to the exact Ethereum addresses in `packages/shared/src/addresses.ts`; the runtime map is keyed by those lower-cased addresses, not by browser-supplied symbols. The packed-word constants and equality checks in `apps/bot/src/core/signerPolicy.ts` remain the executable authority if prose and code ever drift.

The signer policy independently decodes nested position, borrow/repay, and fxSAVE router structs. It requires the configured MultiPathConverter, empty external-signature fields, bounded/canonical route arrays, and matching input token and amount. Flash-loan callback bytes are decoded again: the nested target must be MultiPathConverter and its `convert(address,uint256,uint256,uint256[])` call must match the callback token and amount. This prevents an allowed Router address from becoming a wrapper for unreviewed remote aggregator calldata.

### Narrow exceptions

- A withdrawal scope must authorize exactly one transaction. An ERC-20 withdrawal must be the byte-for-byte `transfer(recipient, amount)` bound to one short-lived, user-scoped server intent, with zero native value.
- A native withdrawal must likewise be the scope's only transaction, have empty calldata, and send the exact positive amount to that intent's exact recipient.
- A replacement scope must contain exactly one transaction. A speed-up replays the exact call persisted from a previously screened pending transaction, with the same authenticated record owner, wallet, and nonce. The replacement flag relaxes only same-route approval correlation for that single persisted call.
- A cancellation self-send is accepted only in the authenticated replacement path, only to the same wallet, and only with empty calldata and zero value.

`apps/bot/policy/signer.policy.json` is generated for human review by `scripts/gen-signer-policy.mjs`. Runtime enforcement does not read the JSON artifact.

`SIGNER_POLICY_MODE` defaults to `enforce`. `observe` records violations and still proceeds; `off` skips enforcement. Production funds use `enforce` only.

## Alternatives considered

- **Hosted Privy policy only:** rejected as the sole control because availability/configuration are external and can drift from code.
- **Every registry contract as a signing target:** rejected because the read/configuration registry is intentionally broader than the SDK transaction surface.
- **Target-only check:** rejected because a valid Router can wrap hostile nested calldata, and a valid token can approve an attacker.
- **Selector-only check:** rejected because recipients, pools, tokens, amounts, approvals, nested callback payloads, and native value are security-sensitive.
- **Remote Odos/Velora routes:** rejected for delegated execution because their externally supplied embedded payloads expand the trust boundary beyond protocol-native conversion routes.
- **Per-transaction user wallet popup:** stronger interactive consent, but incompatible with chat automation and the chosen delegated UX; it remains a valid future mode.

## Consequences

- New targets, selectors, or transaction shapes fail closed and require an explicit code, policy-artifact, and test change.
- Registry changes do not silently widen signing authority, but changes to an explicitly selected label remain high-risk.
- Base bridge routes cannot expand into arbitrary Base contracts; a new OFT/adapter needs an explicit reviewed policy change.
- Withdrawals require a narrow, intent-scoped exception rather than globally permitting arbitrary recipients.
- Replacements use a narrow authenticated exception rather than globally permitting self-sends or standalone approvals.
- `observe` and `off` are dangerous and require process-level operational control.

The policy semantically validates the complete currently supported signing surface; it is still not a proof of user economic intent or smart-contract safety. In particular, it does not price a trade, prove a minimum output is economically adequate, interpret every packed route word inside MultiPathConverter, prevent a reviewed proxy from being upgraded, or stop a compromised backend from abusing a forged/compromised identity or intent scope. The deployed f(x) contracts, converter route semantics, SDK, server intent validation, simulation provider, Privy authorization, and operator configuration remain trusted. Ordered simulation, user-visible review, action limits, contract/proxy review, monitoring, and rapid signer revocation remain necessary.

## Verification and rollback

```bash
node scripts/gen-signer-policy.mjs --check
pnpm --filter @fxaeon/bot test
ALCHEMY_RPC_URL='https://...' node scripts/verify-addresses.mjs
FORK_BACKEND_RPC_URL='https://...' pnpm --filter @fxaeon/bot test:fork
```

If a legitimate route is blocked, do not switch production to `observe` as an automatic workaround. Keep execution unavailable, verify the new address, selector, argument layout, nested payload, and native-value behavior independently, update the explicit signing-target set and semantic tests, regenerate the policy artifact, then deploy reviewed code. Rollback means disabling the new route or reverting its policy change, not disabling enforcement.
