# Documentation

The financial app is hosted at [fxaeon.com](https://fxaeon.com/); the separate
public landing site is [fxaeon.xyz](https://fxaeon.xyz/). The app's read-only
product guide is available under **More → FxAeon docs** and at `/docs`.

## Maintainer guides

| Guide | Purpose |
| --- | --- |
| [Architecture](architecture.md) | App boundaries, transaction flow, and state ownership |
| [SDK scope](sdk-scope.md) | Locked f(x) SDK method contract and reviewed package patch |
| [Security](security.md) | Trust assumptions and controls |
| [Testing](testing.md) | Local, CI, browser, and protected fork checks |
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
