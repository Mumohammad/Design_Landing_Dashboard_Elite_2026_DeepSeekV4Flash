# RELEASE_CHECKLIST.md — EliteDev Platform

**Last Updated:** 2026-08-20

---

## Pre-Release Checklist

### Code Quality
- [ ] TypeScript: `npx tsc --noEmit` passes (0 errors)
- [ ] Tests: `npx vitest run` passes (195/195)
- [ ] Lint: `npm run lint` passes
- [ ] Build: `npm run build` succeeds

### Security
- [ ] No hardcoded secrets in source
- [ ] `.env.local` not committed
- [ ] Service role key server-only
- [ ] RLS policies verified
- [ ] `pnpm audit` — no critical/high vulnerabilities
- [ ] CSP headers configured (currently MISSING — P1)

### Database
- [ ] All migrations applied (001-057)
- [ ] Migration 009 trigger applied via SQL Editor
- [ ] RLS policies active on all tables
- [ ] Seed data loaded (013)
- [ ] Backup verified

### Environment
- [ ] All env vars configured in production
- [ ] `NEXT_PUBLIC_APP_URL` correct
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (server only)
- [ ] `RESEND_API_KEY` set
- [ ] `SENTRY_DSN` set (optional)

### Frontend
- [ ] All 36 dashboard pages load
- [ ] RTL layout works
- [ ] LTR layout works
- [ ] Dark mode works
- [ ] Light mode works
- [ ] Mobile responsive
- [ ] Landing page loads
- [ ] Auth flow works

### Functionality
- [ ] Login/Logout
- [ ] Dashboard loads with data
- [ ] Driver CRUD
- [ ] Vehicle CRUD
- [ ] Attendance recording
- [ ] Payroll processing
- [ ] Invoice creation
- [ ] Expense recording
- [ ] Report generation

### Deployment
- [ ] Vercel/docker configured
- [ ] Domain configured
- [ ] SSL certificate active
- [ ] DNS configured
- [ ] Post-deploy smoke test passed

## Post-Release Verification

- [ ] Homepage loads
- [ ] Authentication works
- [ ] Dashboard renders
- [ ] API/server actions respond
- [ ] Database connectivity verified
- [ ] Storage accessible
- [ ] Email delivery works
- [ ] Error tracking active
- [ ] No critical errors in logs
