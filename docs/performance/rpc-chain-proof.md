# Reusing an explicit RPC chain guard as the endpoint proof

## Scope

The shared HTTP transport proves an endpoint's chain before letting ordinary
reads through. Previously, when a cold caller itself requested `eth_chainId`,
the transport sent a separate `eth_chainId` preflight, waited, then sent the
caller's identical guard. The same waterfall recurred after the existing
60-second endpoint-proof window expired.

The first explicit guard now sends its original request under the existing
short proof deadline. The transport verifies the expected chain before
returning its intact response or allowing waiting reads to proceed. A guard
joining somebody else's proof still sends its own request. Warm guards remain
uncached; no later planning, signing, recovery, or balance guard is removed.

This is a transport scheduling change, not a transaction-plan cache. No balance,
block, quote, nonce, fee, allowance, receipt, or simulation result is cached or
suppressed. Query freshness, account/chain keys, post-receipt invalidation,
background transaction tracking, and the pinned SDK patch are unchanged.

## Controlled measurement

Measured with Node 22.23.3, the installed viem/Wagmi/Query dependencies, and the
real wallet reader and shared HTTP transport. Each fixture HTTP response takes
40 ms. Nine samples per case; medians below. All exact balance results matched
across every sample and variant. These are offline fixtures, not live-provider
latency or infrastructure-billing claims.

| Read | Before median | After median | HTTP requests before → after |
| --- | ---: | ---: | ---: |
| Cold wallet | 125.98 ms | 84.71 ms | 4 → 3 |
| Warm wallet | 84.36 ms | 83.74 ms | 3 → 3 |
| Expired endpoint proof | 124.61 ms | 83.90 ms | 4 → 3 |
| Cold exact + portfolio observers | 128.68 ms | 83.78 ms | 4 → 3 |

Each saved request is the redundant `eth_chainId` preflight. The native-balance
request and ERC-20 multicall are unchanged. The affected cold/expired balance
sequence uses 25% fewer HTTP requests and saves about one network round trip.
This percentage does not describe all app traffic or all calls to an RPC provider.

### Provider cost qualification

As checked on 7 October 2026, [Alchemy's method table](https://www.alchemy.com/docs/reference/compute-unit-costs)
lists `eth_chainId` at zero billed compute units and five throughput compute
units. Removing that request reduces HTTP work and rate-limit usage, but does
not save billed Alchemy compute units for this method.
[Infura's method table](https://docs.infura.io/get-started/pricing/credit-cost/)
lists five credits per `eth_chainId`, so a removed call through that fallback
saves five credits. Dollar savings depend on provider plan and actual traffic;
25% fewer requests in this fixture is not a 25% bill reduction.

Run the reader benchmark from `apps/mini-app`:

```sh
node --import tsx test/benchmarks/rpc-chain-proof.ts
```

The component regression uses the real WalletDataProvider, wallet queries,
Wagmi/Query observers, and HTTP transport. Wallet identity, display prices, and
all network responses are local fixtures. It covers concurrent form/profile
consumers, account switches, manual refresh, disconnection, hidden-tab polling,
off-route cleanup and fresh reads after resume.

```sh
pnpm test:e2e:overlay wallet-rpc-proof
# Compare only the transport against a prior source revision:
RPC_CHAIN_PROOF_BASELINE_REF=<prior-commit> pnpm test:e2e:overlay wallet-rpc-proof
```

With the same 40 ms response fixture, the seven-sample component median was
162.3 ms before and 110.4 ms after. Initial Ethereum + Base balance work fell
from eight to six HTTP requests; both visible balances were identical. Both
variants passed all three lifecycle tests, including zero hidden/off-route
polling and fresh balances on resume. The browser test attaches all seven
response-to-render timing samples. Its
latency measurement begins at component mounting and ends after both Ethereum
and Base balances are ready; it excludes application download/startup.

## Safety and tradeoffs

- The existing 1.5-second hosted / 10-second local-fork probe deadline covers
  both response headers and body verification. Caller cancellation propagates
  through the direct proof; late aborted bodies cannot mark it verified.
- Ordinary cold reads still wait for a separate verified endpoint proof.
- Wrong-chain, malformed, HTTP-error and RPC-error responses cannot unlock
  dependent reads. The existing 5-second failure cooldown and failover remain.
- Chain, endpoint URL and fetch-implementation scopes remain independent.
- The direct proof clones its response to validate the body without consuming
  the response expected by viem. This adds one tiny body parse on affected
  guards in exchange for removing an entire HTTP round trip.
- Real provider rate limits, live-chain execution and actual cost savings are
  not measured by these deterministic tests. Final financial revalidation is
  still required, exactly as before.
