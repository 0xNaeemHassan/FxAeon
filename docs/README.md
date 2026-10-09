# Documentation

The financial app is hosted at [fxaeon.com](https://fxaeon.com/); the separate
public landing site is [fxaeon.xyz](https://fxaeon.xyz/). The app's read-only
product guide is available under **More → FxAeon docs** and at `/docs`.

## Maintainer guides

| Guide | Purpose |
| --- | --- |
| [Design contract](../DESIGN.md) | Shared app surfaces, themes, responsive controls, and transaction presentation |
| [Architecture](architecture.md) | App boundaries, transaction flow, and state ownership |
| [Product behavior](product-behavior.md) | App areas, transaction reviews, and compact mobile layout |
| [SDK scope](sdk-scope.md) | Locked f(x) SDK method contract and reviewed package patch |
| [Security](security.md) | Trust assumptions and controls |
| [Testing](testing.md) | Local, CI, browser, and protected fork checks |
| [Browser test gates](browser-test-gates.md) | The production suite and isolated browser harnesses, with their commands |
| [UI state lab](ui-state-lab.md) | The development-only state catalog and its approved screenshots |
| [Release validation record](release-validation.md) | Revision-specific automated and visual evidence |
| [Product review captures](review/README.md) | Curated mobile screenshots from the implementation |
| [Deployment](deployment.md) | App and landing Cloudflare Pages configuration |
| [Brand assets](brand-assets.md) | Marks, themes, and image-use rules |
| [Position screenshot fixture](position-screenshot-fixture.md) | Capture provenance and regeneration commands |
| [Launch checklist](launch-readiness.md) | Durable release review items |

Start with [`../SETUP.md`](../SETUP.md) to run the workspace and
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) before changing it. The landing
artwork source prompt is retained in [`landing-art-prompt.md`](landing-art-prompt.md).

Generated screenshot manifests and their image files are evidence artifacts;
they are not substitutes for the separate automated test gates described in
[`testing.md`](testing.md).

## Dated records and research

These describe the code as it was on their date; later changes may not be
reflected in them.

| Record | Subject |
| --- | --- |
| [Runtime hardening, 3 October 2026](runtime-hardening-2026-10.md) | Review, history, portfolio-read and gas changes, with their validation limits |
| [Privy Telegram audit, 3 October 2026](privy-telegram-miniapp-audit.md) | Privy configuration for the Telegram Mini App |
| [Design critique, 7 October 2026](design-critique-2026-10.md) | Interaction and visual craft against Uniswap and Jumper |
| [Uniswap and Balancer](frontend-research-uniswap-balancer.md), [Jumper and Curve](frontend-research-jumper-curve.md) | Frontend data and transaction patterns, from pinned source |
| [Performance notes](performance/) | Long review preparation, SDK pool reads, market render work, and RPC chain proof |
