# Runbook: Alchemy Rate Limited

## Detection
- Sentry: `429 Too Many Requests` from Alchemy
- RPC calls failing with rate limit errors

## Response

### 1. Switch to fallback RPC
```typescript
const FALLBACK_RPCS = [
  process.env.ALCHEMY_RPC_URL,
  "https://rpc.ankr.com/eth",
  "https://ethereum.publicnode.com",
];
// Rotate through fallbacks
```

### 2. Reduce polling frequency
- Limit order polling: 30s → 60s
- Health monitor: 5min → 10min
- Price cache: 30s → 120s

### 3. Notify users
- "Data updates may be slower due to network conditions"

### 4. Monitor usage
- Check Alchemy dashboard for CU consumption
- If approaching 30M CU/month, upgrade or optimize
