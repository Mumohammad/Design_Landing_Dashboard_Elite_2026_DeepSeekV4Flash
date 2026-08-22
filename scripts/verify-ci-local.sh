#!/usr/bin/env bash
# ====================================================================
# verify-ci-local.sh — Simulate CI pipeline locally before pushing
#
# Usage:
#   ./scripts/verify-ci-local.sh
#
# This runs the same checks as the CI pipeline to catch issues early.
# ====================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[verify]${NC} $*"; }
pass() { echo -e "${GREEN}  ✅${NC} $*"; }
fail() { echo -e "${RED}  ❌${NC} $*"; exit 1; }
warn() { echo -e "${YELLOW}  ⚠️${NC} $*"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  EliteDev — Local CI Verification"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. Toolchain ──────────────────────────────────────────────
log "Checking toolchain..."
NODE_VER=$(node --version)
PNPM_VER=$(pnpm --version)
echo "  Node:  $NODE_VER"
echo "  pnpm:  $PNPM_VER"

if [[ "$PNPM_VER" != "10.27.0" ]]; then
  warn "pnpm version mismatch (expected 10.27.0, got $PNPM_VER)"
fi
pass "Toolchain verified"

# ── 2. Install dependencies ──────────────────────────────────
log "Installing dependencies..."
pnpm install --frozen-lockfile 2>&1 | tail -3
pass "Dependencies installed"

# ── 3. Lint ───────────────────────────────────────────────────
log "Running lint..."
if pnpm lint 2>&1 | tail -5; then
  pass "Lint passed"
else
  fail "Lint failed"
fi

# ── 4. Type check ─────────────────────────────────────────────
log "Running type check..."
if pnpm exec tsc --noEmit 2>&1 | tail -5; then
  pass "Type check passed"
else
  fail "Type check failed"
fi

# ── 5. Unit tests ─────────────────────────────────────────────
log "Running unit tests..."
if pnpm test 2>&1 | tail -5; then
  pass "Unit tests passed"
else
  fail "Unit tests failed"
fi

# ── 6. Build ──────────────────────────────────────────────────
log "Running production build..."
if pnpm build 2>&1 | tail -5; then
  pass "Build passed"
else
  fail "Build failed"
fi

# ── 7. Dependency audit ───────────────────────────────────────
log "Running dependency audit..."
AUDIT_OUTPUT=$(pnpm audit --audit-level=high 2>&1)
AUDIT_EXIT=$?
if [ $AUDIT_EXIT -eq 0 ]; then
  pass "Dependency audit passed (0 high/critical)"
else
  HIGH_COUNT=$(echo "$AUDIT_OUTPUT" | grep -c "high" || true)
  fail "Dependency audit failed ($HIGH_COUNT high findings)"
fi

# ── 8. Secret scan ────────────────────────────────────────────
log "Running secret scan..."
if grep -rn "SUPABASE_SERVICE_ROLE_KEY\|sk_live_\|sk_test_" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "test\|mock\|example\|process\.env\|\.env\.example" | head -5 | grep -q .; then
  fail "Potential secrets found in source code"
else
  pass "Secret scan passed"
fi

# ── 9. Smoke test (production build) ─────────────────────────
log "Running smoke test (production build)..."
PORT=3001 pnpm start > /tmp/elitedev-verify.log 2>&1 &
APP_PID=$!
trap 'kill "$APP_PID" 2>/dev/null || true' EXIT

for attempt in $(seq 1 20); do
  health="$(curl -fsS http://127.0.0.1:3001/api/health 2>/dev/null || true)"
  if [ -n "$health" ]; then
    break
  fi
  sleep 2
done

if [ -z "$health" ]; then
  fail "Smoke test failed — server did not start"
fi

if echo "$health" | grep -q '"status":"healthy"\|"status":"degraded"'; then
  pass "Smoke test passed (health: $(echo "$health" | grep -o '"status":"[^"]*"'))"
else
  fail "Smoke test failed — unexpected health response"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
pass "All CI checks passed — ready to push"
echo "═══════════════════════════════════════════════════════════"
echo ""
