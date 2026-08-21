# Runbook: f(x) limit-order relay or keeper degradation

FxAeon currently has authenticated HTTP primitives for order prepare/submit/status/cancel calldata, but no supported Telegram or Mini App signing UI. `/limit` is preview-only. Use this runbook only for orders already submitted through the backend primitive or imported into its database.

## Detect and scope

- Inspect limit-order poller logs/heartbeat and transport errors to the configured official relay base URL in source.
- Identify locally recorded `open` orders, deadlines, makers, order hashes, and last relay update.
- Read on-chain execution state through the authenticated status primitive or a reviewed contract call.
- Check official f(x) status/announcements. Do not rely on an undocumented relay health URL.
- Distinguish relay submission failure, incremental-update failure, keeper non-execution, expired order, and a database-only stale status.

## Contain

1. Stop any internal client from submitting new orders if relay integrity or contract compatibility is uncertain. The public user interfaces do not currently submit.
2. Preserve signed order payloads, relay responses, order hashes, deadlines, nonce, and on-chain execution state.
3. Do not mark orders filled/cancelled from relay silence alone.
4. Do not tell users that an order is "safe on-chain": an unfilled signed order is relayed off-chain and remains executable until its deadline, maker nonce change, or contract cancellation rules make it invalid.

## User/operator options

- For a single order, build cancellation calldata only for the authenticated maker and have the maker sign/broadcast it through a reviewed wallet flow outside the unsupported FxAeon UI.
- To invalidate all maker orders, the authenticated endpoint can return `increaseNonce` calldata; this is also an on-chain transaction the maker must sign.
- If no supported signing path is available, explain that cancellation cannot be completed inside current FxAeon and direct the user to an independently verified official interface.

## Recover and close

- Confirm relay transport and incremental polling have recovered.
- Reconcile every affected order against contract execution state and deadline before updating local status.
- Verify signature/maker binding, order hash parity, known pool checks, and cancel calldata after any protocol upgrade.
- Document missed/late fills and user communications without claiming a threshold fill price or keeper guarantee.
