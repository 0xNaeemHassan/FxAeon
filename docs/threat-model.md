# Threat model

Last source-truth review: August 2026. This is a living engineering threat model, not an external audit.

## Assets

| Asset | Security objective |
|---|---|
| User wallet funds | No unauthorized or misleading transaction |
| Privy session-signer authority | Grant only by user; use only for intended, constrained actions; rapid revocation |
| Contract registry | Correct chain, address, contract identity, and minimal allowlist |
| Telegram/Privy account binding | No cross-user wallet or intent execution |
| Transaction state | No duplicate broadcast; honest partial/unknown outcomes |
| User data | Protect Telegram-wallet linkage, settings, history, and recipients |
| Operator credentials | Prevent bot/API/database/RPC/Privy/admin compromise |
| Availability | Keep portfolio/risk controls and automation observable during volatility |

## Trust boundaries

Everything crossing these boundaries is untrusted until verified:

- Telegram update, callback, deep-link, and `web_app_data` → bot
- Mini App browser and Telegram `initData` → API
- Privy user/wallet/delegation response → backend account state
- f(x) SDK route, direct calldata, and nested converter/callback payloads → route-type filter, semantic signer policy, and simulator
- RPC state/receipt/fee response → execution state
- source/destination chain, OFT, fee, and delivery state → bridge lifecycle
- CoinGecko/Etherscan data → display or automation decision
- limit-order relay response → local order state
- environment/CI/deployment secrets → process authority
- database rows → current on-chain ownership and balances

## Adversaries

- A malicious user replaying or forging callbacks, intents, addresses, units, signatures, or idempotency values.
- A compromised browser, Telegram account, or linked identity.
- A malicious/compromised SDK, dependency, RPC, market feed, relay, or contract upgrade.
- A mempool/MEV adversary front-running, sandwiching, censoring, or racing replacements.
- An infrastructure attacker with environment, CI, database, logging, or Privy authorization access.
- An insider or repository contributor inserting an address, bypass, unsafe feature gate, or misleading UI.
- An availability failure during a volatile market.

## Principal threats and controls

| Threat | Current controls | Residual risk |
|---|---|---|
| Cross-user action | Telegram identity lookup, HMAC intents, user-bound withdrawal records, server-side Privy resolution | Telegram/Privy account compromise; binding bugs |
| Replay/double tap | Approximately ten-minute chat intents; two-minute wallet-bound Mini App frozen-plan tickets; ticket claim; per-user database idempotency key and in-process flight lock | A fresh valid intent/ticket creates a new action; a duplicate can still observe the same pending/terminal record; in-memory chat callback loss on restart |
| Hostile route target | Default-deny, chain-scoped list of exact SDK-emitted signing targets; registry membership alone grants no authority | An explicitly allowed contract can be upgradeable/compromised; address provenance can be wrong |
| Cross-chain confusion | Server-stamped chain IDs/RPCs; canonical token-OFT pair and token-specific options; exact amount/four-decimal minimum; opposite-chain endpoint; fixed same-wallet recipient/refund address; one OFT send | RPC misconfiguration, SDK/OFT upgrade, LayerZero delivery failure |
| Hostile selector or argument | Canonical ABI enforcement; exact live selectors; pool/token/side, position, amount, minimum-output, receiver/owner, and value checks | A syntactically valid supported action can still be economically harmful; allowed contract semantics can change |
| Hostile approval/transfer recipient | Positive non-unlimited ERC-20 approvals and exact position-ID approvals must precede and correlate to a later same-route action; blanket approval is rejected; transfer is one-transaction withdrawal-intent-only | A confirmed approval can outlive a later failed action; existing allowances remain; contract compromise can abuse granted allowance |
| Embedded aggregator/callback payload | Position quotes accept only `FxRoute` v1; policy requires the exact pinned encoding and packed words for one of 22 SDK 1.0.5 directed pairs, pins MultiPathConverter, decodes nested convert/callback payloads, requires empty external signatures, and rejects `FxRoute 2` plus remote Odos/Velora routes | Exact packed words are compared but not economically interpreted; MultiPathConverter and the pinned route semantics remain trusted |
| Excess native value | Policy requires exact encoded ETH input or bridge fee, zero elsewhere, and caps the bridge native fee at 0.1 ETH | A correctly encoded but user-unintended amount can still pass if surrounding identity/intent controls are compromised |
| Reverting transaction | Ordered `eth_simulateV1`, receipt watch | State changes between simulation and inclusion; provider simulation bugs |
| Duplicate/ambiguous outcome | Per-user idempotency; persisted all-step hash/status journal; explicit `broadcast`, `partial`, and `cancelled` states; immutable terminal states | Process/provider outage can leave a durable unknown broadcast requiring manual reconciliation; an approval can remain after a partial route |
| Stale/manipulated price triggers | Shared feed, stale flag, no automation on stale snapshot, oracle settings | CoinGecko is still an off-chain trigger source; threshold is not an execution guarantee |
| MEV | Optional Flashbots private submission; no silent downgrade | Relay censorship/failure/leakage; private delivery is not guaranteed |
| Key theft | Privy key protection; user revocation; server has no export key | Authorization key/session signer still has meaningful signing power |
| Webhook forgery | Telegram secret-token verification on canonical `/webhook` | Secret leakage; stale or misrouted Telegram webhook configuration |
| Mini App impersonation | Telegram initData HMAC and age checks | Compromised bot token can forge initData; six-hour replay window |
| API abuse | IP rate limiting, TMA auth/maker binding on limit orders, input/signature checks, database/Redis-assisted executor action cap | General simulation remains unauthenticated; valid users can consume RPC/relay capacity; cap is count-not-value, excludes replacement, and loses cross-replica atomicity without Redis |
| Data leakage | log redaction, secret scrubbing, access controls | Database linkage is mostly plaintext; application encryption utility is not wired to active rows |
| Worker duplication | Atomic database claim for automation | Other periodic workers can duplicate across replicas; no general leader election |
| Supply-chain compromise | lockfile, frozen installs, pinned/automated checks, signer policy | Build-time package scripts and trusted vendor SDKs remain high-value targets |

## High-risk scenarios

### Compromised backend or Privy authorization key

Assume the attacker can request signatures for delegated wallets. Immediate response is to disable broadcasts at the edge/process, rotate the authorization key, notify users to revoke bot trading, inspect policy/transaction logs, and reconcile every recent hash. The signer policy restricts the attacker to the exact supported semantic call surface, but it cannot prove that a valid supported action reflects the user's wishes, prevent fabricated intent scopes after a full backend compromise, or make an allowed contract safe.

### Malicious SDK update

The lockfile pins the installed tree. A proposed SDK bump must compare exported methods, accepted route types, direct and nested targets, selectors, tuple layouts, callback payloads, contract addresses, token decimals, values, and transaction shapes; regenerate policy artifacts; run semantic rejection/unit and mainnet-fork tests; and keep new shapes denied until reviewed. Remote aggregator payloads remain outside the delegated signing boundary. Simulation does not establish that economic behavior matches the user's intent.

### Market feed compromise

Manual trades use SDK/RPC state, while alerts and `/auto` trigger on CoinGecko snapshots. Disable automation workers, mark market data degraded, preserve rules without firing, and communicate that thresholds were not on-chain guarantees.

### Partial multi-transaction route

If approval confirms and the action fails or times out, do not retry blindly. Inspect receipts, allowance, current position state, nonce, and the idempotency record. Revoke excessive allowance or construct a fresh reviewed action only after state is known.

### Database compromise

Rotate database credentials, block access, preserve forensic copies, audit Telegram-wallet linkage/recipients/automation changes, and compare critical state with Privy/on-chain truth. Wallet private keys are not expected in the database, but linkage and active rules can enable targeted attacks.

## Assumptions

- Users verify that they are interacting with the intended Telegram bot and Mini App origin.
- Privy enforces ownership and session-signer revocation correctly.
- Ethereum/Base mainnet and their configured RPCs expose accurate source-chain state.
- The verified f(x) addresses and SDK correspond to the intended deployed protocol.
- Production runs the signer policy in `enforce` mode.
- The operator controls secrets, deployment, database, and edge routing.

Breaking an assumption is a security event, not an ordinary application error.

## Explicit non-guarantees

FxAeon does not guarantee profitability, price, inclusion, liquidation avoidance, automation timing, market-data correctness, private relay confidentiality, protocol solvency, bridge delivery, or continuous availability. It also does not currently provide hardware-wallet confirmation for each server-broadcast action, an on-chain session-key policy, economic interpretation of packed MultiPathConverter route words, or independent application audit assurance.
