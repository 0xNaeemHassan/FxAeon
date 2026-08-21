# Architecture

FxAeon is a Telegram-native application that turns user intent into f(x) Protocol reads and transactions. Ethereum, Base, and the embedded wallet remain separate trust domains; the backend coordinates them but does not store the wallet private key.

## Components

```text
Telegram client
  ├─ grammY commands/callbacks ───────────────┐
  └─ Telegram Mini App                         │
       ├─ signed WebApp initData ─────────────┤
       └─ Privy client wallet controls         │
                                               ▼
                                Bot/API process (Node.js 22)
                                  ├─ identity and intent validation
                                  ├─ @aladdindao/fx-sdk route builder
                                  ├─ signer policy + simulation
                                  ├─ Privy delegated broadcast
                                  ├─ receipt watcher and workers
                                  ├─ PostgreSQL
                                  └─ Redis rate-limit store (optional)
                                               │
                    ┌──────────────────────────┼──────────────────────┐
                    ▼                          ▼                      ▼
          Ethereum + Base RPCs          External data/relay       Telegram API
                    │
                    ▼
         f(x) contracts + LayerZero OFTs
```

## Telegram layer

The bot uses grammY and supports two process modes:

- `NODE_ENV=production`: Express receives Telegram updates at `POST /webhook`; startup registers that URL with Telegram.
- development/test: Express still serves health/application APIs, while grammY receives Telegram updates through long polling. The direct `/webhook` handler is production-only.

Incoming command and callback values are untrusted. Trade and generic action confirmations use HMAC-signed, approximately ten-minute intents. Longer callback payloads use a ten-minute in-process nonce store. A process restart therefore expires those in-memory callbacks by design.

Telegram API output is throttled globally and per user. HTTP middleware separately applies IP rate limits.

## Mini App layer

`apps/mini-app` is a Next.js 15 static export served by Cloudflare Pages or Nginx. It contains no server-side Next.js runtime.

The app has two privileged integrations:

- Telegram WebApp `initData`, forwarded to the backend and HMAC-verified there.
- Privy's React SDK, used in the browser to authenticate, create/import/export the embedded wallet, and grant/revoke the configured session signer.

The Mini App does not construct trusted transaction calldata. Its quote API sends a closed set of intent fields for position open/increase/reduce/adjust, mint/repay, fxSAVE deposit/withdraw/claim, and bridge. The backend resolves wallet ownership, token metadata, targets, source chain, calldata, and value, checks policy, and simulates the complete route. It then stores that exact plan plus each displayed tier's worst-case fee budget in a wallet- and user-bound `ActionQuoteTicket` and returns only an opaque ticket with a two-minute expiry. Execute accepts the ticket and a named fee tier, not the action fields or raw fees; a fee move above the reviewed budget requires a new quote.

## Backend layer

The production process combines:

- command/callback routing;
- the authenticated Mini App API;
- operational/health endpoints;
- f(x) SDK wrappers;
- signer delegation checks;
- the central transaction executor;
- receipt polling and transaction replacement;
- periodic price-alert, automation, position-health, limit-order-status, deposit, arbitrage, and SLO workers.

Workers are in-process `setInterval` loops, not a durable queue. Multiple bot replicas would therefore duplicate worker loops unless deployment adds leader election or separates workers.

## Data layer

PostgreSQL/Prisma stores account linkage, settings, notification preferences, transaction records, automation/alert rules, position observation snapshots, known limit orders, referrals, operational state, deposit watchers, and other ledgers.

Ethereum is authoritative for wallet balances, open positions, fxSAVE holdings, transaction receipts, and protocol state. The legacy `Position` table is not the portfolio source of truth.

Redis is used by HTTP rate limiting, health probing, and the live `DAILY_TX_CAP` counter. Immediately before broadcast, the central executor checks the user's UTC-day persisted records with a transaction hash and consumes one logical-action point. The database check fails closed; a missing/slow Redis falls back to an in-process counter. That fallback is suitable for one process but cannot serialize concurrent actions across replicas. The cap counts routes rather than transactions or value and does not cover the separate Ethereum replacement path.

The Ethereum replacement path verifies record ownership and wallet identity before reconstructing one persisted pending call at the same nonce. Speed-up preserves that exact call. Only cancellation may introduce a self-send, and the policy accepts it only in this replacement scope, with the authenticated wallet as target, empty calldata, and zero value. Replacements are screened again, but are not re-simulated and do not consume the normal logical-action cap.

## f(x) and chain layer

- `@aladdindao/fx-sdk` 1.0.5 builds position, mint/repay, fxSAVE, and bridge routes.
- viem performs source-chain reads, typed-data/hash validation, chained `eth_simulateV1`, EIP-1559 fee derivation, and receipt polling.
- `packages/shared/src/addresses.ts` is the runtime contract/token registry.
- `apps/bot/policy/signer.policy.json` is a generated review artifact; runtime enforcement uses an explicit set of SDK-emitted target labels whose address values come from the TypeScript registry. Registry membership alone is not signing authority.
- Position quote construction requests only the protocol-native `FxRoute` target and accepts only `FxRoute` v1. The signer policy then requires the exact encoding and packed word sequence for the listed SDK 1.0.5 input/output pair. `FxRoute 2`, unlisted pairs, modified words, and remote Odos/Velora embedded payloads fail before signing.
- The signer policy is chain-scoped and semantic. Ethereum pins each supported Router, FxMintRouter, fxSAVE, token, pool, and OFT selector plus its security-sensitive fields. Base allows only an exact intent-scoped send through the SDK-pinned fxUSD or fxSAVE OFT.
- Flashbots Protect is optional per user for Ethereum private broadcast. Base explicitly rejects Flashbots and uses public Privy broadcast.

MultiPathConverter is not a top-level signing target. For position, mint/repay, and fxSAVE router calls, the policy decodes the outer ABI structs, conversion payloads, and flash-loan callbacks; it requires the configured converter, matching tokens/amounts, empty external-signature fields, and canonical bounded route arrays. Native value must be the encoded ETH input or exact bounded bridge fee and is zero for other protocol calls. Any ERC-20 or position approval emitted by a normal route must precede and match one later action's exact token/pool, spender/operator, and amount/position ID; blanket position approvals are rejected.

## Opening a position

```text
User requests a Mini App quote
  → verify identity + constrained intent
  → resolve user and active Privy delegation
  → obtain a fresh SDK route
  → signer-policy check
  → simulate the complete route
  → freeze exact plan in a wallet-bound, two-minute ticket
User confirms the ticket + named fee tier
  → claim ticket; create/dedupe its TxRecord
  → reapply policy and simulate the frozen plan
  → enforce the UTC-day logical-action cap
  → derive server-side EIP-1559 fees
  → broadcast tx 1 and wait for receipt
  → broadcast tx 2 ... and wait
  → persist every step hash/status and the durable route state
  → refresh position snapshot and present result
```

The first confirmation claims the ticket before fee/RPC/broadcast work. The immutable ticket ID is also the per-user executor idempotency key, so a duplicate request can only observe or deduplicate the same record and cannot create a different route. Sequential receipt waiting matters because a later router call can depend on an earlier approval. Each hash is persisted immediately and each step moves from `prepared` to `broadcast` and a receipt-derived outcome. If a later transaction cannot be broadcast after an earlier step is known mined, the route becomes terminal `partial`; a mined same-nonce cancellation becomes terminal `cancelled`. A receipt timeout remains `broadcast`, because submission is not proof of failure or success.

## Reading a portfolio

The backend reads four market/side position combinations from the SDK, every supported Ethereum wallet-token balance from chain, fxSAVE independently, and spot prices through the market-data cache. It returns explicit completeness flags. Wallet valuation iterates the supported balance registry; fxSAVE shares are excluded from the cash leg and valued once through the SDK's redeemable assets. A positive supported balance without a live price, a failed balance read, an incomplete position/savings read, or any missing required price—including fxUSD—makes the total unavailable instead of producing a partial or assumed-pegged number. Unregistered arbitrary ERC-20 holdings are outside this product total.

Position PnL is derived from a first-observed snapshot and current spot price. A position opened outside FxAeon gets a first-observed basis, not a reconstructed historical entry price.

## Automation

Stop-loss/take-profit rules are stored off-chain and checked about every minute against a fresh shared CoinGecko snapshot. A crossed rule is atomically claimed in the database, re-reads matching positions, and invokes the same close route/executor as a manual action. Stale prices never trigger a rule. Failures retry up to a bounded count before pausing.

This architecture does not provide on-chain keeper guarantees, exact trigger-price execution, or availability while the service is down.

## Limit orders

The local limit-order module can construct and chain-verify EIP-712 order data, verify a maker signature, submit it to the official f(x) relay, read execution state, and construct cancellation calldata. Its HTTP router requires fresh TMA authentication and binds order makers to the authenticated database wallet. No Telegram or Mini App signing UI currently completes this flow, so `/limit` is preview-only.

## Cross-chain bridge

The SDK accepts source/destination chain IDs 1 and 8453. The backend maps the user's direction to a server-stamped source chain and corresponding RPC/client; the browser cannot supply arbitrary chain IDs, RPCs, OFT addresses, recipients, or refund addresses. Privy signing uses CAIP-2 chain identifiers `eip155:1` and `eip155:8453`.

Ethereum-source routes may be one exact-amount token approval followed by exactly one OFT send. Base-source routes are exactly one call to the selected SDK-pinned OFT. The signer policy binds the canonical fxUSD/fxSAVE token-OFT pair, source chain, exact amount, SDK four-decimal credited minimum, token-specific LayerZero options, opposite-chain endpoint, same-wallet recipient/refund address, empty compose/command payloads, zero LZ-token fee, and transaction value equal to the encoded native fee; the native fee is capped at 0.1 ETH. The common executor persists the source-chain transaction lifecycle, but destination-chain delivery is an external LayerZero outcome and is not inferred from the source receipt.

## Deployment topology

The canonical production files describe:

- Render Docker web service for the bot/API;
- Cloudflare Pages static hosting for the Mini App;
- managed PostgreSQL and optional Redis;
- optional GitHub Actions database migration, Mini App deploy, backup, fork test, smoke test, and quality workflows.

Docker Compose is a local/self-hosted topology with bot, Mini App Nginx, Redis, and a root Nginx proxy. It does not provision the database or production TLS.

See [Deployment](DEPLOYMENT.md), [Operations](operations.md), and [Security](security.md).
