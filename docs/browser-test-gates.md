# Browser test gates

The production mini-app suite and isolated component harnesses use separate Playwright configs. `pnpm test:e2e` runs only the production export suite; it does not collect the isolated harness specs.

| Gate | Fixture and config | Focused command |
| --- | --- | --- |
| Production routes and interactions | `apps/mini-app/e2e/specs`, default Playwright config | `pnpm test:e2e` |
| Borrow selection eligibility | `apps/mini-app/e2e/borrow-harness`, `e2e/borrow-harness.config.ts` | `pnpm test:e2e:borrow-harness` |
| Overlay lifecycle | `apps/mini-app/e2e/overlay-specs`, `playwright.overlay.config.ts` | `pnpm test:e2e:overlay` |
| Product state catalog | `apps/mini-app/e2e/state-lab`, `playwright.state-lab.config.ts` | `pnpm test:e2e:state-lab` |

`pnpm verify` runs the three isolated browser gates sequentially after the shared build checks. This keeps the fixtures out of normal product E2E and limits simultaneous browser memory use. A nonzero result from any focused suite makes `pnpm verify` fail and names the failing gate in its output.

The UI state lab's fixture states, capture instructions, and visual-comparison policy are documented in [ui-state-lab.md](ui-state-lab.md).
