# FxAeon Threat Model

> Living document. Pairs with [`SECURITY.md`](../SECURITY.md) (how to report),
> [`docs/adr/signer-policy.md`](./adr/signer-policy.md) (the broadcast control),
> and [`docs/GAPS.md`](./GAPS.md) (honest current limits). Last reviewed 2026-06-15.

## 1. What we're protecting

| Asset | Why it matters |
|---|---|
| **User funds** | Self-custodial; the bot can move them via a granted session signer. |
| **Session-signer authority** | A scoped Privy key the bot can sign with. Its blast radius is bounded by the signer policy. |
| **User PII / linkage** | Telegram user ↔ wallet address mapping; encrypted secrets at rest. |
| **Integrity of contract addresses** | A wrong/fabricated address could route funds to an attacker. |
| **Bot availability** | Down bot = users can't manage positions during volatility. |

## 2. Trust boundaries

```
[ Telegram client ]──web_app/callback──>[ Bot + Express API ]──>[ Privy signing ]──>[ Ethereum ]
        │ (untrusted input)                    │                       │
        │                                      ├─> Postgres (Prisma)   │
   [ Mini App (Privy embedded wallet) ]        ├─> Redis (Upstash)     │
        │ user creates/owns the wallet         └─> fx-sdk routes ──────┘ (untrusted data)
```

Everything crossing a boundary is untrusted: Telegram payloads (callback_data,
deep-link params, `web_app_data`), fx-sdk route/calldata output, RPC responses,
and the relay's order-update feed.

## 3. Adversaries

- **Malicious user / griefer** — forges callback_data, deep links, `web_app_data`;
  replays old quotes; double-taps Confirm; tries to act as another user.
- **Compromised/buggy dependency** — fx-sdk emits a route to an attacker contract
  or with a hostile spender; a transitive npm package is backdoored.
- **Network/MEV adversary** — sandwiches or front-runs a pending trade.
- **Infra attacker** — leaked env var, DB/Redis access, a stolen CI token.
- **Repo attacker** — tries to merge a malicious address or workflow change.

## 4. Threats → mitigations (STRIDE-ish)

| # | Threat | Mitigation | Where |
|---|---|---|---|
| T1 | **Broadcast to an attacker contract** (bad route, fabricated address) | Fail-closed default-deny allow-list derived from the verified `ADDRESSES` registry; runs inside the single `executeRoute` path | `core/signerPolicy.ts`, `adr/signer-policy.md` (W-08) |
| T2 | **Hostile ERC-20 approve/transfer** ("approve attacker, drain later") | Spender/recipient must be a registry contract or the user's own wallet | `core/signerPolicy.ts` (W-08) |
| T3 | **Fabricated / typo'd contract address** | Single `ADDRESSES` source; every entry proven to have mainnet bytecode; CI `verify-addresses.mjs` | W-04, `.github/workflows/ci.yml` |
| T4 | **Broadcasting reverting / empty calldata** | `simulateRoute` (`eth_simulateV1`) runs first and **fails closed**; empty-calldata path was kill-switched | W-02, W-07 |
| T5 | **Tampered quote / replayed deep link** | HMAC-signed, short-TTL trade intents; signature covers every field; nonce doubles as executor idempotency key | `core/tradeIntent.ts` (W-17) |
| T6 | **Double-spend on double-tap** | DB-unique idempotency keys + explicit executor state machine (`pending→simulated→submitted→confirmed/failed`) | W-11 |
| T7 | **Spoofed Telegram webhook** | `X-Telegram-Bot-Api-Secret-Token` checked timing-safe; fail-closed rate limiter | W-03 |
| T8 | **Acting as another user** | Identity always resolved server-side from authenticated `ctx.from.id`; intent tokens carry no identity | `handlers/walletConnect.ts`, `core/onboarding.ts` |
| T9 | **MEV (sandwich/front-run)** | Slippage floor on quotes; optional private-mempool routing (Flashbots Protect) for protected trades | quote path / mev-protect |
| T10 | **Secrets in repo / logs** | gitleaks CI (SHA-pinned, fails on findings); pino hook masks wallet addresses; at-rest encryption with random salts, no fallback key | W-01, W-06, W-15 |
| T11 | **Missing security env at boot** | Production fail-fast: boot dies with an explicit list of missing security-critical vars | W-05 |
| T12 | **Supply-chain (bad dep / action)** | `pnpm audit` gate (high+), CycloneDX SBOM, OpenSSF Scorecard, all third-party GitHub Actions SHA-pinned, lockfile frozen in CI | `.github/workflows/supply-chain.yml`, `scorecard.yml` |
| T13 | **Malicious merge to money paths** | CODEOWNERS on `addresses.ts`/`core/`/`policy/` + branch protection; signed commits; signer-policy CI `--check` | `.github/CODEOWNERS`, `supply-chain.yml` |
| T14 | **Dishonest health → silent outage** | Real `/api/v1/health` (DB/Redis/RPC/worker); DB down ⇒ 503; SLO digest + 🔴/🟡 alerts | W-15 |

## 5. Explicitly out of scope / accepted

- **f(x) Protocol contract bugs** — report to AladdinDAO (see `SECURITY.md`).
- **Third-party service compromise** (Privy, Render, Cloudflare, Upstash).
- **Base→Ethereum bridge execution** — operator-gated OFF until fork-verified and
  the OFT adapter is added to the policy allow-list (see `docs/GAPS.md`).
- **Privy signing call itself** — verified by the live wallet setup, not by the
  Anvil fork (signing isn't injectable yet); everything around it is fork-verified.
- **Volumetric DoS** — handled at the edge, not in app logic.

## 6. Review cadence

Re-review on any change to: the broadcast path, the signer policy, the address
registry, the auth/onboarding flow, or a new external dependency on a money path.
Quarterly review otherwise. Record material changes as an ADR.
