# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in FxAeon, please report it responsibly:

1. **Do NOT open a public issue** — this could expose the vulnerability to attackers
2. Email security reports to: [security@fxaeon.dev] (or create a private security advisory on GitHub)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Fix deployment**: Within 30 days (critical), 90 days (high), 180 days (medium/low)

## Security Measures

- All wallet private keys are managed by Privy (MPC infrastructure)
- Database credentials are encrypted at rest
- Rate limiting prevents brute-force attacks
- All transactions require user confirmation
- Smart contract interactions are validated before execution

## Audit History

| Date | Auditor | Scope | Result |
|------|---------|-------|--------|
| 2026-06 | Internal | Bot commands, API endpoints | Passed |
| 2026-06 | Internal | Mini App, Privy integration | Passed |
| 2026-06 | Internal | Database, Redis, encryption | Passed |

## Disclosure Policy

We follow coordinated disclosure:
1. Reporter submits vulnerability privately
2. We investigate and develop a fix
3. Fix is deployed
4. Public disclosure after 30 days (or sooner with reporter's consent)
