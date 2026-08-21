# Security policy

## Supported version

Security fixes are made against the current `main` branch and the latest released version. Older tags are not guaranteed to receive backports.

## Report a vulnerability privately

Do not open a public issue, discussion, Telegram message, or pull request containing exploit details, secrets, private keys, user data, or an unpatched funds-risk bug.

Use the repository's **Security** tab to create a private GitHub security advisory. Include:

- affected commit or version;
- affected component and deployment assumptions;
- reproducible steps or a minimal proof of concept;
- impact on funds, signer authority, authentication, privacy, or availability;
- whether the issue has been exploited or publicly disclosed;
- a suggested mitigation, if known.

If private advisories are unavailable, contact a maintainer through a private channel and ask for a secure reporting route without sending the exploit in the first message. This repository does not publish a verified security email address.

## Sensitive testing rules

- Test against local fixtures or an Anvil fork, not other users or production funds.
- Never use or request another user's Telegram `initData`, wallet key, Privy token, bot token, webhook secret, or authorization key.
- Do not submit a harmful order to the live relay, flood Telegram/Privy/RPC providers, or probe infrastructure outside this repository's scope.
- Preserve evidence, minimize data access, and stop once impact is demonstrated.

## Response expectations

Maintainers should acknowledge a complete report as soon as practical, reproduce it, classify severity, prepare a fix, rotate exposed credentials, and coordinate disclosure with the reporter. No guaranteed response or remediation deadline is promised by this community project.

## Security status

FxAeon is **unaudited application software**. Internal tests and reviews are not an independent security audit and do not establish that funds are safe. The f(x) protocol's audits do not audit FxAeon's bot, Mini App, backend, Privy integration, or operational configuration.

Current defenses and residual risks are documented in:

- [Security model](docs/security.md)
- [Threat model](docs/threat-model.md)
- [Signer-policy decision](docs/adr/signer-policy.md)
- [Known gaps](docs/GAPS.md)

Users should keep bot trading disabled when it is not needed, verify transaction links independently, and never risk funds they cannot afford to lose.
