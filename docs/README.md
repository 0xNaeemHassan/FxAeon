# Documentation

These documents describe the active product and its release process. The public
marketing site is [fxaeon.xyz](https://fxaeon.xyz/). The financial browser and
Telegram Mini App is [fxaeon.com](https://fxaeon.com/), which opens on Portfolio;
`/portfolio` remains a backwards-compatible app alias.

## User guide

The client includes a searchable, read-only [`/docs` guide](../apps/mini-app/src/app/docs/page.tsx), available from **More → FxAeon docs**. It covers wallets, Trade, Positions, Earn, Borrow, Move, History, fees, recovery, and risks, and works without a connected wallet or Telegram.

![FxAeon’s in-app documentation with searchable section navigation](assets/fxaeon-docs.png)

## Engineering references

| Document | Audience | Covers |
| --- | --- | --- |
| [`architecture.md`](architecture.md) | Developers and reviewers | Runtime data flow, module boundaries, and state ownership |
| [`sdk-scope.md`](sdk-scope.md) | Integrators and reviewers | Immutable 15-method f(x) SDK capability contract |
| [`security.md`](security.md) | Maintainers and auditors | Threat model, controls, and residual trust |
| [`testing.md`](testing.md) | Contributors and release operators | Automated, chaos, fork, and manual acceptance gates |
| [`implementation-progress.md`](implementation-progress.md) | Maintainers and reviewers | Current domain split, evidence, and remaining verification gaps |
| [`brand-assets.md`](brand-assets.md) | Product, design, documentation, and social owners | Approved supplied masters, theme tokens, safe areas, accessibility, and export rules |
| [`post-transaction-ux.md`](post-transaction-ux.md) | Integrators and reviewers | Pinned transaction UX study and adopted recovery patterns |
| [`roadmap.md`](roadmap.md) | Product and engineering | Release posture and deliberately deferred work |

Start with [`SETUP.md`](../SETUP.md) for local development and [`CONTRIBUTING.md`](../CONTRIBUTING.md) before changing the repository. Historical designs remain in git history and are not active documentation.
