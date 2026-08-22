# GitHub Repository Secrets Setup Guide

## Required Secrets

Configure these in **GitHub → Repository → Settings → Secrets and variables → Actions**.

### Preview Environment

| Secret | Where to Get | Purpose |
|--------|-------------|---------|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens | Vercel CLI authentication |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link` | Vercel project org |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after `vercel link` | Vercel project ID |

### Staging Environment

| Secret | Where to Get | Purpose |
|--------|-------------|---------|
| `STAGING_URL` | Vercel preview deployment URL | E2E test target |
| `TEST_USER_EMAIL` | Staging Supabase Auth | E2E test credentials |
| `TEST_USER_PASSWORD` | Staging Supabase Auth | E2E test credentials |

### Production Environment

| Secret | Where to Get | Purpose |
|--------|-------------|---------|
| `VERCEL_TOKEN` | Same as preview | Vercel CLI auth |
| `VERCEL_ORG_ID` | Same as preview | Vercel project org |
| `VERCEL_PROJECT_ID` | Same as preview | Vercel project ID |

### Optional (Enhanced Features)

| Secret | Where to Get | Purpose |
|--------|-------------|---------|
| `SENTRY_ORG` | Sentry → Settings → Organization | Source map upload |
| `SENTRY_PROJECT` | Sentry → Settings → Projects | Source map upload |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens | Source map upload |

---

## Step-by-Step Setup

### 1. Create GitHub Environments

1. Go to **GitHub → Repository → Settings → Environments**
2. Create three environments:
   - `preview` — for pull request deployments
   - `staging` — for staging deployments
   - `production` — for production deployments

3. For `production` environment:
   - Enable **Required reviewers** (add yourself)
   - Enable **Wait timer** (optional, e.g., 5 minutes)
   - Restrict **Deployment branches** to `master` only

### 2. Configure Vercel Token

1. Go to https://vercel.com/account/tokens
2. Create a new token named "GitHub Actions"
3. Copy the token
4. Add it to ALL three GitHub environments as `VERCEL_TOKEN`

### 3. Link Vercel Project Locally

```bash
# Install Vercel CLI
npm i -g vercel

# Link to your Vercel project
vercel link

# This creates .vercel/project.json with:
# - orgId
# - projectId
cat .vercel/project.json
```

### 4. Add Vercel IDs to GitHub

1. Copy `orgId` and `projectId` from `.vercel/project.json`
2. Add to ALL three GitHub environments:
   - `VERCEL_ORG_ID` = orgId value
   - `VERCEL_PROJECT_ID` = projectId value

### 5. Configure Staging Secrets

1. Create a staging Supabase project (separate from production)
2. Get the staging app URL from Vercel preview deployment
3. Add to `staging` environment:
   - `STAGING_URL` = your staging Vercel URL
   - `TEST_USER_EMAIL` = test user email in staging Supabase
   - `TEST_USER_PASSWORD` = test user password in staging Supabase

### 6. Configure Sentry (Optional)

1. Go to Sentry → Settings → Organization → Auth Tokens
2. Create a token with `org:read` and `project:releases` scopes
3. Add to production environment:
   - `SENTRY_ORG` = your org slug
   - `SENTRY_PROJECT` = "elitedev"
   - `SENTRY_AUTH_TOKEN` = the token you created

---

## Verification

After configuring secrets, push a commit to trigger CI:

```bash
# Push to master to trigger CI
git push origin master

# Check CI status
# Go to: https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions
```

### Expected CI Results

| Job | Expected Result |
|-----|----------------|
| ci | ✅ Passes (lint, typecheck, tests, build, audit, smoke) |
| pgtap | ✅ Passes (if Docker available on runner) |
| e2e | ⏸️ Skipped (no staging URL configured yet) |

### Expected Deploy Results (after CI passes)

| Workflow | Expected Result |
|----------|----------------|
| Deploy — EliteDev (preview) | ✅ Deploys preview on PRs |
| Deploy — EliteDev (production) | ✅ Deploys to production on master (after approval) |

---

## Troubleshooting

### CI fails with "Unable to locate executable file: pnpm"
→ Fixed in commit 49e7a55. Ensure the workflow uses `pnpm/action-setup@v4`.

### Deploy fails with "VERCEL_TOKEN is required"
→ Add `VERCEL_TOKEN` to the appropriate GitHub environment.

### pgTAP job fails
→ Docker may not be available on the GitHub runner. Check runner labels.

### E2E tests skipped
→ Add `STAGING_URL` to the `preview` or `staging` environment.

### Health check returns "degraded"
→ Expected when Supabase is not running in CI. The app starts and responds.
