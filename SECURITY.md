# Security policy

FxAeon is unaudited application software that prepares financial transactions
in a static browser client. Protocol audits do not audit FxAeon's UI, Privy
configuration, dependency lockfile, deployment, or transaction validation.

## Report a vulnerability privately

Do not publish exploit details, private keys, wallet data, Telegram launch data,
Privy tokens, raw calldata, or provider credentials in an issue, chat, or pull
request. Use the repository's **Security** tab to create a private GitHub
security advisory. Include the affected commit, component, reproducible steps,
impact, and mitigation if known.

## Security boundaries

- FxAeon has no backend, webhook, database, Redis, worker, queue, or delegated
  signer.
- Privy is the wallet custody and explicit signing boundary. No private key is
  accepted by FxAeon code or stored in browser state.
- The official f(x) SDK is the only protocol planner. The client validates its
  transaction targets, selectors, sender, chain, value, approvals, nonce, and
  order before every visible wallet prompt.
- A rejected, reverted, timed-out, or nonce-drifted step stops the route.
- Local storage is only a UI/recovery hint and never an authority for balances,
  receipts, permissions, or bridge delivery.
- Test against local fixtures, safe simulations, or a local fork. Never use
  another user's wallet or production funds to reproduce a bug.

The active model and release gates are documented in
[`docs/security.md`](docs/security.md) and [`docs/testing.md`](docs/testing.md).
