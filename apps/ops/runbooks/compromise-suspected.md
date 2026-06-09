# Runbook: Compromise Suspected

## Triggers
- Unauthorized transactions from user wallets
- Privy anomaly alerts
- Sentry security events

## Response (IMMEDIATE)

### 1. Rotate secrets
```bash
# Fly.io secrets
flyctl secrets set PRIVY_APP_SECRET=new_secret --app fxbot
flyctl secrets set KMS_MASTER_KEY=new_key --app fxbot
```

### 2. Revoke all delegations
```typescript
// Invalidate all policy keys
await prisma.automationRule.updateMany({
  where: { status: "active" },
  data: { status: "paused" }
});
```

### 3. Force re-auth
- Invalidate all Telegram sessions
- Users must re-connect wallets via /start

### 4. Preserve evidence
- Export audit logs before any cleanup
- Screenshot Sentry events
- Document timeline

### 5. Notify users
- "Security incident detected. All automation paused. Please re-authenticate."
- Discord + Telegram broadcast

### 6. Post-incident
- Full security review
- Update threat model
- Report to f(x) Protocol if protocol contracts involved
