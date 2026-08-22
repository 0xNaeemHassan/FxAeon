# 📡 FxAeon API & Integration Reference

This document provides the complete API reference for the FxAeon backend service, authenticated Telegram WebApp endpoints, and real-time WebSocket feeds.

---

## 1. Authentication: Telegram WebApp `initData` Verification

All `/api/v1/miniapp/*` endpoints require authentication via the `X-Telegram-Init-Data` HTTP header containing the raw query string provided by the Telegram WebApp client.

### Verification Algorithm:
1. Parse query string into key-value pairs and extract the `hash` parameter.
2. Sort remaining keys alphabetically into `key=value` lines separated by `\n` (`dataCheckString`).
3. Compute `secretKey = HMAC-SHA256("WebAppData", botToken)`.
4. Verify `HMAC-SHA256(secretKey, dataCheckString) === hash`.
5. Check `auth_date` is not older than 86,400 seconds (24 hours) to prevent replay attacks.

---

## 2. Mini App REST Endpoints (`/api/v1/miniapp`)

### `GET /api/v1/miniapp/me`
Retrieves authenticated user profile, linked wallet address, delegation status, and preferences.

* **Headers**: `X-Telegram-Init-Data: query_id=...`
* **Response (200 OK)**:
  ```json
  {
    "id": "usr_94a2f8",
    "telegramId": "123456789",
    "username": "anon_trader",
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "walletDelegated": true,
    "language": "en",
    "slippageBps": 50,
    "mevProtection": "on",
    "onboarded": true
  }
  ```

---

### `POST /api/v1/miniapp/settings`
Updates user configuration preferences (language, default slippage, MEV protection).

* **Headers**: `X-Telegram-Init-Data: ...`
* **Request Body**:
  ```json
  {
    "language": "zh-CN",
    "slippageBps": 100,
    "mevProtection": "on"
  }
  ```
* **Response (200 OK)**: `{ "ok": true }`

---

### `GET /api/v1/miniapp/portfolio`
Fetches on-chain aggregated positions, collateral values, and health ratios across Ethereum & Base.

* **Headers**: `X-Telegram-Init-Data: ...`
* **Response (200 OK)**:
  ```json
  {
    "totalCollateralUsd": "14250.00",
    "totalDebtUsd": "5200.00",
    "netWorthUsd": "9050.00",
    "healthFactor": "1.74",
    "positions": [
      {
        "market": "wstETH",
        "side": "long",
        "leverage": 5.0,
        "collateralAmount": "4.2",
        "collateralValueUsd": "14250.00",
        "debtAmount": "5200.00",
        "liquidationPriceUsd": "2850.00",
        "pnlUsd": "+1240.50",
        "pnlPct": "+68.4"
      }
    ]
  }
  ```

---

### `POST /api/v1/miniapp/execute`
Executes an on-chain trade, deposit, or rebalance action via the Session Signer Policy Engine.

* **Headers**: `X-Telegram-Init-Data: ...`
* **Request Body**:
  ```json
  {
    "action": "open_long",
    "market": "wstETH",
    "amount": "0.5",
    "leverage": 3.0,
    "slippageBps": 50
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "status": "submitted",
    "txHash": "0x98f...12c",
    "blockExplorerUrl": "https://etherscan.io/tx/0x98f...12c"
  }
  ```

---

## 3. Real-Time Price & Depth WebSockets

* **Endpoint**: `wss://api.fxaeon.app/ws/prices`
* **Subscription Message**:
  ```json
  { "type": "subscribe", "markets": ["wstETH/fxUSD", "WBTC/fxUSD"] }
  ```
* **Stream Payload**:
  ```json
  {
    "market": "wstETH/fxUSD",
    "price": "3520.45",
    "fundingRate8h": "0.00012",
    "pegSpreadPct": "-0.42",
    "timestamp": 1724281205000
  }
  ```
