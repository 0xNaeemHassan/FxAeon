# fxBot Threat Model

## Asset Inventory

| Asset | Location | Sensitivity |
|---|---|---|
| User private keys | Privy TEE (SOC 2 Type II) | Critical — never in our infra |
| BYOK encrypted keys | Postgres (libsodium secretbox) | High — per-user salt + KMS |
| User wallet addresses | Postgres | Medium — public on-chain |
| Telegram IDs | Postgres | Medium — PII |
| Automation rules | Postgres | Medium — financial logic |
| Audit logs | Postgres | Medium — compliance |
| API keys (Surplus, Alchemy) | Fly.io secrets | High |

## Threat Scenarios

### T1: Stolen Telegram Session
**Impact:** Attacker can interact with bot, view portfolio, trigger trades if automation enabled.
**Mitigation:**
- Privy still requires auth factor (email/passkey) for sensitive ops
- Automation policy restricts to pre-approved contracts only
- Daily tx cap limits blast radius

### T2: Compromised Backend Server
**Impact:** Attacker could attempt to execute automation rules, read database.
**Mitigation:**
- Policy Engine denies anything outside 3 ALLOW rules
- Default-deny: no transfers, no arbitrary approvals
- Max blast radius = whatever automation user authorized
- Database encrypted BYOK keys unreadable without KMS

### T3: Compromised Database
**Impact:** Attacker reads user data, encrypted BYOK keys.
**Mitigation:**
- BYOK keys encrypted with libsodium secretbox
- Per-user salt means rainbow tables ineffective
- Privy keys NOT in our DB at all
- No private keys stored in plaintext

### T4: Compromised RPC (Alchemy/Flashbots)
**Impact:** Attacker could see transaction data, potentially censor.
**Mitigation:**
- User can toggle Flashbots Protect (different RPC)
- We verify tx hashes match what we sent
- No sensitive data in RPC calls (just signed tx)

### T5: Smart Contract Exploit (f(x) Protocol)
**Impact:** User funds at risk via protocol bug.
**Mitigation:**
- We are not the protocol; we are an interface
- Audits surfaced in /security (ToB, OpenZeppelin, Secbit)
- AS-IS software disclaimer in ToS
- No investment advice given

### T6: MEV Attack on User Trades
**Impact:** User gets sandwiched on large swaps.
**Mitigation:**
- Flashbots Protect toggle (free, opt-in)
- Default public mempool = faster, but sandwich risk
- User informed of trade-offs in /settings

### T7: Insider Threat (Developer)
**Impact:** Malicious code deployment.
**Mitigation:**
- All deploys via CI/CD (GitHub Actions)
- Require PR review + approval
- No manual production access
- Audit log of all deploys

## Attack Tree (Simplified)

```
Compromise fxBot
├── Steal User Funds
│   ├── Break Privy TEE → Infeasible (SOC 2, hardware enclave)
│   ├── Extract KMS key → Needs server + DB compromise
│   ├── Social engineer user → User education, confirmation prompts
│   └── Exploit f(x) contracts → Protocol risk, not ours
├── Disrupt Service
│   ├── DDoS backend → Cloudflare WAF, Fly.io auto-scaling
│   ├── DDoS Telegram → Telegram handles, we can't
│   └── Corrupt database → R2 backups, daily snapshots
└── Data Breach
    ├── Read Postgres → Encrypted BYOK, no keys
    ├── Read logs → No PII in logs, hashed IDs
    └── Read Redis → BullMQ job data, no keys
```

## Risk Acceptance

| Risk | Likelihood | Impact | Status |
|---|---|---|---|
| f(x) protocol exploit | Low | Critical | Accepted (external) |
| Privy TEE breach | Very Low | Critical | Mitigated (SOC 2) |
| Backend compromise | Low | High | Mitigated (policies, default-deny) |
| Database breach | Low | Medium | Mitigated (encryption) |
| MEV sandwich | Medium | Low-Med | Mitigated (Flashbots toggle) |
| Telegram session theft | Medium | Low | Mitigated (2FA, tx caps) |
