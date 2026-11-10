# Staging Supabase Setup — EliteDev

This guide walks through creating a staging Supabase project for preview deployments.

## Quick Setup

```bash
bash scripts/setup-staging.sh              # Full interactive setup
bash scripts/setup-staging.sh --local-only # Local Supabase only
```

## Architecture

```
PR opened → CI passes → Deploy workflow → Preview deployment
                                            ↓
                                    Staging Supabase project
                                    (separate from production)
                                            ↓
                                    Smoke tests → E2E tests
                                            ↓
                                    Preview URL posted to PR

Master push → CI passes → Deploy workflow → Production deployment
                                              ↓
                                      Production Supabase project
                                              ↓
                                      Health check → Post-deploy verification
```

## Step-by-Step Setup

### 1. Create Staging Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **"New Project"**
3. Configure:
   | Setting | Value |
   |---------|-------|
   | Organization | Your organization |
   | Name | `EliteDev Staging` |
   | Region | Middle East (East) |
   | Plan | Free |
   | Database Password | *(generate strong password)* |
4. Wait for project creation (~30s)
5. Go to **Settings → API** and copy:
   - Project URL: `https://xxxxx.supabase.co`
   - Anon Key: `eyJhbG...`
   - Service Role Key: `eyJhbG...`

### 2. Apply Migrations

```bash
# Link to your staging project
supabase link --project-ref xxxxx

# Apply all migrations
supabase db push

# Seed test data
supabase db seed
```

### 3. Create Test User

1. Go to **Dashboard → Authentication → Users → Add User**
2. Email: `admin@elitedev-test.com`
3. Password: `Test1234!`
4. Email confirmed: Yes

### 4. Configure Auth Settings

Go to **Dashboard → Authentication → Settings**:
- Disable public sign-up (optional, recommended)
- Enable email confirmation
- Set site URL to your preview deployment URL

### 5. Add GitHub Repository Secrets

Go to **GitHub → Settings → Secrets and variables → Actions**:

| Secret Name | Value | Used By |
|-------------|-------|---------|
| `STAGING_SUPABASE_URL` | `https://xxxxx.supabase.co` | Preview builds |
| `STAGING_SUPABASE_ANON_KEY` | `eyJhbG...` | Preview builds |
| `STAGING_SUPABASE_SERVICE_KEY` | `eyJhbG...` | Preview builds |
| `STAGING_URL` | `https://your-preview.vercel.app` | E2E tests |
| `TEST_USER_EMAIL` | `admin@elitedev-test.com` | E2E tests |
| `TEST_USER_PASSWORD` | `Test1234!` | E2E tests |

### 6. Configure Vercel Environment Variables

Go to **Vercel → Settings → Environment Variables**:

**Preview environment:**

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | *(staging URL)* |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(staging anon key)* |
| `SUPABASE_SERVICE_ROLE_KEY` | *(staging service key)* |
| `NEXT_PUBLIC_APP_URL` | *(preview deployment URL)* |
| `LOG_LEVEL` | `info` |
| `PERF_LOG_THRESHOLD_MS` | `2000` |

**Production environment:**

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | *(production URL)* |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(production anon key)* |
| `SUPABASE_SERVICE_ROLE_KEY` | *(production service key)* |
| `NEXT_PUBLIC_APP_URL` | `https://app.elitedev.com.sa` |
| `SENTRY_ORG` | *(your org)* |
| `SENTRY_PROJECT` | `elitedev` |
| `SENTRY_AUTH_TOKEN` | *(from Sentry)* |
| `CRON_SECRET` | *(generate random)* |
| `LOAD_TEST_SECRET` | *(generate random)* |
| `LOG_LEVEL` | `info` |
| `PERF_LOG_THRESHOLD_MS` | `1000` |

## Preview Deployment Flow

When a PR is opened:

1. **CI job** runs: lint, typecheck, tests, build, audit, pgTAP
2. **Preview job** runs (only after CI passes):
   - Builds with staging Supabase credentials
   - Deploys to Vercel preview
   - Runs smoke tests against preview URL
   - Posts preview URL to PR
3. **E2E job** runs (if `STAGING_URL` is set):
   - Runs Playwright tests against staging
   - Reports results in PR checks

## Verification

After setup, verify everything works:

```bash
# 1. Push a branch and open a PR
git checkout -b test/staging-setup
git commit --allow-empty -m "test: verify staging setup"
git push origin test/staging-setup

# 2. Check GitHub Actions
# - CI should pass (lint, typecheck, tests, build)
# - Preview should deploy
# - Preview URL should appear in PR

# 3. Check preview URL
curl -s https://your-preview.vercel.app/api/health
# Should return: {"status":"healthy","checks":{...}}

# 4. Check staging Supabase
# - Dashboard should show data from migrations
# - Auth should work with test user
```

## Staging vs Production

| Aspect | Staging | Production |
|--------|---------|------------|
| Supabase project | `EliteDev Staging` | `EliteDev Production` |
| Data | Test fixtures only | Real business data |
| Auth | Test users only | Real users |
| Migrations | Same as production | Same as staging |
| RLS | Same as production | Same as staging |
| Monitoring | Sentry staging DSN | Sentry production DSN |
| Domain | `*.vercel.app` | `app.elitedev.com.sa` |

## Troubleshooting

### Preview build fails

- Check that `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` are set
- Verify the staging Supabase project is running
- Check Vercel build logs for Supabase connection errors

### E2E tests fail

- Verify `STAGING_URL` matches the preview deployment URL
- Check that the test user exists in staging Supabase
- Run tests locally: `BASE_URL=https://your-preview.vercel.app pnpm test:e2e`

### Health check returns degraded

- Staging Supabase may not have all migrations applied
- Run `supabase db push` to apply pending migrations
- Check Supabase dashboard for connection limits

### pgTAP tests fail on staging

- pgTAP tests run against a local Supabase, not staging
- Staging RLS is the same schema but different data
- If pgTAP passes locally, staging RLS is structurally correct
