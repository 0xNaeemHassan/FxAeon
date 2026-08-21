#!/usr/bin/env bash
set -uo pipefail

# FxAeon deployment health verifier.
#
# Usage:
#   ./health-check.sh [BOT_BASE_URL]
#
# BOT_BASE_URL defaults to BOT_URL and then localhost. Optional external
# dependencies are checked only when their URL/credentials are supplied in the
# environment; this script contains no deployment-specific project endpoints.

BASE_URL="${1:-${BOT_URL:-http://localhost:8080}}"
BASE_URL="${BASE_URL%/}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

log_pass() {
    printf "%b[PASS]%b %s\n" "$GREEN" "$NC" "$1"
    PASS=$((PASS + 1))
}

log_fail() {
    printf "%b[FAIL]%b %s\n" "$RED" "$NC" "$1"
    FAIL=$((FAIL + 1))
}

log_skip() {
    printf "%b[SKIP]%b %s\n" "$YELLOW" "$NC" "$1"
    SKIP=$((SKIP + 1))
}

log_info() {
    printf "%b[INFO]%b %s\n" "$BLUE" "$NC" "$1"
}

http_get() {
    local url="$1"
    : > "$RESPONSE_FILE"
    curl --silent --show-error --location \
        --connect-timeout 5 --max-time 15 \
        --output "$RESPONSE_FILE" --write-out "%{http_code}" \
        "$url" 2>/dev/null || true
}

if ! command -v curl >/dev/null 2>&1; then
    printf "curl is required to run this health check.\n" >&2
    exit 2
fi

printf "=== FxAeon Health Check ===\n"
printf "Base URL: %s\n" "$BASE_URL"
printf "Time: %s\n\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '%s\n' '--- Bot Process ---'
STATUS="$(http_get "$BASE_URL/health")"
if [ "$STATUS" = "200" ]; then
    log_pass "Process liveness endpoint responds (200)"
else
    log_fail "Process liveness endpoint failed (HTTP ${STATUS:-000})"
fi

STATUS="$(http_get "$BASE_URL/api/v1/info")"
if [ "$STATUS" = "200" ]; then
    log_pass "Build information endpoint responds (200)"
    log_info "$(tr -d '\r\n' < "$RESPONSE_FILE")"
else
    log_fail "Build information endpoint failed (HTTP ${STATUS:-000})"
fi

printf '\n%s\n' '--- Deep Readiness ---'
DEEP_STATUS="$(http_get "$BASE_URL/api/v1/health")"
DEEP_BODY="$(tr -d '\r\n' < "$RESPONSE_FILE")"
if [ "$DEEP_STATUS" = "200" ]; then
    log_pass "Deep health endpoint responds (200)"
else
    log_fail "Deep health endpoint failed (HTTP ${DEEP_STATUS:-000})"
fi
log_info "${DEEP_BODY:-no response body}"

if printf '%s' "$DEEP_BODY" | grep -Eq '"database"[[:space:]]*:[[:space:]]*"healthy"'; then
    log_pass "Database reports healthy"
else
    log_fail "Database is not healthy in the deep-health response"
fi

if printf '%s' "$DEEP_BODY" | grep -Eq '"redis"[[:space:]]*:[[:space:]]*"healthy"'; then
    log_pass "Redis reports healthy"
elif printf '%s' "$DEEP_BODY" | grep -Eq '"redis"[[:space:]]*:[[:space:]]*"skipped"'; then
    log_skip "Redis is not configured on the bot"
else
    log_fail "Redis is not healthy in the deep-health response"
fi

if printf '%s' "$DEEP_BODY" | grep -Eq '"rpc"[[:space:]]*:[[:space:]]*"healthy"'; then
    log_pass "Ethereum RPC reports healthy"
elif [ -z "${ALCHEMY_RPC_URL:-}" ]; then
    log_skip "ALCHEMY_RPC_URL is not set; direct RPC verification skipped"
else
    log_fail "Ethereum RPC is not healthy in the deep-health response"
fi

if printf '%s' "$DEEP_BODY" | grep -Eq '"baseRpc"[[:space:]]*:[[:space:]]*"healthy"'; then
    log_pass "Base RPC reports healthy"
elif printf '%s' "$DEEP_BODY" | grep -Eq '"baseRpc"[[:space:]]*:[[:space:]]*"skipped"' && [ "${BRIDGE_EXECUTION_ENABLED:-false}" != "true" ]; then
    log_skip "Base RPC is not configured and bridge execution is disabled"
else
    log_fail "Base RPC is not healthy in the deep-health response"
fi

printf '\n%s\n' '--- Telegram Webhook ---'
TELEGRAM_TOKEN_VALUE="${TELEGRAM_BOT_TOKEN:-${TELEGRAM_TOKEN:-}}"
if [ -z "$TELEGRAM_TOKEN_VALUE" ]; then
    log_skip "TELEGRAM_BOT_TOKEN is not set"
else
    TELEGRAM_API_BASE_URL="${TELEGRAM_API_BASE_URL:-https://api.telegram.org}"
    STATUS="$(http_get "${TELEGRAM_API_BASE_URL%/}/bot${TELEGRAM_TOKEN_VALUE}/getWebhookInfo")"
    WEBHOOK_BODY="$(tr -d '\r\n' < "$RESPONSE_FILE")"
    if [ "$STATUS" = "200" ] && printf '%s' "$WEBHOOK_BODY" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
        if printf '%s' "$WEBHOOK_BODY" | grep -Eq '"url"[[:space:]]*:[[:space:]]*"https?://[^"[:space:]]+/webhook"'; then
            log_pass "Telegram reports the exact /webhook endpoint configured"
        else
            log_fail "Telegram webhook is empty or does not end in /webhook"
        fi
    else
        log_fail "Telegram webhook query failed (HTTP ${STATUS:-000})"
    fi
fi

printf '\n%s\n' '--- Direct Ethereum RPC ---'
if [ -z "${ALCHEMY_RPC_URL:-}" ]; then
    log_skip "ALCHEMY_RPC_URL is not set"
else
    RPC_STATUS="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
        --request POST --header 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        --output "$RESPONSE_FILE" --write-out '%{http_code}' \
        "$ALCHEMY_RPC_URL" 2>/dev/null || true)"
    RPC_BODY="$(tr -d '\r\n' < "$RESPONSE_FILE")"
    if [ "$RPC_STATUS" = "200" ] && printf '%s' "$RPC_BODY" | grep -Eqi '"result"[[:space:]]*:[[:space:]]*"0x0*1"'; then
        log_pass "Configured Ethereum RPC responds on chain 1"
    else
        log_fail "Configured Ethereum RPC did not identify chain 1 (HTTP ${RPC_STATUS:-000})"
    fi
fi

printf '\n%s\n' '--- Direct Base RPC ---'
if [ -z "${BASE_RPC_URL:-}" ]; then
    if [ "${BRIDGE_EXECUTION_ENABLED:-false}" = "true" ]; then
        log_fail "BASE_RPC_URL is required while bridge execution is enabled"
    else
        log_skip "BASE_RPC_URL is not set and bridge execution is disabled"
    fi
else
    BASE_RPC_STATUS="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
        --request POST --header 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        --output "$RESPONSE_FILE" --write-out '%{http_code}' \
        "$BASE_RPC_URL" 2>/dev/null || true)"
    BASE_RPC_BODY="$(tr -d '\r\n' < "$RESPONSE_FILE")"
    if [ "$BASE_RPC_STATUS" = "200" ] && printf '%s' "$BASE_RPC_BODY" | grep -Eqi '"result"[[:space:]]*:[[:space:]]*"0x0*2105"'; then
        log_pass "Configured Base RPC responds on chain 8453"
    else
        log_fail "Configured Base RPC did not identify chain 8453 (HTTP ${BASE_RPC_STATUS:-000})"
    fi
fi

printf '\n%s\n' '--- Redis Transport ---'
if [ -n "${REDIS_URL:-}" ]; then
    case "$REDIS_URL" in
        redis://*|rediss://*)
            if command -v redis-cli >/dev/null 2>&1; then
                REDIS_REPLY="$(redis-cli --no-auth-warning -u "$REDIS_URL" ping 2>/dev/null || true)"
                if [ "$REDIS_REPLY" = "PONG" ]; then
                    log_pass "Redis TCP endpoint responds to PING"
                else
                    log_fail "Redis TCP endpoint did not respond to PING"
                fi
            else
                log_skip "redis-cli is unavailable; deep-health result is authoritative"
            fi
            ;;
        http://*|https://*)
            log_fail "REDIS_URL must use redis:// or rediss://, not an HTTP REST URL"
            ;;
        *)
            log_fail "REDIS_URL has an unsupported scheme"
            ;;
    esac
elif [ -n "${UPSTASH_REDIS_REST_URL:-}" ] && [ -n "${UPSTASH_REDIS_REST_TOKEN:-}" ]; then
    # A REST endpoint is queried only through its explicitly named REST vars.
    STATUS="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
        --header "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
        --output "$RESPONSE_FILE" --write-out '%{http_code}' \
        "${UPSTASH_REDIS_REST_URL%/}/ping" 2>/dev/null || true)"
    if [ "$STATUS" = "200" ]; then
        log_pass "Configured Redis REST endpoint responds"
    else
        log_fail "Configured Redis REST endpoint failed (HTTP ${STATUS:-000})"
    fi
else
    log_skip "No Redis transport variables are set"
fi

printf '\n%s\n' '--- Optional Public Surfaces ---'
if [ -n "${MINI_APP_URL:-}" ]; then
    STATUS="$(http_get "${MINI_APP_URL%/}")"
    case "$STATUS" in
        200|204|301|302|303|307|308) log_pass "Configured Mini App URL responds (HTTP $STATUS)" ;;
        *) log_fail "Configured Mini App URL failed (HTTP ${STATUS:-000})" ;;
    esac
else
    log_skip "MINI_APP_URL is not set"
fi

if [ -n "${PRIVY_JWKS_URL:-}" ]; then
    STATUS="$(http_get "$PRIVY_JWKS_URL")"
    if [ "$STATUS" = "200" ]; then
        log_pass "Configured Privy JWKS URL responds (200)"
    else
        log_fail "Configured Privy JWKS URL failed (HTTP ${STATUS:-000})"
    fi
else
    log_skip "PRIVY_JWKS_URL is not set"
fi

printf '\n========================================\n'
printf "%bPassed: %d%b\n" "$GREEN" "$PASS" "$NC"
printf "%bFailed: %d%b\n" "$RED" "$FAIL" "$NC"
printf "%bSkipped: %d%b\n" "$YELLOW" "$SKIP" "$NC"
printf '========================================\n'

if [ "$FAIL" -eq 0 ]; then
    printf "%bAll configured checks passed.%b\n" "$GREEN" "$NC"
    exit 0
fi

printf "%bOne or more configured checks failed.%b\n" "$RED" "$NC"
exit 1
