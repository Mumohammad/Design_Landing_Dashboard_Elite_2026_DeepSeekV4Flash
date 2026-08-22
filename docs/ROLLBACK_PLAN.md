# ROLLBACK_PLAN.md — EliteDev Platform

**Last Updated:** 2026-08-22
**Platform:** Vercel + Supabase

---

## Rollback Decision Tree

```
Incident detected
    ↓
Is data integrity at risk?
    ├── YES → Contain (maintenance mode) → Restore DB → Rotate secrets → Deploy clean
    └── NO → Is the current deployment the cause?
        ├── YES → Rollback Vercel deployment
        └── NO → Investigate → Fix forward
```

---

## Rollback Procedures

### 1. Application Rollback (Vercel) — 2 minutes

**When:** Bad code deploy, broken UI, performance regression
**Risk:** Low — code rollback only, no data changes

```bash
# Option A: Promote previous deployment via CLI
vercel promote <previous-deployment-url> --token=$VERCEL_TOKEN --prod

# Option B: Redeploy previous Git commit
git revert HEAD --no-edit
git push origin master
# Vercel auto-deploys on push to master
```

**Verify:**
```bash
curl -s https://app.elitedev.com.sa/api/health | jq '.status'
# Must return "healthy"
```

### 2. Database Migration Rollback — 30 minutes

**When:** Migration caused data corruption or broke RLS
**Risk:** Medium — data migration may not be reversible

```bash
# 1. Identify the problematic migration
# Check: supabase/migrations/ for the latest numbered file

# 2. Create a reverse migration (NEVER edit applied migrations)
# Create new file: supabase/migrations/059_rollback_<description>.sql

# 3. Example: rollback RLS hardening
cat > supabase/migrations/059_rollback_rls.sql << 'SQL'
-- Reverse: 058_auth_rls_hardening.sql
-- WARNING: Only use in emergency — weakens security

-- Restore broader grants (INSECURE — temporary only)
GRANT ALL ON TABLE role_permissions TO authenticated;
GRANT ALL ON TABLE user_role_assignments TO authenticated;
GRANT ALL ON TABLE tenant_memberships TO authenticated;

-- Drop the self-escalation prevention trigger
DROP TRIGGER IF EXISTS prevent_user_self_escalation ON users;
DROP FUNCTION IF EXISTS prevent_user_self_escalation();
SQL

# 4. Apply via Supabase SQL Editor (NOT in production without review)
# 5. Verify with RLS test suite
```

**Critical Rule:** Never delete data during rollback. Use soft-delete or restore from backup.

### 3. Full Environment Rollback — 2 hours

**When:** Security breach, catastrophic data loss, service-wide outage
**Risk:** High — requires coordinated rollback

```bash
# PHASE 1: Contain (5 min)
# Set Vercel to maintenance mode
# Revoke compromised credentials immediately

# PHASE 2: Restore Database (30 min)
# Use Supabase point-in-time recovery to pre-incident state
# Or restore from manual pg_dump backup

# PHASE 3: Rotate Secrets (15 min)
# - Supabase service_role key
# - Supabase anon key (if compromised)
# - Any API keys (Resend, etc.)
# - Session secrets

# PHASE 4: Deploy Clean (5 min)
git checkout <last-known-good-commit>
git push origin master --force
# Vercel deploys automatically

# PHASE 5: Verify (15 min)
bash scripts/deploy-verify.sh https://app.elitedev.com.sa

# PHASE 6: Monitor (30 min)
# Watch Sentry for new errors
# Check health endpoint
# Verify critical workflows
```

---

## Migration Safety Rules

1. **Never edit applied migrations** — Create forward-only rollback migrations
2. **Never drop columns** — Add nullable column, backfill, then drop in next migration
3. **Never delete data** — Soft-delete with `deleted_at` timestamp
4. **Test in staging first** — Apply migration to disposable Supabase project
5. **Backward compatible** — Old app version must work with new schema
6. **Idempotent** — Migration can be re-run safely (use `IF EXISTS`, `ON CONFLICT`)
7. **Audit trail** — Log every migration application

---

## Rollback Readiness Checklist

Before every production deployment:

- [ ] Previous Vercel deployment URL noted
- [ ] Database backup verified (within 24 hours)
- [ ] Migration is reversible (or forward-only with no data loss)
- [ ] Health endpoint tested on staging
- [ ] Rollback procedure reviewed
- [ ] Team notified of deployment window
- [ ] Monitoring alerts active (Sentry, health check)

---

## Post-Rollback Verification

After any rollback:

1. **Health check** — `curl -s /api/health | jq '.status'`
2. **Auth flow** — Login → Dashboard → Module navigation
3. **Security headers** — `curl -s -I /landing | grep -i x-frame`
4. **Database** — Query a few key tables
5. **Sentry** — No new error groups appearing
6. **User impact** — Check if any users were affected during incident
