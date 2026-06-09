# fxBot Monitoring Configuration

## Grafana Dashboard (JSON Model)

Save this as `grafana-dashboard.json` and import into Grafana:

```json
{
  "dashboard": {
    "title": "fxBot Monitoring",
    "tags": ["fxbot", "telegram", "defi"],
    "timezone": "utc",
    "panels": [
      {
        "title": "Bot Health",
        "type": "stat",
        "targets": [
          {
            "expr": "up{job="fxbot"}",
            "legendFormat": "Bot Status"
          }
        ],
        "thresholds": {
          "steps": [
            {"color": "red", "value": 0},
            {"color": "green", "value": 1}
          ]
        }
      },
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{job="fxbot"}[5m])",
            "legendFormat": "Requests/sec"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="fxbot"}[5m]))",
            "legendFormat": "p95 Latency"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{job="fxbot",status=~"5.."}[5m])",
            "legendFormat": "5xx Errors"
          }
        ]
      },
      {
        "title": "Active Users",
        "type": "stat",
        "targets": [
          {
            "expr": "fxbot_active_users_total",
            "legendFormat": "Active Users"
          }
        ]
      },
      {
        "title": "Transaction Volume",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(fxbot_transactions_total[1h])",
            "legendFormat": "Tx/hour"
          }
        ]
      }
    ]
  }
}
```

## UptimeRobot Monitors

Configure these monitors in UptimeRobot:

| Monitor | URL | Interval | Alert After |
|---|---|---|---|
| Bot Health | `https://your-bot-domain/api/v1/health` | 60s | 2 failures |
| Mini App | `https://your-mini-app.pages.dev` | 60s | 2 failures |
| Alchemy RPC | `https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY` | 300s | 3 failures |
| Supabase | `https://your-project.supabase.co/rest/v1/` | 300s | 3 failures |

## Sentry Alert Rules

Create these alert rules in Sentry:

1. **High Error Rate**
   - Condition: error rate > 1% for 5 minutes
   - Action: Slack notification + PagerDuty

2. **Bot Down**
   - Condition: no events for 10 minutes
   - Action: Email + Slack

3. **Transaction Failure**
   - Condition: `fxbot_transaction_failed` tag present
   - Action: Slack notification

## LogDNA / Datadog Log Alerts

```yaml
alerts:
  - name: "Bot Crash"
    query: "source:fxbot AND level:error AND message:*crash*"
    threshold: 1
    window: 5m
    
  - name: "High Latency"
    query: "source:fxbot AND duration:>5000"
    threshold: 10
    window: 5m
    
  - name: "Database Error"
    query: "source:fxbot AND message:*database* AND level:error"
    threshold: 5
    window: 10m
```

## Telegram Bot Health Notifications

Add to your bot to send health alerts to admin:

```typescript
// Send alert to admin chat on critical errors
async function sendHealthAlert(message: string) {
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
  if (ADMIN_CHAT_ID) {
    await bot.api.sendMessage(ADMIN_CHAT_ID, `🚨 fxBot Alert: ${message}`);
  }
}
```
