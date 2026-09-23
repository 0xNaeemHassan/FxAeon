# Performance evidence

`performance-measurement.spec.ts` records three observable stages: Trade navigation to an editable amount field, ActionReview mounting to a reviewable quote, and one explicit confirmation to visible refreshed account data. The two ActionReview timings use the dedicated harness; the quote delay (125 ms) and refresh delay (225 ms) are fixed test inputs. The harness does not contact a wallet, RPC endpoint, or chain. These timings include browser-side setup, rendering, and the specified wait, so they do not represent production latency.

Completed runs are preserved in [`performance-samples.json`](./performance-samples.json). The fresh production E2E suite recorded 1,417.89 ms from Trade navigation to a visible, enabled amount field in Chromium 149 Pixel 7 emulation at 390×844. That is a browser emulation result, not a physical-device measurement. The suite also recorded 1,533.50 ms to a usable quote and 396.69 ms from explicit confirmation to the refreshed fixture value in the ActionReview harness. The harness page uses a 980×2121 CSS viewport because its minimal `setContent` document lacks a mobile viewport meta tag; its 125 ms quote wait and 225 ms refresh wait are simulated inputs, so these are not production quote or account-refresh latencies.

A separate, single desktop Chromium run against that same built export measured 2,254.71 ms for the editable form, which illustrates run/context variability and should not be combined with the mobile emulation result. Neither timing measures server startup or build time. There is no comparable before-change baseline, so none of these observations supports a performance-improvement claim.

To run the editable-form measurement, use Node.js 22 and pnpm from the mini-app directory. It requires a built local app served at `http://localhost:4331` (or set `PERFORMANCE_BASE_URL` to another local app URL); the test does not build the app:

```sh
cd apps/mini-app
pnpm exec playwright test --config playwright.performance.config.ts --grep "records time from Trade navigation"
```

Run the deterministic harness measurements without a running app, also from the mini-app directory:

```sh
cd apps/mini-app
pnpm exec playwright test --config playwright.performance.config.ts --grep "records usable quote and refreshed account timings"
```
