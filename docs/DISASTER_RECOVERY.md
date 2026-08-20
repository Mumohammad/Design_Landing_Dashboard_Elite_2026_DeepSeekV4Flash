# DISASTER_RECOVERY.md — EliteDev Platform

**Last Updated:** 2026-08-20
**RPO:** 24 hours (Supabase daily backups)
**RTO:** 4 hours (estimated)

---

## Backup Strategy

### Database (Supabase)
| Type | Frequency | Retention | Provider |
|------|-----------|-----------|----------|
| Automated backup | Daily | 7 days | Supabase |
| Point-in-time recovery | Continuous | 7 days | Supabase (Pro plan) |
| Manual export | Weekly | 30 days | pg_dump → encrypted storage |

### Application Code
| Type | Frequency | Retention | Provider |
|------|-----------|-----------|----------|
| Git repository | Per commit | Permanent | GitHub/GitLab |
| Vercel snapshots | Per deploy | 30 days | Vercel |

### Storage (Supabase Storage)
| Type | Frequency | Retention |
|------|-----------|-----------|
| Bucket replication | Real-time | Same as DB |

## Recovery Procedures

### Scenario 1: Database Corruption
1. Stop application traffic
2. Identify corruption scope
3. Restore from point-in-time recovery
4. Verify data integrity
5. Resume traffic

### Scenario 2: Application Deployment Failure
1. Roll back to previous Vercel deployment
2. Verify health checks
3. Resume traffic

### Scenario 3: Complete Supabase Outage
1. Display maintenance page
2. Monitor Supabase status page
3. Resume when restored
4. Verify data consistency

### Scenario 4: Security Breach
1. Rotate all secrets immediately
2. Force password reset for all users
3. Review audit logs
4. Identify attack vector
5. Deploy fix
6. Notify affected users

## Verification Frequency

| Check | Frequency | Owner |
|-------|-----------|-------|
| Backup existence | Daily (automated) | DevOps |
| Backup restoration test | Monthly | DevOps |
| Full DR drill | Quarterly | Team |
| Secret rotation | Every 90 days | Security |
