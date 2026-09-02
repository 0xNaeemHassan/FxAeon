# Security model

FxAeon prepares financial transactions in an untrusted browser environment. The smallest trusted design keeps protocol logic in the pinned official SDK and signing authority in the user's wallet.

## Core invariants

- No private key enters FxAeon React state, the DOM, logs, storage, or build output.
- No server authorization key, session signer, delegated wallet, or background executor exists.
- The explicitly selected Privy or browser-injected wallet is the only accepted sender.
- Supported chains are exactly Ethereum `1` and Base `8453`.
- Every SDK step gets a separate visible wallet confirmation.
- A later step is never submitted before the previous receipt succeeds.
- Exact approvals are used; unlimited approvals and blanket position approvals are rejected.
- Bridge source confirmation is not labeled destination delivery.
- A bridge recipient may differ from the signer. The source event must match the selected signer, the fee refund returns to that signer, and destination delivery must match the separately reviewed recipient.
- The reviewed USD price feeds are display-only: DefiLlama current prices use freshness/confidence validation, and CoinGecko ETH/BTC history uses shape, density, range, freshness, and future-skew validation. Both are structurally isolated from planning, policy, calldata, simulation, signing, and receipts.
- Production has no Sentry, Datadog, LogRocket, paid telemetry, source-map upload, or automatic error-reporting wrapper. Diagnostics are local/CI-only and sanitized.
- Privy's optional hCaptcha screen is retained for authentication, but its transitive loader is aliased to a local no-telemetry loader so the hCaptcha-owned Sentry client and DSN are not shipped.

## Threats and controls

| Threat | Control |
| --- | --- |
| A stale or tampered plan targets the wrong account or chain | Bind every plan to the selected wallet address and supported chain; revalidate immediately before signing |
| Malicious or malformed calldata | Validate destination, selector, value, approval spender/amount, route order, and nonce; display the reviewed request |
| A multi-step route continues after failure | Wait for each receipt and stop on rejection, revert, timeout, or nonce drift |
| Local storage is manipulated | Treat recovery records as hints only; re-read receipts, events, and SDK state |
| Bridge source is mistaken for delivery | Verify matching LayerZero GUID events on the destination chain |
| Public RPC credentials are abused | Restrict provider origins, networks, quotas, and alerts; reject non-reviewed hosts at build/runtime |
| Stale or malformed USD prices mislead the interface | Require positive values, current timestamps, confidence thresholds, required markets, and bounded/fresh chart history; retain exact on-chain units and never use USD displays as execution inputs |
| Stale browser code serves old state | Ship a static build without active caching and unregister the legacy service worker once |
| Dependency or deployment compromise | Pin and audit dependencies, verify scope and bundle contents, protect production deployment access |

## Plan validation

Before signing, the client verifies address encoding, sender, chain ID, destination, calldata selector, native value, transaction order, nonce, approval spender, and approval amount. The route is simulated as an ordered call set. Immediately before each signature the pending nonce is reread; drift aborts the route. After mining, the runner fetches the transaction again and requires its sender, destination, calldata, value, and nonce to equal the reviewed request before the step can be marked confirmed.

The human-readable transaction summary is convenience UI, not authority. The validated raw target, selector, value, approval, and chain are shown alongside the SDK result.

## Browser and hosting

- CSP restricts network requests to reviewed Privy, Alchemy, wallet-connector, token-asset, and display-price hosts.
- The static build hashes every generated inline Next.js bootstrap script into `script-src`; production does not rely on `script-src 'unsafe-inline'`.
- Browser RPC keys are public by design but must use exact origin allowlists, network restrictions, quotas, and alerts.
- Static previews and production use separate Privy and provider applications.
- No secrets are placed in `NEXT_PUBLIC_*` variables.
- Logs and analytics must not capture Telegram init data, Privy tokens, calldata, full wallet history, or private material.

## Supply chain

Runtime financial dependencies use exact versions. `@aladdindao/fx-sdk@1.0.5` carries a reproducible patch matching upstream commit `53c0b9805a169e75ad375c92c241e1292b66405f`; CI asserts the official method surface and patch. Upstream changes create a review issue and never update signing policy automatically.

## Residual trust

Users still trust the delivered static JavaScript, Privy or browser-wallet signing UI, Alchemy availability, wallet-connector providers, official SDK correctness, token-asset hosts, token contracts, LayerZero, and the underlying chains. A compromised deployment can mislead a user even if the wallet remains explicit; protected production access, dependency review, CSP, transaction validation, and wallet-detail inspection remain mandatory.
