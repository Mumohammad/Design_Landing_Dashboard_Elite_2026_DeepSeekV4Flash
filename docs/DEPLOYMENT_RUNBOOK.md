# DEPLOYMENT_RUNBOOK.md — EliteDev Platform

**Last Updated:** 2026-08-22
**Target Platform:** Vercel + Supabase
**Deployment Method:** Git-push to master (auto-deploy) or Vercel CLI

---

## Prerequisites

### Repository Access
- GitHub repository: `Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash`
- Branch: `master` (production)
- Branch protection: Require PR review for direct pushes

### Environment Variables

| Variable | Environment | Source |
|----------|-------------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | All | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | Supabase project API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase project settings |
| `NEXT_PUBLIC_APP_URL` | All | Production domain |
| `RESEND_API_KEY` | Server only | Resend dashboard |
| `RESEND_FROM_EMAIL` | Server only | Verified sender |
| `SENTRY_DSN` | All (optional) | Sentry project |
| `SENTRY_ORG` | Build (optional) | Sentry org |
| `SENTRY_PROJECT` | Build (optional) | Sentry project |
| `VERCEL_TOKEN` | CI only | Vercel account |

### Required Secrets (GitHub Actions)
- `VERCEL_TOKEN` — Vercel deployment token
- `STAGING_URL` — Staging environment URL (for E2E)
- `TEST_USER_EMAIL` — Test account email
- `TEST_USER_PASSWORD` — Test account password

---

## Deployment Steps

### Standard Deployment (Git Push)

```bash
# 1. Ensure CI passes
# Push to master triggers auto-deploy via .github/workflows/deploy.yml

# 2. Push to master
git push origin master

# 3. Monitor deployment
# - GitHub Actions: .github/workflows/deploy.yml
# - Vercel Dashboard: Deployments tab
```

### Manual Deployment (Vercel CLI)

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Link project
vercel link

# 4. Deploy to preview
vercel

# 5. Deploy to production
vercel --prod
```

### Emergency Deployment (Hotfix)

```bash
# 1. Create hotfix branch
git checkout -b hotfix/fix-description

# 2. Make fix
# ... edit files ...

# 3. Commit and push
git add .
git commit -m "hotfix: description"
git push origin hotfix/fix-description

# 4. Merge to master (or deploy from branch)
git checkout master
git merge hotfix/fix-description
git push origin master

# 5. Verify
bash scripts/deploy-verify.sh https://app.elitedev.com.sa
```

---

## Database Setup

### Fresh Install

```bash
# 1. Apply all migrations
npx supabase db push --db-url postgresql://...

# 2. Or apply individually
for f in supabase/migrations/*.sql; do
  psql "postgresql://..." < "$f"
done

# 3. Verify schema
psql "postgresql://..." -c "\dt" | head -20

# 4. Verify RLS
psql "postgresql://..." -c "
  SELECT tablename, policyname, cmd
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename;
"
```

### Migration Numbering

| Range | Purpose |
|-------|---------|
| 001-010 | Core schema (tenants, users, RBAC, RLS) |
| 011-030 | Features (drivers, vehicles, templates, applications) |
| 031-050 | Accounting engine (journal, invoices, payments, VAT) |
| 051-057 | Financial statements, ZATCA adapter |
| 058+ | Security hardening (forward-only, never edit historical) |

---

## Post-Deploy Verification

### Automated (CI/CD)

The deployment workflow automatically runs:
1. Health endpoint check (`/api/health`)
2. Security headers verification
3. Auth boundary test

### Manual Verification

```bash
# 1. Health check
curl -s https://app.elitedev.com.sa/api/health | jq '.'

# Expected:
# {
#   "status": "healthy",
#   "timestamp": "...",
#   "checks": {
#     "app": { "status": "ok", "uptime": ... },
#     "database": { "status": "ok", "latencyMs": ... },
#     "auth": { "status": "ok", "latencyMs": ... }
#   }
# }

# 2. Full verification script
bash scripts/deploy-verify.sh https://app.elitedev.com.sa

# 3. Auth flow
# Open browser → /auth/sign-in → Login → Dashboard

# 4. Critical modules
# Check: Dashboard, Drivers, Vehicles, Payroll, Accounting, Invoices
```

### Security Headers Check

```bash
curl -s -I https://app.elitedev.com.sa/landing | grep -iE \
  "x-frame|x-content|strict-transport|content-security|referrer-policy"
```

Expected output:
```
x-frame-options: DENY
x-content-type-options: nosniff
strict-transport-security: max-age=63072000; includeSubDomains; preload
content-security-policy: default-src 'self'; ...
referrer-policy: strict-origin-when-cross-origin
```

---

## Rollback

### Quick Rollback (Application)

```bash
# Promote previous Vercel deployment
vercel promote <previous-url> --prod --token=$VERCEL_TOKEN

# Or revert Git commit
git revert HEAD --no-edit && git push origin master
```

### Full Rollback (Application + Database)

See [ROLLBACK_PLAN.md](./ROLLBACK_PLAN.md) for detailed procedures.

---

## Monitoring

### Health Check

```bash
# Automated (run every 5 min in production)
curl -s https://app.elitedev.com.sa/api/health | jq '.status'
```

### Sentry

- Client: Browser errors, performance, replays
- Server: Server actions, API routes, middleware
- Edge: Proxy/middleware errors

### Logs

```bash
# Vercel function logs
vercel logs --follow

# Or via Vercel Dashboard → Logs tab
```

---

## Troubleshooting

### Build Fails

```bash
# Check TypeScript errors
npx tsc --noEmit

# Check lint errors
pnpm lint

# Check for missing env vars
# Build step sets: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### Health Check Fails

```bash
# 1. Check if Supabase is reachable
curl -s https://your-project.supabase.co/rest/v1/ | head

# 2. Check if anon key is valid
curl -s -H "apikey: YOUR_ANON_KEY" https://your-project.supabase.co/rest/v1/tenants?select=id&limit=1

# 3. Check auth service
curl -s -H "apikey: YOUR_ANON_KEY" https://your-project.supabase.co/auth/v1/health
```

### Auth Redirect Loop

```bash
# 1. Clear cookies
# 2. Check if users table has a row for the auth user
# 3. Check if status is "active" (not "inactive" or "locked")
# 4. Check proxy.ts matcher includes the current route
```

---

## Deployment Checklist

Before every production deployment:

- [ ] CI pipeline passes (lint, typecheck, tests, build)
- [ ] Dependency audit passes (no high/critical)
- [ ] No secrets in client bundle
- [ ] Database migrations tested on staging
- [ ] Health endpoint verified
- [ ] Auth flow tested
- [ ] Security headers present
- [ ] Sentry connected (no errors in staging)
- [ ] Previous deployment URL noted for rollback
- [ ] Team notified of deployment window
