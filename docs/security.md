# Security model

FxAeon prepares financial transactions in an untrusted browser environment. Its smallest trusted design keeps protocol logic in the pinned official SDK and signing authority in the user's wallet.

## Core invariants

- No private key enters FxAeon React state, DOM, logs, storage, or build output.
- No server authorization key, session signer, delegated wallet, or background executor exists.
- The selected Privy wallet is the only accepted sender.
- Supported chains are exactly Ethereum `1` and Base `8453`.
- Every SDK step gets a separate visible wallet confirmation.
- A later step is never submitted before the previous receipt succeeds.
- Exact approvals are used; unlimited approvals and blanket position approvals are rejected.
- Bridge source confirmation is not labeled destination delivery.
- A bridge recipient may differ from the signer; the source event must match
  the selected signer, the fee refund returns to that signer, and destination
  delivery must match the separately reviewed recipient.
- Generic price APIs are not execution inputs and are not included at launch.

## Plan validation

Before signing, the client verifies address encoding, sender, chain ID, destination, calldata selector, native value, transaction order, nonce, approval spender, and approval amount. The route is simulated as an ordered call set. Immediately before each signature the pending nonce is reread; drift aborts the route. After mining, the runner fetches the transaction again and requires its sender, destination, calldata, value, and nonce to equal the reviewed request before the step can be marked confirmed.

The transaction summary is convenience UI, not the authority. The validated raw target, selector, value, approval, and chain are shown alongside the human-readable SDK result.

## Browser and hosting

- CSP restricts network requests to Privy, Goldsky, Alchemy, and WalletConnect;
  the audited native FxRoute path does not require a generic quote aggregator.
- The static build hashes every generated inline Next.js bootstrap script into
  `script-src`; production does not rely on `script-src 'unsafe-inline'`.
- RPC keys are public by design but must have exact origin allowlists, network restrictions, quotas, and alerts.
- The app has no service worker; older FxAeon workers are unregistered to prevent stale financial state.
- Static previews and production use separate Privy and Alchemy applications.
- No secrets are placed in `NEXT_PUBLIC_*` variables.
- Logs and analytics must not capture Telegram init data, Privy tokens, calldata, full wallet history, or private material.

## Supply chain

Runtime financial dependencies use exact versions. `@aladdindao/fx-sdk@1.0.5` carries a reproducible patch matching upstream commit `53c0b9805a169e75ad375c92c241e1292b66405f`; CI asserts the official method surface and patch. Upstream changes create a review issue and never update signing policy automatically.

## Residual trust

Users still trust the delivered static JavaScript, Privy custody/signing UI, Alchemy availability, Goldsky discovery, official SDK correctness, token contracts, LayerZero, and the underlying chains. A compromised deployment can mislead a user even if the wallet remains explicit; protected production access, dependency review, CSP, transaction validation, and wallet detail inspection remain mandatory.
