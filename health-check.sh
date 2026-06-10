#!/bin/bash
set -e

# fxBot Health Check Verification Script
# Usage: ./health-check.sh [BASE_URL]
#   BASE_URL: defaults to http://localhost:8080

BASE_URL="${1:-http://localhost:8080}"
TELEGRAM_TOKEN="${TELEGRAM_TOKEN:?TELEGRAM_TOKEN env var is required}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASS++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAIL++))
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo "=== fxBot Health Check ==="
echo "Base URL: $BASE_URL"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# 1. Bot health endpoint
echo "--- Bot Health ---"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/health" 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
    HEALTH_BODY=$(curl -s "$BASE_URL/api/v1/health" 2>/dev/null)
    log_pass "Health endpoint responds (200)"
    log_info "Response: $HEALTH_BODY"
else
    log_fail "Health endpoint failed (HTTP $HEALTH)"
fi

# 2. Bot info endpoint
echo ""
echo "--- Bot Info ---"
INFO=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/info" 2>/dev/null || echo "000")
if [ "$INFO" = "200" ]; then
    INFO_BODY=$(curl -s "$BASE_URL/api/v1/info" 2>/dev/null)
    log_pass "Info endpoint responds (200)"
    log_info "Response: $INFO_BODY"
else
    log_fail "Info endpoint failed (HTTP $INFO)"
fi

# 3. Webhook status (if Telegram token available)
echo ""
echo "--- Telegram Webhook ---"
if [ -n "$TELEGRAM_TOKEN" ]; then
    WEBHOOK_INFO=$(curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo" 2>/dev/null)
    if echo "$WEBHOOK_INFO" | grep -q '"ok":true'; then
        URL=$(echo "$WEBHOOK_INFO" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4)
        PENDING=$(echo "$WEBHOOK_INFO" | grep -o '"pending_update_count":[0-9]*' | cut -d':' -f2)
        log_pass "Telegram webhook is set"
        log_info "Webhook URL: $URL"
        log_info "Pending updates: $PENDING"
        
        if [ "$PENDING" -gt 100 ]; then
            log_warn "High pending update count ($PENDING) - bot may be slow"
        fi
    else
        log_fail "Telegram webhook not configured"
    fi
else
    log_warn "TELEGRAM_TOKEN not set, skipping webhook check"
fi

# 4. Database connectivity (via health endpoint)
echo ""
echo "--- Database ---"
if [ "$HEALTH" = "200" ]; then
    if echo "$HEALTH_BODY" | grep -qi "database\|db\|postgres"; then
        log_pass "Database status reported in health check"
    else
        log_warn "Database status not found in health response"
    fi
else
    log_fail "Cannot verify database - health endpoint down"
fi

# 5. Redis connectivity (via health endpoint)
echo ""
echo "--- Redis ---"
if [ "$HEALTH" = "200" ]; then
    if echo "$HEALTH_BODY" | grep -qi "redis\|cache"; then
        log_pass "Redis status reported in health check"
    else
        log_warn "Redis status not found in health response"
    fi
else
    log_fail "Cannot verify Redis - health endpoint down"
fi

# 6. RPC connectivity
echo ""
echo "--- Ethereum RPC ---"
RPC_STATUS=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "${ALCHEMY_RPC_URL:?ALCHEMY_RPC_URL env var is required}" 2>/dev/null | grep -o '"result":"0x[0-9a-f]*"' | head -1)

if [ -n "$RPC_STATUS" ]; then
    BLOCK_HEX=$(echo "$RPC_STATUS" | grep -o '0x[0-9a-f]*' | head -1)
    BLOCK_NUM=$(printf "%d" "$BLOCK_HEX" 2>/dev/null || echo "unknown")
    log_pass "Alchemy RPC responds (latest block: $BLOCK_NUM)"
else
    log_fail "Alchemy RPC not responding"
fi

# 7. Mini App (if URL configured)
echo ""
echo "--- Mini App ---"
MINI_APP_URL="${MINI_APP_URL:-https://fxbot-mini-app.pages.dev}"
MINI_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$MINI_APP_URL" 2>/dev/null || echo "000")
if [ "$MINI_STATUS" = "200" ] || [ "$MINI_STATUS" = "304" ]; then
    log_pass "Mini App responds (HTTP $MINI_STATUS)"
else
    log_fail "Mini App not responding (HTTP $MINI_STATUS)"
fi

# 8. Privy JWKS endpoint
echo ""
echo "--- Privy Auth ---"
PRIVY_JWKS=$(curl -s -o /dev/null -w "%{http_code}" "https://auth.privy.io/api/v1/apps/cmq6a73jc002k0cl5vgleejt2/jwks.json" 2>/dev/null || echo "000")
if [ "$PRIVY_JWKS" = "200" ]; then
    log_pass "Privy JWKS endpoint responds (200)"
else
    log_fail "Privy JWKS endpoint failed (HTTP $PRIVY_JWKS)"
fi

# 9. Supabase connectivity
echo ""
echo "--- Supabase ---"
SUPABASE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://gadzbgakqipnvkfozcfa.supabase.co/rest/v1/" \
    -H "apikey: test" 2>/dev/null || echo "000")
if [ "$SUPABASE_STATUS" = "200" ] || [ "$SUPABASE_STATUS" = "401" ]; then
    log_pass "Supabase API responds (HTTP $SUPABASE_STATUS)"
else
    log_fail "Supabase API not responding (HTTP $SUPABASE_STATUS)"
fi

# 10. Upstash Redis
echo ""
echo "--- Upstash Redis ---"
UPSTASH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "${REDIS_URL:?REDIS_URL env var is required}" \
    -H "Authorization: Bearer ${REDIS_TOKEN:?REDIS_TOKEN env var is required}" 2>/dev/null || echo "000")
if [ "$UPSTASH_STATUS" = "200" ] || [ "$UPSTASH_STATUS" = "401" ]; then
    log_pass "Upstash Redis responds (HTTP $UPSTASH_STATUS)"
else
    log_fail "Upstash Redis not responding (HTTP $UPSTASH_STATUS)"
fi

# Summary
echo ""
echo "========================================"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo "========================================"

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}All checks passed! System is healthy.${NC}"
    exit 0
else
    echo -e "${RED}Some checks failed. Review issues above.${NC}"
    exit 1
fi
