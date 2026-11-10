#!/usr/bin/env bash
# ====================================================================
# setup-test-db.sh — Local development: set up Supabase + run pgTAP
#
# Usage:
#   ./scripts/setup-test-db.sh           # full setup + run tests
#   ./scripts/setup-test-db.sh --setup   # setup only, no tests
#   ./scripts/setup-test-db.sh --tests   # tests only (DB must be running)
#
# This script:
#   1. Installs Supabase CLI if needed
#   2. Starts local Supabase (Postgres + Auth + Storage)
#   3. Applies all 60 migrations
#   4. Installs pgTAP extension
#   5. Seeds test fixture data
#   6. Runs all pgTAP tests
# ====================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[setup]${NC} $*"; }
pass() { echo -e "${GREEN}  ✅${NC} $*"; }
fail() { echo -e "${RED}  ❌${NC} $*"; exit 1; }
warn() { echo -e "${YELLOW}  ⚠️${NC} $*"; }

DO_SETUP=true
DO_TESTS=true

for arg in "$@"; do
  case $arg in
    --setup) DO_TESTS=false ;;
    --tests) DO_SETUP=false ;;
    --help|-h)
      echo "Usage: $0 [--setup|--tests]"
      echo "  --setup   Setup only (no test execution)"
      echo "  --tests   Tests only (DB must already be running)"
      exit 0
      ;;
  esac
done

cd "$PROJECT_ROOT"

# ── Step 1: Install Supabase CLI ─────────────────────────────────
if ! command -v supabase &>/dev/null; then
  log "Installing Supabase CLI..."
  npm install -g supabase 2>&1 | tail -5
  pass "Supabase CLI installed"
else
  pass "Supabase CLI already installed ($(supabase --version 2>&1 | head -1))"
fi

# ── Step 2: Start Supabase ──────────────────────────────────────
if [ "$DO_SETUP" = true ]; then
  log "Stopping any existing Supabase instance..."
  supabase stop 2>/dev/null || true

  log "Starting Supabase local stack..."
  supabase start 2>&1 | tail -20
  pass "Supabase started"

  # Wait for DB
  log "Waiting for database..."
  for i in $(seq 1 30); do
    if supabase db ping 2>/dev/null | grep -q "alive"; then
      pass "Database ready"
      break
    fi
    [ "$i" -eq 30 ] && fail "Database did not start"
    sleep 1
  done

  # Install pgTAP
  log "Installing pgTAP extension..."
  supabase db execute -c "CREATE EXTENSION IF NOT EXISTS pgtap;" 2>&1
  pass "pgTAP installed"

  # Apply migrations
  log "Applying all 60 migrations..."
  supabase db reset 2>&1 | tail -10
  pass "Migrations applied"
fi

# ── Step 3: Run pgTAP tests ─────────────────────────────────────
if [ "$DO_TESTS" = true ]; then
  log "Running pgTAP tests..."
  echo ""

  # Use the dedicated test runner
  bash "$SCRIPT_DIR/../supabase/run-pgtap-tests.sh" --no-start
fi

# ── Done ─────────────────────────────────────────────────────────
echo ""
pass "Setup complete!"
echo ""
echo "  Supabase Studio:  http://localhost:54323"
echo "  API:              http://localhost:54321"
echo "  DB:               postgresql://postgres:postgres@localhost:54322/postgres"
echo ""
echo "  To re-run tests:  ./scripts/setup-test-db.sh --tests"
echo "  To reset DB:      supabase db reset"
echo "  To stop:          supabase stop"
