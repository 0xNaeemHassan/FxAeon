# Market quote render work

`liveMarketStore` supplies `useSyncExternalStore` snapshots to market consumers.
Previously every throttled publish created new ETH and BTC snapshot objects,
even when only one instrument received a quote. React therefore rerendered an
unaffected instrument solely because its clock field changed.

The store now retains snapshot identity until its quote or freshness changes.
Status changes still notify both instruments immediately. The 250 ms publish
cap, sequence rejection, validated quote values, and inclusive 20-second
freshness boundary remain unchanged. No price enters transaction planning.

Expiry scheduling also skips already-expired quotes and schedules the next
remaining expiry. Previously the first expiry could leave the other instrument
without its own later notification when the stream went quiet.

## Controlled evidence

The source regression and real React browser-hook harness publish 20 successive
BTC-only ticks while an ETH quote remains fresh:

| Observable | Baseline | Candidate |
| --- | ---: | ---: |
| Unrelated ETH snapshot updates | 20 | 0 |
| BTC snapshot updates | 20 | 20 |

The browser harness confirms zero additional ETH consumer renders and all 20
BTC renders. Its clock and quote stream are deterministic fixtures, not live
traffic. This is eliminated render work, not a measured battery-life claim.

The source test also covers replayed/out-of-order sequences, reconnect status,
separate ETH/BTC expiry, a 100-tick burst retaining the 250 ms cap, and no repeated
expiry notifications after both quotes are stale. Independent review additionally
checked the exact 20,000 ms boundary and 10,000 deterministic quote/status/timer
operations with 2,038 freshness assertions.

```sh
cd apps/mini-app
node --import tsx --test test/live-market-store.test.ts test/live-market.test.ts
pnpm exec playwright test --config playwright.overlay.config.ts live-market-store.spec.ts
```

Browser verification used official Chromium Headless Shell 153.0.8010.12 with
sandboxing enabled through a local runner override. Production browser
configuration is unchanged. The store does not change network subscriptions,
RPC cadence, financial quote TTLs, or execution checks.

## Startup investigation

A separate drawer-history loading experiment was discarded. In five local
production-export runs per variant (390×844, 4× CPU slowdown, 10 Mbps/40 ms,
uncompressed loopback server, external feeds blocked), hydration medians were
5,141 ms before and 5,168 ms with deferral; the scripted first interaction was
316/379 ms. Navigation prefetch soon fetched the deferred code anyway. These
samples do not establish a production latency change. No drawer deferral,
wallet-provider restructuring, or overlay-navigation change is retained here.
