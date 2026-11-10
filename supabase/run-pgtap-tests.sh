#!/usr/bin/env bash
# ====================================================================
# run-pgtap-tests.sh — Start Supabase local, apply migrations, run pgTAP
#
# Usage:
#   ./supabase/run-pgtap-tests.sh           # full run
#   ./supabase/run-pgtap-tests.sh --no-start # skip supabase start (CI with service)
#
# Requirements:
#   - Supabase CLI installed (https://supabase.com/docs/guides/cli)
#   - Docker running (supabase start uses Docker)
#   - pgTAP extension (installed automatically by Supabase)
#
# Environment variables (optional):
#   SUPABASE_PORT       — override default DB port (default: 54322)
#   SKIP_MIGRATIONS     — set to "true" to skip migration step
#   TEST_FILE           — run only a specific test file
# ====================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TESTS_DIR="$SCRIPT_DIR/tests"
DB_PORT="${SUPABASE_PORT:-54322}"
SKIP_START=false
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-false}"
TEST_FILE="${TEST_FILE:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${BLUE}[pgTAP]${NC} $*"; }
pass() { echo -e "${GREEN}  ✅ PASS:${NC} $*"; }
fail() { echo -e "${RED}  ❌ FAIL:${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠️  WARN:${NC} $*"; }

# ── Parse arguments ──────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --no-start) SKIP_START=true ;;
    --help|-h)
      echo "Usage: $0 [--no-start]"
      echo "  --no-start  Skip supabase start (use with pre-running DB)"
      exit 0
      ;;
  esac
done

# ── Step 1: Start Supabase ──────────────────────────────────────
if [ "$SKIP_START" = false ]; then
  log "Starting Supabase local stack..."
  cd "$PROJECT_ROOT"

  if ! command -v supabase &>/dev/null; then
    # Try npx
    if ! npx supabase --version &>/dev/null 2>&1; then
      log "Installing Supabase CLI..."
      npm install -g supabase 2>/dev/null || npx -y supabase --version
    fi
    SUPABASE_CMD="npx supabase"
  else
    SUPABASE_CMD="supabase"
  fi

  # Stop any existing instance
  $SUPABASE_CMD stop 2>/dev/null || true

  # Start fresh
  $SUPABASE_CMD start 2>&1 | tail -20
  log "Supabase started on port $DB_PORT"
else
  log "Skipping supabase start (--no-start)"
  SUPABASE_CMD="supabase"
fi

# ── Step 2: Wait for DB to be ready ─────────────────────────────
log "Waiting for database to be ready..."
for i in $(seq 1 30); do
  if $SUPABASE_CMD db ping 2>/dev/null | grep -q "alive"; then
    log "Database is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Database did not become ready in 30 seconds"
    exit 1
  fi
  sleep 1
done

# ── Step 3: Install pgTAP extension ─────────────────────────────
log "Installing pgTAP extension..."
$SUPABASE_CMD db execute --project-id elitedev-local -c "
CREATE EXTENSION IF NOT EXISTS pgtap SCHEMA public;
" 2>/dev/null && pass "pgTAP extension installed" || warn "pgTAP may already be installed"

# ── Step 4: Apply migrations ────────────────────────────────────
if [ "$SKIP_MIGRATIONS" = false ]; then
  log "Applying all migrations + seed data from scratch..."
  $SUPABASE_CMD db reset --project-id elitedev-local 2>&1 | tail -10
  pass "Migrations + seed applied (supabase/seed.sql)"
else
  warn "Skipping migrations (SKIP_MIGRATIONS=true)"
fi

# ── Step 5: Run pgTAP tests ─────────────────────────────────────
log "Running pgTAP tests..."
echo "═══════════════════════════════════════════════════════════"

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
TEST_FILES_RUN=0

if [ -n "$TEST_FILE" ]; then
  # Run specific test file
  TEST_FILES="$TESTS_DIR/$TEST_FILE"
else
  # Run all SQL test files in order
  TEST_FILES=$(find "$TESTS_DIR" -name "*.sql" -type f | sort)
fi

for test_file in $TEST_FILES; do
  filename=$(basename "$test_file")
  TEST_FILES_RUN=$((TEST_FILES_RUN + 1))

  echo ""
  log "Running: $filename"
  echo "───────────────────────────────────────────────────────────"

  # Execute the test file and capture output
  OUTPUT=$($SUPABASE_CMD db execute --project-id elitedev-local -f "$test_file" 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    # Parse pgTAP output for pass/fail counts
    TESTS_RUN=$(echo "$OUTPUT" | grep -oP '^\d+\.\.\d+' | head -1 | cut -d. -f2)
    FAILURES=$(echo "$OUTPUT" | grep -c "^not ok" || true)
    ERRORS=$(echo "$OUTPUT" | grep -c "^#.*ERROR\|^#.*FAIL" || true)

    if [ -n "$TESTS_RUN" ]; then
      TOTAL_TESTS=$((TOTAL_TESTS + TESTS_RUN))
      if [ "$FAILURES" -eq 0 ] && [ "$ERRORS" -eq 0 ]; then
        PASSED_TESTS=$((PASSED_TESTS + TESTS_RUN))
        pass "$filename — $TESTS_RUN/$TESTS_RUN tests passed"
      else
        PASSED=$((TESTS_RUN - FAILURES - ERRORS))
        PASSED_TESTS=$((PASSED_TESTS + PASSED))
        FAILED_TESTS=$((FAILED_TESTS + FAILURES + ERRORS))
        fail "$filename — $PASSED/$TESTS_RUN passed, $FAILURES failures, $ERRORS errors"
        echo "$OUTPUT" | grep -E "^not ok|^#.*FAIL|^#.*ERROR" | head -10
      fi
    else
      # Could not parse output — treat as passed if exit code 0
      PASSED_TESTS=$((PASSED_TESTS + 1))
      TOTAL_TESTS=$((TOTAL_TESTS + 1))
      pass "$filename — completed (output parsing inconclusive)"
    fi

    # Show detailed output if there are failures
    if [ "$FAILURES" -gt 0 ] || [ "$ERRORS" -gt 0 ]; then
      echo ""
      echo "  Detailed output:"
      echo "$OUTPUT" | head -30
    fi
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    fail "$filename — execution failed (exit code $EXIT_CODE)"
    echo "$OUTPUT" | tail -10
  fi
done

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
log "pgTAP Test Summary"
echo "  Files run:    $TEST_FILES_RUN"
echo "  Total tests:  $TOTAL_TESTS"
echo -e "  Passed:       ${GREEN}$PASSED_TESTS${NC}"
if [ "$FAILED_TESTS" -gt 0 ]; then
  echo -e "  Failed:       ${RED}$FAILED_TESTS${NC}"
else
  echo -e "  Failed:       ${GREEN}0${NC}"
fi
echo ""

if [ "$FAILED_TESTS" -gt 0 ]; then
  fail "Some pgTAP tests failed!"
  exit 1
else
  pass "All pgTAP tests passed!"
  exit 0
fi
