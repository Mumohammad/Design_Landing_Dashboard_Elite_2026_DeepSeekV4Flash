# DISASTER_RECOVERY.md — EliteDev Platform

**Last Updated:** 2026-08-22
**Platform:** Vercel + Supabase (PostgreSQL)
**Owner:** Platform Engineering

---

## Recovery Objectives

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (Recovery Point Objective) | ≤ 24 hours | Supabase daily backups on Pro plan |
| **RTO** (Recovery Time Objective) | ≤ 2 hours | Application rollback + DB restore |
| **Backup Frequency** | Daily (automatic) | Supabase Pro plan; manual for Free plan |
| **Restore Testing** | Monthly | Verify restore into staging environment |
| **Verification Frequency** | Weekly | Health check + smoke test |

---

## Backup Strategy

### Database (Supabase PostgreSQL)

| Backup Type | Frequency | Retention | Source |
|-------------|-----------|-----------|--------|
| Automatic daily | Every 24h | 7 days (Free), 30 days (Pro) | Supabase |
| Point-in-time recovery | Continuous (Pro) | 7 days | Supabase Pro plan |
| Manual pg_dump | Weekly | 90 days | `scripts/backup-db.sh` |
| Migration snapshots | Per migration | Forever | Git (supabase/migrations/) |

### Storage (Supabase Storage)

| Backup Type | Frequency | Retention | Source |
|-------------|-----------|-----------|--------|
| Bucket sync | Daily | 30 days | Supabase Storage API |
| Critical documents | Weekly | Forever | Manual export |

### Application Code

| Backup Type | Frequency | Retention | Source |
|-------------|-----------|-----------|--------|
| Git repository | Every push | Forever | GitHub |
| Vercel deployments | Every deploy | 30 days | Vercel |
| npm dependencies | Per install | Per lockfile | pnpm-lock.yaml |

---

## Backup Commands

### Manual Database Backup

```bash
# Using Supabase CLI (requires local Supabase running)
npx supabase db dump --db-url postgresql://... > backup-$(date +%Y%m%d).sql

# Using pg_dump directly
pg_dump postgresql://postgres:password@db.project.supabase.co:5432/postgres \
  --no-owner --no-privileges \
  > backup-$(date +%Y%m%d).sql
```

### Export Storage Buckets

```bash
# List all objects in a bucket
npx supabase storage list --bucket driver-documents

# Download specific files
npx supabase storage download --bucket driver-documents --path "doc.pdf" ./backup/
```

### Export Audit Logs

```bash
# Using Supabase SQL Editor or psql
psql "postgresql://..." -c \
  "COPY audit_log TO '/tmp/audit-log-backup.csv' WITH CSV HEADER;"
```

---

## Restore Procedures

### Scenario 1: Application Rollback (Vercel)

**Trigger:** Bad deployment, broken UI, security regression
**Time:** ~2 minutes

```bash
# 1. List recent deployments
vercel ls

# 2. Promote the previous deployment
vercel promote <deployment-url> --token=$VERCEL_TOKEN

# 3. Verify
curl -I https://app.elitedev.com.sa/api/health
```

### Scenario 2: Database Restore (Point-in-Time)

**Trigger:** Data corruption, accidental deletion
**Time:** ~30 minutes

```bash
# Via Supabase Dashboard:
# 1. Go to Settings > Database > Backups
# 2. Select the backup timestamp BEFORE the incident
# 3. Click "Restore to this point"
# 4. Wait for restore to complete (~10-30 min depending on size)
# 5. Verify with:
#    - SELECT COUNT(*) FROM users;
#    - SELECT COUNT(*) FROM audit_log WHERE created_at > '2026-08-22';
```

### Scenario 3: Database Restore from Manual Backup

**Trigger:** Supabase backup unavailable, full restore needed
**Time:** ~60 minutes

```bash
# 1. Stop the application (Vercel: set maintenance mode)
# 2. Restore the database
psql "postgresql://..." < backup-20260822.sql

# 3. Verify schema integrity
psql "postgresql://..." -c "\dt" | head -20

# 4. Verify RLS policies
psql "postgresql://..." -c "
  SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename;
"

# 5. Re-run any missing migrations
npx supabase db push --db-url postgresql://...

# 6. Verify with health check
curl -I https://app.elitedev.com.sa/api/health
```

### Scenario 4: Full Application + Database Restore

**Trigger:** Catastrophic failure, security breach
**Time:** ~2 hours

1. **Isolate** — Set Vercel to maintenance mode
2. **Restore DB** — Use Supabase point-in-time recovery or manual backup
3. **Rotate secrets** — Supabase service role key, any exposed credentials
4. **Deploy clean** — Revert to last known-good Git commit
5. **Verify** — Run full smoke test suite
6. **Monitor** — Watch Sentry for 30 minutes post-restore
7. **Communicate** — Notify affected users if data was exposed

---

## Incident Response

### Severity Levels

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| **SEV-1** | Service down, data breach, financial loss | 15 minutes | Auth bypass, DB corruption |
| **SEV-2** | Major feature broken, data integrity risk | 1 hour | Payroll calculation wrong, payments failing |
| **SEV-3** | Minor feature broken, degraded performance | 4 hours | Chart not loading, export failing |
| **SEV-4** | Cosmetic issue, non-blocking | Next sprint | Typo, wrong color, slow animation |

### Response Procedure

1. **Detect** — Alert fires (Sentry, health check, user report)
2. **Triage** — Determine severity within 5 minutes
3. **Contain** — If SEV-1: isolate immediately (maintenance mode)
4. **Investigate** — Check Sentry, logs, recent deployments
5. **Fix** — Revert deployment OR apply hotfix
6. **Verify** — Run smoke tests, check health endpoint
7. **Communicate** — Update status page, notify stakeholders
8. **Post-mortem** — Document root cause, prevent recurrence

### Communication Templates

**SEV-1 Incident:**
```
We're experiencing a service disruption affecting [module].
Status: Investigating
Impact: [description]
ETA: [estimate]
Updates: Every 15 minutes at status.elitedev.com.sa
```

**Resolution:**
```
Service has been restored.
Duration: [X] minutes
Impact: [description]
Root cause: [summary]
Prevention: [actions taken]
```

---

## Monitoring & Alerting

### Health Check

```bash
# Automated health check (run every 5 minutes in production)
curl -s https://app.elitedev.com.sa/api/health | jq '.status'
# Expected: "healthy"
```

### Sentry Alerts

| Alert | Severity | Condition |
|-------|----------|-----------|
| Error spike | SEV-2 | >10 errors in 5 minutes |
| Auth failures | SEV-2 | >5 failed logins from same IP |
| Database errors | SEV-1 | Any database connection failure |
| ZATCA failures | SEV-2 | Failed invoice submission |

### Uptime Monitoring

Recommended services:
- **Better Uptime** or **Checkly** — HTTP health check every 60s
- **Sentry** — Error tracking and performance monitoring
- **Supabase Dashboard** — Database and auth metrics

---

## Verification Checklist

After any restore or major incident:

- [ ] Health endpoint returns `{"status":"healthy"}`
- [ ] Landing page loads (200)
- [ ] Sign-in page loads (200)
- [ ] Dashboard redirects unauthenticated users (307/302)
- [ ] Security headers present (X-Frame-Options, CSP, etc.)
- [ ] Database queries working (check health endpoint latency)
- [ ] Auth service working (check health endpoint auth check)
- [ ] Sentry receiving events (check for new error groups)
- [ ] No secrets in client bundles (view-source check)
- [ ] Critical workflows functional (login → dashboard → module)

---

## Ownership

| Role | Responsibility |
|------|---------------|
| **Platform Owner** | Overall disaster recovery strategy |
| **Database Admin** | Database backups, restore, migration safety |
| **DevOps** | CI/CD, deployment, monitoring |
| **Security** | Incident response, secret rotation |

---

## Review Schedule

| Activity | Frequency | Owner |
|----------|-----------|-------|
| Backup verification | Monthly | DB Admin |
| Restore drill | Quarterly | Platform Owner |
| Runbook review | Quarterly | DevOps |
| Incident post-mortem | Every SEV-1/2 | Platform Owner |
| DR plan update | Semi-annually | Platform Owner |
