# Security model

FxAeon is client software for financial transactions. The delivered browser
code and the wallet display are part of the trust boundary; a static client
cannot protect a user from a compromised release. FxAeon is unaudited. This
document describes design controls, not a guarantee of safety.

## Trust boundaries

- The selected Privy or injected wallet controls signing. FxAeon does not ask
  for private keys or run a delegated signer.
- The official f(x) SDK owns protocol planning. FxAeon validates, simulates,
  presents, and executes only the locked method surface in
  [`../fx-scope.lock.json`](../fx-scope.lock.json).
- Supported networks are Ethereum (`1`) and Base (`8453`). Positions, Borrow,
  and fxSAVE use Ethereum; Move supports specified fxUSD and fxSAVE bridges.
- Public RPCs, wallet providers, token contracts, price feeds, the SDK,
  LayerZero, hosting, and the chains remain external dependencies.

## Transaction controls

Before a wallet request the app binds the route to the selected wallet session
and inputs, validates its destination, selector, value, approvals, order, and
nonce, then simulates it. Each step receives its own wallet confirmation. The
runner verifies the returned transaction and receipt and stops on rejection,
failure, timeout, nonce drift, or receipt mismatch. A later step is not sent
until its predecessor is confirmed. Bridge send and destination delivery are
separate states, checked against matching LayerZero messages.

Local storage, indexers, cached reads, and display prices are not protocol
authority. Recovery hints are revalidated against receipts and current SDK or
canonical chain reads. Missing reads remain unavailable rather than becoming
zero. USD prices and position estimates do not affect transaction planning or
signing. Position value is not P&L, ROI, health, or liquidation value.

## Browser and release controls

- Public RPC endpoints are restricted to the reviewed HTTPS Alchemy host for
  the selected chain; the client checks the reported chain ID at financial
  boundaries. Browser-visible API keys must be origin-restricted and quota
  limited.
- `NEXT_PUBLIC_*` settings are public build inputs. Privy secrets,
  `TELEGRAM_BOT_TOKEN`, and the optional gas-oracle key stay in deployment
  secrets; none belongs in the client bundle.
- CSP, security headers, bundle checks, dependency auditing, and frontend secret
  scans are part of `pnpm verify` and the release workflow. These checks reduce
  risk but cannot prove a deployment or dependency is uncompromised.
- The optional `/api/gas` Pages Function accepts a fixed read-only Ethereum gas
  oracle request. It has no wallet or protocol authority.
- Production deployment and Telegram bot synchronization use protected GitHub
  Actions settings. See [`deployment.md`](deployment.md).

Do not log Telegram launch data, authentication tokens, private material,
unredacted wallet history, or unnecessary transaction details. Report
vulnerabilities privately using the process in the repository's
[`SECURITY.md`](../SECURITY.md).
