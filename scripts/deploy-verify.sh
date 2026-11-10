#!/usr/bin/env bash
# Post-deploy smoke test for EliteDev.
#
# Usage:
#   ./scripts/deploy-verify.sh https://app.elitedev.com.sa
#   BASE_URL=https://preview-xxx.vercel.app ./scripts/deploy-verify.sh
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks failed

set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
FAILURES=0

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAILURES=$((FAILURES + 1)); }
section() { echo ""; echo "── $1 ──"; }

section "1. Application alive"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/landing" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  pass "Landing page returns 200"
else
  fail "Landing page returned $STATUS (expected 200)"
fi

section "2. Security headers"
HEADERS=$(curl -s -I "$BASE_URL/landing" 2>/dev/null || echo "")

if echo "$HEADERS" | grep -qi "x-frame-options: DENY"; then
  pass "X-Frame-Options: DENY"
else
  fail "Missing X-Frame-Options: DENY"
fi

if echo "$HEADERS" | grep -qi "x-content-type-options: nosniff"; then
  pass "X-Content-Type-Options: nosniff"
else
  fail "Missing X-Content-Type-Options: nosniff"
fi

if echo "$HEADERS" | grep -qi "content-security-policy"; then
  pass "Content-Security-Policy present"
else
  fail "Missing Content-Security-Policy"
fi

section "3. Authentication boundary"
REDIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard" 2>/dev/null || echo "000")
if [ "$REDIRECT_STATUS" = "307" ] || [ "$REDIRECT_STATUS" = "302" ] || [ "$REDIRECT_STATUS" = "401" ]; then
  pass "Dashboard correctly redirects unauthenticated users ($REDIRECT_STATUS)"
else
  fail "Dashboard returned $REDIRECT_STATUS without auth (expected 307/302/401)"
fi

section "4. Health endpoint"
HEALTH=$(curl -s "$BASE_URL/api/health" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"status"'; then
  pass "Health endpoint returns JSON"
  HEALTH_STATUS=$(echo "$HEALTH" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$HEALTH_STATUS" = "healthy" ]; then
    pass "Health status: healthy"
  else
    fail "Health status: $HEALTH_STATUS"
  fi
else
  fail "Health endpoint did not return valid JSON"
fi

section "5. Static assets"
ASSET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/_next/static/" 2>/dev/null || echo "000")
if [ "$ASSET_STATUS" = "200" ] || [ "$ASSET_STATUS" = "404" ]; then
  pass "Static assets endpoint reachable ($ASSET_STATUS)"
else
  fail "Static assets returned unexpected status $ASSET_STATUS"
fi

section "6. Auth pages"
SIGNIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/auth/sign-in" 2>/dev/null || echo "000")
if [ "$SIGNIN_STATUS" = "200" ]; then
  pass "Sign-in page loads (200)"
else
  fail "Sign-in page returned $SIGNIN_STATUS"
fi

section "7. Error pages"
FORBIDDEN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/auth/errors/forbidden" 2>/dev/null || echo "000")
if [ "$FORBIDDEN_STATUS" = "200" ] || [ "$FORBIDDEN_STATUS" = "404" ]; then
  pass "Error page reachable ($FORBIDDEN_STATUS)"
else
  fail "Error page returned unexpected status $FORBIDDEN_STATUS"
fi

section "8. No secrets leaked"
LANDING_BODY=$(curl -s "$BASE_URL/landing" 2>/dev/null || echo "")
if echo "$LANDING_BODY" | grep -qi "service_role\|SUPABASE_SERVICE_ROLE_KEY\|secret_key\|private_key"; then
  fail "Landing page may contain leaked secrets"
else
  pass "No secrets detected in landing page"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
if [ "$FAILURES" -eq 0 ]; then
  echo "  ✅ ALL CHECKS PASSED"
  echo "════════════════════════════════════════"
  exit 0
else
  echo "  ❌ $FAILURES CHECK(S) FAILED"
  echo "════════════════════════════════════════"
  exit 1
fi
