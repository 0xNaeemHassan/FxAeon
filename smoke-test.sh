#!/bin/bash
set -e

# fxBot Post-Deployment Smoke Test
# Usage: ./smoke-test.sh [BASE_URL]

BASE_URL="${1:-${BOT_URL:-http://localhost:8080}}"
TELEGRAM_TOKEN="${TELEGRAM_TOKEN:?TELEGRAM_TOKEN env var is required}"
MINI_APP_URL="${MINI_APP_URL:-https://fxbot-mini-app.pages.dev}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

log_pass() { echo -e "${GREEN}  [PASS]${NC} $1"; ((PASS++)); }
log_fail() { echo -e "${RED}  [FAIL]${NC} $1"; ((FAIL++)); }
log_skip() { echo -e "${YELLOW}  [SKIP]${NC} $1"; ((SKIP++)); }
log_info() { echo -e "${BLUE}  [INFO]${NC} $1"; }
log_step() { echo -e "\n${CYAN}▶${NC} $1"; }

# Header
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           fxBot Post-Deployment Smoke Test                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "Base URL: $BASE_URL"
echo "Mini App: $MINI_APP_URL"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Step 1: Infrastructure
log_step "Step 1: Infrastructure Health"

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/health" 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
    log_pass "Health endpoint returns 200"
    HEALTH_BODY=$(curl -s "$BASE_URL/api/v1/health" 2>/dev/null)
    log_info "Response: ${HEALTH_BODY:0:100}"
else
    log_fail "Health endpoint returned $HEALTH"
fi

INFO=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/info" 2>/dev/null || echo "000")
if [ "$INFO" = "200" ]; then
    log_pass "Info endpoint returns 200"
else
    log_fail "Info endpoint returned $INFO"
fi

# Step 2: Telegram Bot
log_step "Step 2: Telegram Bot API"

BOT_INFO=$(curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe" 2>/dev/null)
if echo "$BOT_INFO" | grep -q '"ok":true'; then
    BOT_NAME=$(echo "$BOT_INFO" | grep -o '"username":"[^"]*"' | head -1 | cut -d'"' -f4)
    log_pass "Bot identity confirmed: @$BOT_NAME"
else
    log_fail "Bot API check failed"
fi

WEBHOOK=$(curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo" 2>/dev/null)
if echo "$WEBHOOK" | grep -q '"ok":true'; then
    URL=$(echo "$WEBHOOK" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4)
    PENDING=$(echo "$WEBHOOK" | grep -o '"pending_update_count":[0-9]*' | cut -d':' -f2)
    if [ -n "$URL" ]; then
        log_pass "Webhook set: $URL"
        if [ "$PENDING" -gt 50 ]; then
            log_fail "High pending updates: $PENDING"
        else
            log_pass "Pending updates: $PENDING"
        fi
    else
        log_fail "Webhook NOT set"
    fi
else
    log_fail "Webhook check failed"
fi

# Step 3: External Services
log_step "Step 3: External Services"

ALCHEMY=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "${ALCHEMY_RPC_URL:?ALCHEMY_RPC_URL env var is required}" 2>/dev/null || echo "000")
if [ "$ALCHEMY" = "200" ] || [ "$ALCHEMY" = "400" ]; then
    log_pass "Alchemy RPC reachable"
else
    log_fail "Alchemy RPC status: $ALCHEMY"
fi

PRIVY=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://auth.privy.io/api/v1/apps/cmq6a73jc002k0cl5vgleejt2/jwks.json" 2>/dev/null || echo "000")
if [ "$PRIVY" = "200" ]; then
    log_pass "Privy JWKS reachable"
else
    log_fail "Privy JWKS status: $PRIVY"
fi

SUPABASE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: test" \
    "https://gadzbgakqipnvkfozcfa.supabase.co/rest/v1/" 2>/dev/null || echo "000")
if [ "$SUPABASE" = "200" ] || [ "$SUPABASE" = "401" ]; then
    log_pass "Supabase API reachable"
else
    log_fail "Supabase status: $SUPABASE"
fi

UPSTASH=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${REDIS_TOKEN:?REDIS_TOKEN env var is required}" \
    "https://allowed-honeybee-114181.upstash.io" 2>/dev/null || echo "000")
if [ "$UPSTASH" = "200" ] || [ "$UPSTASH" = "401" ]; then
    log_pass "Upstash Redis reachable"
else
    log_fail "Upstash status: $UPSTASH"
fi

# Step 4: Mini App
log_step "Step 4: Mini App"

MINI=$(curl -s -o /dev/null -w "%{http_code}" "$MINI_APP_URL" 2>/dev/null || echo "000")
if [ "$MINI" = "200" ] || [ "$MINI" = "304" ]; then
    log_pass "Mini App responds (HTTP $MINI)"
else
    log_fail "Mini App status: $MINI"
fi

# Step 5: Bot Commands
log_step "Step 5: Bot Commands"

COMMANDS=$(curl -s "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMyCommands" 2>/dev/null)
if echo "$COMMANDS" | grep -q '"ok":true'; then
    COUNT=$(echo "$COMMANDS" | grep -o '"command":"[^"]*"' | wc -l)
    log_pass "$COUNT bot commands registered"
    for cmd in start help portfolio deposit settings security; do
        if echo "$COMMANDS" | grep -q "\"command\":\"$cmd\""; then
            log_pass "Command /$cmd registered"
        else
            log_fail "Command /$cmd NOT registered"
        fi
    done
else
    log_fail "Could not retrieve bot commands"
fi

# Summary
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                      TEST SUMMARY                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  ${GREEN}%-58s${NC} ║\n" "Passed: $PASS"
printf "║  ${RED}%-58s${NC} ║\n" "Failed: $FAIL"
printf "║  ${YELLOW}%-58s${NC} ║\n" "Skipped: $SKIP"
echo "╚══════════════════════════════════════════════════════════════╝"

if [ $FAIL -eq 0 ]; then
    echo -e "\n${GREEN}✓ All smoke tests passed! Deployment is healthy.\n${NC}"
    exit 0
elif [ $FAIL -le 2 ]; then
    echo -e "\n${YELLOW}⚠ Some non-critical tests failed. Review above.\n${NC}"
    exit 0
else
    echo -e "\n${RED}✗ Multiple critical tests failed. Deployment needs attention.\n${NC}"
    exit 1
fi
