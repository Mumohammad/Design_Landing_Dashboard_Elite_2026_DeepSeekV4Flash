#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EliteDev Staging Supabase Setup
#
# Creates and configures a staging Supabase project for preview deployments.
# This script must be run manually by a human operator — it requires
# browser-based Supabase project creation.
#
# Prerequisites:
#   - Supabase CLI installed (run `pnpm loadtest:setup` or install manually)
#   - Docker Desktop running (for local Supabase)
#   - Logged into Supabase CLI (`supabase login`)
#
# Usage:
#   bash scripts/setup-staging.sh              # Interactive setup
#   bash scripts/setup-staging.sh --local-only # Local Supabase only (no cloud)
#   bash scripts/setup-staging.sh --apply      # Apply migrations to existing project
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Parse args ────────────────────────────────────────────────────────────────
LOCAL_ONLY=false
APPLY_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --local-only) LOCAL_ONLY=true ;;
    --apply) APPLY_ONLY=true ;;
    --help)
      echo "Usage: $0 [--local-only] [--apply]"
      echo ""
      echo "  --local-only   Start local Supabase only (no cloud project)"
      echo "  --apply        Apply migrations to an existing linked project"
      exit 0
      ;;
  esac
done

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}  EliteDev Staging Supabase Setup${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── Check prerequisites ──────────────────────────────────────────────────────
echo -e "${BOLD}Checking prerequisites...${RESET}"

if ! command -v supabase &>/dev/null; then
  echo -e "${YELLOW}Installing Supabase CLI...${RESET}"
  npm install -g supabase 2>/dev/null || {
    echo -e "${RED}Failed to install Supabase CLI. Install manually:${RESET}"
    echo "  https://supabase.com/docs/guides/cli"
    exit 1
  }
fi
echo -e "${GREEN}  ✓ Supabase CLI: $(supabase --version)${RESET}"

if ! command -v docker &>/dev/null; then
  echo -e "${YELLOW}⚠️  Docker not found. Local Supabase requires Docker Desktop.${RESET}"
  echo "  Install: https://docs.docker.com/get-docker/"
  if [ "$LOCAL_ONLY" = true ]; then
    exit 1
  fi
else
  echo -e "${GREEN}  ✓ Docker: $(docker --version 2>/dev/null || echo 'available')${RESET}"
fi

# ── Local Supabase ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Local Supabase:${RESET}"

if [ "$APPLY_ONLY" = true ]; then
  echo -e "${YELLOW}  Skipping local setup (--apply mode)${RESET}"
else
  echo -e "${CYAN}  Starting local Supabase stack...${RESET}"
  supabase start 2>&1 | tail -20
  echo ""

  # Wait for database
  echo -e "${CYAN}  Waiting for database...${RESET}"
  for i in $(seq 1 30); do
    if supabase db ping 2>/dev/null | grep -q "alive"; then
      echo -e "${GREEN}  ✓ Local database ready${RESET}"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo -e "${RED}  ✗ Database did not start${RESET}"
      exit 1
    fi
    sleep 1
  done

  # Apply migrations
  echo -e "${CYAN}  Applying migrations...${RESET}"
  supabase db reset 2>&1 | tail -15
  echo -e "${GREEN}  ✓ All migrations + seed applied${RESET}"

  # Print local credentials
  echo ""
  echo -e "${BOLD}  Local credentials:${RESET}"
  echo -e "  ${CYAN}URL:           ${RESET}http://localhost:54321"
  echo -e "  ${CYAN}Anon Key:      ${RESET}(see supabase status output above)"
  echo -e "  ${CYAN}Service Role:  ${RESET}(see supabase status output above)"
  echo -e "  ${CYAN}DB Password:   ${RESET}postgres"
fi

if [ "$LOCAL_ONLY" = true ]; then
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${GREEN}  Local Supabase ready!${RESET}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo -e "  Start dev server:  ${CYAN}pnpm dev${RESET}"
  echo -e "  Run pgTAP tests:   ${CYAN}./supabase/run-pgtap-tests.sh --no-start${RESET}"
  echo ""
  exit 0
fi

# ── Cloud Staging Project ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Cloud Staging Project:${RESET}"
echo ""
echo -e "${YELLOW}  Manual steps required:${RESET}"
echo ""
echo -e "  1. Go to ${CYAN}https://supabase.com/dashboard${RESET}"
echo -e "  2. Click ${BOLD}\"New Project\"${RESET}"
echo -e "  3. Settings:"
echo -e "     - Name:      ${CYAN}EliteDev Staging${RESET}"
echo -e "     - Region:    ${CYAN}Middle East (East)${RESET}"
echo -e "     - Plan:      ${CYAN}Free${RESET}"
echo -e "     - Password:  ${CYAN}(generate strong password)${RESET}"
echo -e "  4. Wait for project creation (~30s)"
echo -e "  5. Go to ${BOLD}Settings → API${RESET} and copy:"
echo -e "     - Project URL"
echo -e "     - Anon Key"
echo -e "     - Service Role Key"
echo ""
echo -e "  6. Link this project:${RESET}"
echo -e "     ${CYAN}supabase link --project-ref <your-project-ref>${RESET}"
echo ""
echo -e "  7. Apply migrations:${RESET}"
echo -e "     ${CYAN}supabase db push${RESET}"
echo ""
echo -e "  8. Seed data:${RESET}"
echo -e "     ${CYAN}supabase db seed${RESET}"
echo ""
echo -e "  9. Disable public signup (optional, recommended for staging):"
echo -e "     ${CYAN}Dashboard → Authentication → Settings → Disable Sign Up${RESET}"
echo ""
echo -e "  10. Create a test user:${RESET}"
echo -e "      ${CYAN}Dashboard → Authentication → Users → Add User${RESET}"
echo -e "      Email: admin@elitedev-test.com"
echo -e "      Password: Test1234!"
echo ""

# ── GitHub Secrets ────────────────────────────────────────────────────────────
echo -e "${BOLD}GitHub Repository Secrets:${RESET}"
echo ""
echo -e "  After creating the Supabase project, add these secrets:"
echo -e "  ${CYAN}GitHub → Settings → Secrets and variables → Actions → New repository secret${RESET}"
echo ""
echo -e "  ${BOLD}Required for preview deployments:${RESET}"
echo "  ┌──────────────────────────────────┬─────────────────────────────────────┐"
echo "  │ Secret Name                      │ Value                               │"
echo "  ├──────────────────────────────────┼─────────────────────────────────────┤"
echo "  │ STAGING_SUPABASE_URL             │ https://xxxxx.supabase.co           │"
echo "  │ STAGING_SUPABASE_ANON_KEY        │ eyJhbG... (anon key)                │"
echo "  │ STAGING_SUPABASE_SERVICE_KEY     │ eyJhbG... (service role key)        │"
echo "  │ STAGING_URL                      │ https://your-preview.vercel.app     │"
echo "  │ TEST_USER_EMAIL                  │ admin@elitedev-test.com             │"
echo "  │ TEST_USER_PASSWORD               │ Test1234!                           │"
echo "  └──────────────────────────────────┴─────────────────────────────────────┘"
echo ""
echo -e "  ${BOLD}Required for production:${RESET}"
echo "  ┌──────────────────────────────────┬─────────────────────────────────────┐"
echo "  │ Secret Name                      │ Value                               │"
echo "  ├──────────────────────────────────┼─────────────────────────────────────┤"
echo "  │ SUPABASE_SERVICE_ROLE_KEY        │ eyJhbG... (production service key)  │"
echo "  │ VERCEL_TOKEN                     │ (from Vercel dashboard)             │"
echo "  │ VERCEL_ORG_ID                    │ (from Vercel project settings)      │"
echo "  │ VERCEL_PROJECT_ID                │ (from Vercel project settings)      │"
echo "  └──────────────────────────────────┴─────────────────────────────────────┘"
echo ""

# ── Vercel Environment Variables ──────────────────────────────────────────────
echo -e "${BOLD}Vercel Environment Variables:${RESET}"
echo ""
echo -e "  Go to ${CYAN}Vercel → Settings → Environment Variables${RESET}"
echo -e "  Set these for the ${BOLD}Preview${RESET} environment:"
echo ""
echo "  NEXT_PUBLIC_SUPABASE_URL          → (staging Supabase URL)"
echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY     → (staging anon key)"
echo "  SUPABASE_SERVICE_ROLE_KEY         → (staging service role key)"
echo "  NEXT_PUBLIC_APP_URL               → (preview deployment URL)"
echo "  LOAD_TEST_SECRET                  → (generate a random token)"
echo ""
echo -e "  Set these for the ${BOLD}Production${RESET} environment:"
echo ""
echo "  NEXT_PUBLIC_SUPABASE_URL          → (production Supabase URL)"
echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY     → (production anon key)"
echo "  SUPABASE_SERVICE_ROLE_KEY         → (production service role key)"
echo "  NEXT_PUBLIC_APP_URL               → https://app.elitedev.com.sa"
echo "  CRON_SECRET                       → (generate a random token)"
echo "  LOAD_TEST_SECRET                  → (generate a random token)"
echo ""

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}  Setup guide complete!${RESET}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  Next steps:"
echo -e "    1. Follow the manual steps above to create the Supabase project"
echo -e "    2. Add GitHub repository secrets"
echo -e "    3. Configure Vercel environment variables"
echo -e "    4. Push to master to trigger a production deployment"
echo -e "    5. Open a PR to trigger a preview deployment"
echo ""
