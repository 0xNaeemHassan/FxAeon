# Runbook: Ethereum or Base RPC degradation

Use this for rate limits, timeouts, stale heads, chain mismatch, or missing `eth_simulateV1` support on `ALCHEMY_RPC_URL` or `BASE_RPC_URL`. The variable names are historical; either URL may point to a reviewed production provider.

## Detect and scope

- Inspect `/api/v1/health`: `services.rpc` is Ethereum and `services.baseRpc` is Base.
- Record provider status codes, latency, the last successful block, and which user actions fail.
- Query `eth_chainId`, `eth_blockNumber`, and the latest block timestamp through a secret-safe client. Expect chain 1 for Ethereum and 8453 for Base.
- Distinguish read failures from ordered-route simulation failures. A provider can answer basic reads while lacking the simulation method FxAeon requires.
- Check the provider's official status/quota dashboard using the deployment account. Do not paste RPC URLs into incident chat.

## Contain

1. Keep affected funds-moving paths fail-closed. Do not bypass `simulateRoute` or switch to an unreviewed public RPC.
2. If Base is affected, keep `BRIDGE_EXECUTION_ENABLED=false` or disable it in the deployment and restart. This contains bridge execution only.
3. If Ethereum is affected, isolate state-changing API/bot traffic at the edge or stop the bot process if users could receive inconsistent previews. Read surfaces should report degraded/unknown data rather than zeros.
4. Pause off-chain automation if its required RPC or market state cannot be read reliably. Record the rows changed; pausing rules does not revoke signer authority.

## Recover

1. Select a provider endpoint already approved for the correct mainnet, quotas, privacy posture, and `eth_simulateV1`/`eth_feeHistory` behavior.
2. Change only the affected secret (`ALCHEMY_RPC_URL` or `BASE_RPC_URL`) through the deployment secret store and restart normally.
3. Verify chain ID, fresh head, ordered simulation, fee history, nonce reads, logs, and receipts before restoring state-changing traffic.
4. For bridge recovery, verify both RPCs and both direction mappings even if only one provider failed.

## Validate and close

- Deep health reports the intended RPC healthy with a fresh head.
- A read-only SDK quote and a no-broadcast simulation succeed on the affected chain.
- Non-terminal transactions from the outage window have been reconciled by chain ID and hash.
- Automation resumes only after fresh market and chain state are available.
- Record quota/root cause and whether caching, polling load, or provider capacity needs a reviewed code/config change.

Do not hardcode public fallback RPCs in an incident; doing so changes trust, privacy, rate-limit, and simulation assumptions without review.
