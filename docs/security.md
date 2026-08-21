# Security model

FxAeon's security model combines a user-controlled embedded wallet with a revocable server signing permission and application-level transaction controls. It reduces risk; it does not make the application trustless or audited.

## Custody and authority

The user creates or imports an EVM embedded wallet through Privy's client SDK. The same address is used for Ethereum and Base bridge routes. FxAeon's backend stores the public wallet address, Privy identifiers, and delegation state. It does not receive the private key through its onboarding API.

When the user enables bot trading, they add a configured Privy session signer. The backend's `PRIVY_AUTHORIZATION_KEY` can then request signatures for that wallet. This is meaningful transaction authority: a compromised backend or authorization key is a funds risk even though the backend does not possess the exportable wallet key.

Users can revoke the grant in Mini App settings. Revocation stops future signing after Privy's state converges; it does not reverse a broadcast transaction.

## Identity and confirmation

- Telegram webhook updates are accepted at `/webhook` only with the configured Telegram secret-token header.
- Mini App routes verify Telegram WebApp `initData` by HMAC and enforce a six-hour replay window.
- Trade and generic chat actions use HMAC-signed, approximately ten-minute intents.
- Mini App reviews use a persisted `ActionQuoteTicket`: the server freezes the exact validated wallet/action/chain/calldata/value plan and per-tier worst-case fee budgets for two minutes, and execute accepts only that opaque ticket plus a named fee tier.
- A Mini App ticket is claimed before fee/RPC/broadcast work and its immutable ID is the executor idempotency key. Duplicate confirmations can only observe/deduplicate the same per-user transaction record, not authorize a different plan or second broadcast.
- Chat intent nonces and Mini App ticket IDs feed database idempotency keys, preventing repeat confirmation from broadcasting twice.
- Withdrawals keep the exact recipient in a short-lived, Telegram-user-bound server record.
- Automation is armed explicitly but executes later without a second interactive confirmation.

`INTENT_SECRET` is an independent production secret. Production startup rejects a missing key; the Telegram-token fallback exists only for local development and tests.

## Signer policy

`apps/bot/src/core/signerPolicy.ts` runs inside the central executor before simulation.

In `enforce` mode it:

- permits only the explicit targets emitted by the shipped SDK transaction surface, not every contract in the runtime registry; Base permits only the SDK-pinned fxUSD/fxSAVE OFTs within an exact bridge intent;
- requires canonical ABI calldata and a pinned selector for every supported Router, FxMintRouter, fxSAVE vault, token, position-pool, and OFT call;
- binds position calls to the supported pool/market/side and token combinations, required position ID/amount/minimum-output fields, and the authenticated wallet where a receiver or owner is encoded;
- binds payable value to the encoded ETH input, requires zero value everywhere else, or, for a bridge, requires equality with the encoded LayerZero native fee and caps that fee at 0.1 ETH;
- permits only positive, non-unlimited ERC-20 approvals and exact position-ID approvals, correlates each emitted approval to one later same-route action, and rejects `setApprovalForAll`;
- accepts only protocol-native `FxRoute` v1 position quotes and requires the exact SDK 1.0.5 encoding/packed-word sequence for the normalized input/output pair; `FxRoute 2`, unlisted pairs, and altered words are rejected before nested MultiPathConverter and flash-loan callback validation;
- binds bridges to a canonical fxUSD/fxSAVE token-OFT pair, token-specific LayerZero options, the SDK's four-decimal credited minimum, the exact intent amount and opposite-chain endpoint, same-wallet recipient/refund address, empty compose/command payloads, zero LZ-token fee, and an exact native fee capped at 0.1 ETH;
- permits ERC-20/native withdrawals only as a one-transaction scope whose recipient, token, amount, calldata, and value exactly match a short-lived user-bound withdrawal intent; and
- permits a zero-value, empty-calldata self-send only as a one-transaction authenticated pending-transaction cancellation. A speed-up replays the exact persisted call from the same user, wallet, and nonce and is screened again.

The direct Ethereum signing set is intentionally smaller than `packages/shared/src/addresses.ts`: Router, FxMintRouter, fxSAVE, the supported token/share contracts, four position pools, and two Ethereum OFT adapters. MultiPathConverter is validated only as a nested protocol target and cannot be called directly by the session signer.

`observe` logs violations but allows execution. `off` skips checks. They must not be used with production funds.

### Policy limitations

The policy semantically decodes the complete currently supported signing surface, but it is not a proof of economic intent or smart-contract safety. It verifies internal relationships such as selector, pool, token, amount, receiver, approval, converter, callback, and native value; it does not establish fair pricing, determine that a positive minimum output is adequate, interpret every packed route word inside MultiPathConverter, or protect against a compromised/upgradeable allowed contract. It also trusts the caller to supply authentic withdrawal, bridge, and replacement scopes after the surrounding identity/record checks. Server-side intent validation, ordered simulation, user limits, contract/proxy review, monitoring, and revocation remain necessary.

## Simulation and broadcast

Every `executeRoute` action:

1. creates or recovers an idempotent `TxRecord`;
2. applies the signer policy;
3. simulates ordered calls with `eth_simulateV1` on the server-stamped source chain;
4. checks and consumes one point from the user's UTC-day logical-action allowance;
5. derives source-chain EIP-1559 fees on the server, rejects a live selected-tier cost above the reviewed maximum, and applies independent 1,000-gwei/0.5-ETH initial-transaction safety ceilings;
6. broadcasts one transaction at a time through Privy using `eip155:1` or `eip155:8453`;
7. waits for each receipt before the next dependent transaction;
8. persists hashes and state transitions.

Simulation failure or unavailable simulation stops broadcast. Simulation is a preflight at a particular chain state, not a guarantee of later inclusion, price, or success.

When MEV protection is enabled on Ethereum, FxAeon obtains a nonce, signs through Privy, and submits privately to Flashbots Protect. Failure to determine a nonce fails rather than silently downgrading to public broadcast. Flashbots is not a Base transport; Base rejects private mode and uses the public Privy broadcast path.

## State and recovery

`TxRecord` states distinguish `prepared`, `simulated`, `broadcasting`, `broadcast`, `confirmed`, `reverted`, `partial`, `cancelled`, and `failed`. Every route-step hash is persisted immediately, and the step journal records the receipt-derived status before a dependent step proceeds. A receipt timeout remains `broadcast`; the system does not invent a terminal result. A later pre-broadcast failure after an earlier step is known mined becomes terminal `partial`. A known-mined same-nonce cancellation becomes terminal `cancelled`, not `confirmed`. Pending transaction metadata is stored when nonce lookup succeeds, enabling best-effort speed-up/cancel.

The per-user database uniqueness constraint and in-process flight lock make one idempotency key one broadcast record. A duplicate of a terminal or pending record returns that durable result; terminal records are never resurrected, so a deliberate retry needs a fresh key/ticket. If an approval lands and a later route transaction fails to broadcast, earlier on-chain effects remain. Operators must inspect every saved step/hash and reconcile allowances/state manually.

## Data protection

- The database contains Telegram-to-wallet linkage and behavioral data; protect it as sensitive personal data.
- Application logs redact common token, secret, authorization, password, private-key, and Telegram-init-data fields.
- Sentry/admin alerts scrub common credential patterns but should still be treated as sensitive telemetry.
- `ENCRYPTION_KEY` is required by production configuration and an AES-GCM utility exists, but current source does not call that utility from an active record path. Do not claim that all database rows are application-encrypted.
- Wallet keys are protected by Privy's infrastructure rather than the repository's encryption utility.

## Contract-address integrity

`packages/shared/src/addresses.ts` is the runtime address registry. Changes require provenance and review. Signing authority is a separate explicit subset in `apps/bot/src/core/signerPolicy.ts`; adding an unrelated registry address does not authorize it. `scripts/verify-addresses.mjs` checks deployed mainnet bytecode for callable entries when supplied an RPC. The generated signer-policy JSON must match the explicit signing-target subset and policy rules.

Bytecode presence alone does not prove that an address is the intended contract, immutable, safe, or correctly configured. Verify provenance, proxy implementation/admin state, chain, token identity, and expected selectors.

## External dependencies

Security and availability depend on Telegram, Privy, the configured Ethereum/Base RPCs, f(x) contracts/SDK, LayerZero, market-data sources, Flashbots, the limit-order relay, PostgreSQL, and hosting. See [External services](external-apis.md).

## Secure production baseline

- Use `SIGNER_POLICY_MODE=enforce`.
- Keep `BRIDGE_EXECUTION_ENABLED=false` until both directions pass funded source-chain fork/live tests and the OFT target, allowance, refund, native value, and destination-delivery behavior is reviewed. Enabling it also requires both RPCs, but configuration success alone is not evidence that either bridge direction is production-ready.
- Set independent high-entropy webhook, encryption, intent, admin, Privy, and database credentials.
- Keep admin routes edge-restricted, and authenticate/isolate the unfinished general simulation route. Limit-order primitives are TMA-authenticated and maker-bound but still have no supported signing UI.
- Use a Redis TCP URL and one worker replica unless leader election is added.
- Treat `DAILY_TX_CAP` as defense in depth, not a loss ceiling. The central executor enforces a persisted UTC-day logical-action count plus a Redis/in-memory live counter, but it does not cap value or cover the separate Ethereum replacement path; without Redis, multiple replicas can race. Use deployment isolation and signer revocation for incident containment.
- Apply migrations before promotion and verify deep health after deployment.
- Monitor unexpected targets, policy violations, receipt timeouts, partial routes, delegation changes, and dependency drift.
- Back up PostgreSQL, encrypt backups, test restoration, and limit retention/access.
- Revoke/rotate authorization keys and bot/webhook secrets immediately after suspected compromise.

Report vulnerabilities through [SECURITY.md](../SECURITY.md). See [Threat model](threat-model.md) for residual risks and [Signer policy ADR](adr/signer-policy.md) for the decision record.
