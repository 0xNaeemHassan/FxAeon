# Runbook: f(x) Keeper Down

## Detection
- No limit orders filling for >30 minutes
- `/v1/order-updates` returning empty despite open orders
- User complaints about unfilled orders

## Response

### 1. Verify keeper status
```bash
curl -s https://fx-limit-order-api.aladdin.club/v1/health
```

### 2. Check f(x) Discord/forum
- https://forum.aladdin.club/ for announcements

### 3. Notify users
- "Limit order execution is temporarily delayed. Your orders are safe on-chain."
- Orders remain valid until deadline or cancellation

### 4. No action required from us
- f(x) keepers are protocol-run, not our infrastructure
- We only submit and poll; execution is f(x)'s responsibility

### 5. Post-incident
- Confirm keeper recovery
- Check for any expired orders during outage
