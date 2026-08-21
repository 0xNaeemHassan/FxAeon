# Documentation

These guides describe the repository's current behavior as of August 2026. Application source, tests, the Prisma schema, and deployment configuration remain authoritative when code and prose disagree.

## Use FxAeon

- [User guide](user-guide.md): onboarding, funding, positions, borrowing, savings, bridging, withdrawals, automation, and recovery
- [Mini App](mini-app.md): routes, launch contexts, wallet controls, unified action lifecycle, and degraded states
- [Telegram commands](telegram-commands.md): exact syntax, aliases, prerequisites, and capability status
- [SDK capability matrix](sdk-capabilities.md): every SDK 1.0.5 method and its actual FxAeon coverage

## Build and operate FxAeon

- [Setup](../SETUP.md): prerequisites, environment, database, local development, and tests
- [Architecture](architecture.md): components, data flow, trust boundaries, and transaction lifecycle
- [HTTP API](api.md): mounted routes, authentication, request shapes, and limitations
- [Security model](security.md): custody, delegation, signer policy, simulation, and incident posture
- [Threat model](threat-model.md): protected assets, adversaries, controls, and residual risks
- [Deployment](DEPLOYMENT.md): Render, static Mini App hosting, Docker, migrations, and release gates
- [Operations](operations.md): health probes, workers, monitoring, backups, rollback, and troubleshooting
- [Incident runbooks](../ops/runbooks/README.md): scoped response procedures for outages, compromise, providers, database recovery, and protocol upgrades
- [External services](external-apis.md): Telegram, Privy, Ethereum/Base RPCs, LayerZero, market data, relay, Flashbots, and Etherscan

## Contribute and review

- [Contributing](../CONTRIBUTING.md)
- [Security reporting](../SECURITY.md)
- [Architecture decisions](adr/README.md)
- [Changelog](../CHANGELOG.md)
- [Known gaps and roadmap](GAPS.md)

## Historical records

Files under [`audit/`](audit/) are archive pointers, not external audit reports. `PLAN.md` is the maintained roadmap and `COMPLETED.md` is a concise inventory; neither is proof by itself. Current claims must be supported by current source or verification output.
