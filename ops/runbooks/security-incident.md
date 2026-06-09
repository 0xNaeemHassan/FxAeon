# Runbook: Security Incident

## Symptoms
- Unauthorized transactions
- Suspicious API activity
- User reports of compromised wallets

## Steps
1. **IMMEDIATE**: Pause all trading via circuit breaker
2. Revoke all active sessions: `redis-cli FLUSHDB`
3. Check access logs for anomalies
4. Identify affected users
5. Reset Privy API keys
6. Rotate Telegram bot token via @BotFather
7. Audit database for unauthorized changes
8. Notify security team and legal

## Post-Incident
- Document timeline
- Update threat model
- Schedule security review
