# Runbook: Privy Outage

## Detection
- UptimeRobot monitor on `/health` returns >500ms or 5xx
- Sentry alerts on Privy SDK errors
- User reports "wallet not connecting"

## Response

### 1. Verify outage
```bash
curl -s https://api.privy.io/v1/health | jq .status
```

### 2. Notify users
- Post in Telegram bot: "Wallet service temporarily unavailable. Your funds are safe."
- Discord webhook alert to ops channel

### 3. Check Privy status page
- https://status.privy.io/

### 4. Mitigation
- If partial outage: retry with exponential backoff (1s, 2s, 4s, 8s)
- If full outage: queue user actions in Redis BullMQ, resume when Privy recovers
- Never store keys locally — wait for Privy recovery

### 5. Post-incident
- Update status page
- Review retry queue for stuck transactions
- Document in incident log
