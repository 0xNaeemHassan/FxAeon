# fxBot API Documentation

## Base URL
```
https://api.fxbot.io/v1
```

## Authentication
All API requests require a valid API key passed in the `Authorization` header:
```
Authorization: Bearer <YOUR_API_KEY>
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `BOT_TOKEN` | Telegram bot token | Yes | - |
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `PRIVY_APP_ID` | Privy app ID | Yes | - |
| `PRIVY_APP_SECRET` | Privy app secret | Yes | - |
| `ETH_RPC_URL` | Ethereum RPC endpoint | Yes | - |
| `SENTRY_DSN` | Sentry error tracking | No | - |
| `RATE_LIMIT_MAX` | Max requests per window | No | 30 |
| `RATE_LIMIT_WINDOW` | Rate limit window (ms) | No | 60000 |
| `ALLOWED_ORIGINS` | CORS allowed origins | No | `https://t.me` |

## Endpoints

### Positions

#### GET /positions
List all positions for the authenticated user.

**Response:**
```json
{
  "positions": [],
  "total": 0
}
```

#### POST /positions
Open a new position.

**Request Body:**
```json
{
  "asset": "xETH",
  "size": 1.5,
  "leverage": 5,
  "side": "long"
}
```

**Response:**
```json
{
  "success": true,
  "positionId": "pos_1234567890",
  "asset": "xETH",
  "size": 1.5,
  "leverage": 5,
  "side": "long"
}
```

#### GET /positions/:id
Get position details.

#### DELETE /positions/:id
Close position (full or partial via `?partial=true` query).

### Gas

#### GET /gas/estimate
Estimate gas for a transaction.

**Query Parameters:**
- `txType`: `open`, `close`, `adjust`, `leverage`
- `asset`: Asset symbol
- `size`: Position size

#### GET /gas/prices
Current gas price tiers.

### TWAP

#### POST /twap
Create a TWAP (Time-Weighted Average Price) order.

**Request Body:**
```json
{
  "asset": "xETH",
  "totalSize": 10,
  "intervals": 4,
  "intervalMinutes": 15,
  "side": "buy"
}
```

#### GET /twap/:id
Get TWAP execution status.

#### DELETE /twap/:id
Cancel TWAP order.

### Batch

#### POST /batch
Execute multiple transactions atomically.

**Request Body:**
```json
{
  "transactions": [
    { "type": "open", "asset": "xETH", "params": { "size": 1, "leverage": 3 } },
    { "type": "close", "asset": "xUSD", "params": { "positionId": "pos_123" } }
  ]
}
```

### Health

#### GET /health
System health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-06-09T00:00:00.000Z",
  "version": "1.1.0",
  "uptime": 3600,
  "services": {
    "telegram": "connected",
    "database": "connected",
    "blockchain": "connected"
  }
}
```

## Error Responses

All errors follow this format:
```json
{
  "error": "Error description",
  "code": "ERROR_CODE",
  "details": {}
}
```

| Status Code | Meaning |
|-------------|---------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid API key |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |

## Rate Limiting

API requests are limited to 30 requests per minute per API key. 
Exceeding this limit returns a 429 status code with a `Retry-After` header.

## Deployment

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Ethereum RPC access

### Steps
1. Clone repository
2. Install dependencies: `pnpm install`
3. Set environment variables (see table above)
4. Run database migrations: `pnpm db:migrate`
5. Build: `pnpm build`
6. Start: `pnpm start`

### Docker Deployment
```bash
docker build -t fxbot:latest .
docker run -p 3000:3000 --env-file .env fxbot:latest
```

### Fly.io Deployment
```bash
fly deploy --config apps/bot/fly.toml
```
