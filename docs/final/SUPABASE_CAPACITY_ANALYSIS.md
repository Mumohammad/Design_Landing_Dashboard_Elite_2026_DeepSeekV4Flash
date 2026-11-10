# SUPABASE_CAPACITY_ANALYSIS.md — EliteDev Platform

**Analysis Date:** 2026-08-20
**Plan Assumed:** Supabase Free/Pro
**Status:** ✅ Adequate for initial deployment; upgrade path documented

---

## Current Usage (Estimated)

| Metric | Current | Notes |
|--------|:-------:|-------|
| Tables | 77+ | All with RLS |
| RLS Policies | 100+ | Across all tables |
| SQL Migrations | 57 | ~10,135 lines |
| Server Actions | 26 files | All with admin client |
| Auth Users | ~5-20 | Development/demo |
| Storage Buckets | 9 | All private except company-assets |
| Database Size | ~50 MB | Estimated with seed data |
| Auth MAU | ~5-20 | Development |
| Edge Functions | 0 | Not used |

## Supabase Free Plan Limits (as of 2026)

| Resource | Free Limit | Risk |
|----------|-----------|------|
| Database Space | 500 MB | Low initially |
| Storage | 1 GB | Medium — PDFs/reports accumulate |
| Auth MAU | 50,000 | Low risk |
| Edge Functions | 500K invocations | Not used |
| Bandwidth | 5 GB/month | Low initially |
| Realtime Connections | 200 | Not used |
| Projects | 2 | Sufficient |
| Pausing | Inactivity > 7 days | **HIGH — must keep active** |
| Custom Domain | Not available | Pro only |
| Point-in-Time Recovery | Not available | Pro only |
| Log Retention | 1 day | Pro: 7 days |

## Supabase Pro Plan ($25/month)

| Resource | Pro Limit | Notes |
|----------|-----------|-------|
| Database Space | 8 GB | |
| Storage | 100 GB | |
| Auth MAU | 100,000 | |
| Bandwidth | 250 GB/month | |
| Realtime Connections | 500 | |
| Log Retention | 7 days | |
| Point-in-Time Recovery | 7 days | Critical for production |
| Custom Domains | ✅ | Required for production |
| Project Pausing | Never | Critical for production |
| SOC2 Compliance | ✅ | Enterprise requirement |

## Capacity Scenarios

### Scenario 1: SMALL (1-10 tenants, <50 users)

| Metric | Estimate | Free Plan | Pro Plan |
|--------|:--------:|:---------:|:--------:|
| DB Size | 100 MB | ✅ | ✅ |
| Storage | 2 GB | ⚠️ Exceeds | ✅ |
| Auth MAU | 50 | ✅ | ✅ |
| API Requests | 100K/month | ✅ | ✅ |
| Bandwidth | 1 GB/month | ✅ | ✅ |
| Concurrent Users | 20 | ✅ | ✅ |
| Audit Log Growth | 50K rows/month | ✅ | ✅ |

**Recommendation:** Pro plan (storage + pausing risk)

### Scenario 2: GROWTH (10-100 tenants, 50-500 users)

| Metric | Estimate | Free Plan | Pro Plan |
|--------|:--------:|:---------:|:--------:|
| DB Size | 500 MB-2 GB | ⚠️ | ✅ |
| Storage | 10-50 GB | ❌ | ✅ |
| Auth MAU | 200-2,000 | ✅ | ✅ |
| API Requests | 1-10M/month | ⚠️ | ✅ |
| Bandwidth | 10-50 GB/month | ❌ | ✅ |
| Concurrent Users | 100-200 | ⚠️ | ✅ |
| Audit Log Growth | 500K-5M rows/month | ⚠️ | ✅ |

**Recommendation:** Pro plan minimum, consider Team ($599/month) for >50 tenants

### Scenario 3: SCALE (100+ tenants, 1000+ users)

| Metric | Estimate | Pro Plan | Team/Enterprise |
|--------|:--------:|:--------:|:---------------:|
| DB Size | 5-20 GB | ⚠️ | ✅ |
| Storage | 100-500 GB | ⚠️ | ✅ |
| Auth MAU | 5,000-50,000 | ✅ | ✅ |
| API Requests | 50-200M/month | ⚠️ | ✅ |
| Bandwidth | 100-500 GB/month | ⚠️ | ✅ |
| Concurrent Users | 500+ | ⚠️ | ✅ |
| Read Replicas | Needed | ❌ | ✅ |

**Recommendation:** Team or Enterprise plan with read replicas

## Upgrade Triggers

| Trigger | Threshold | Action |
|---------|-----------|--------|
| DB > 500 MB | Monitor monthly | Upgrade to Pro |
| Storage > 500 MB | Monitor monthly | Upgrade to Pro |
| Auth MAU > 5,000 | Monitor monthly | Upgrade to Pro |
| Inactivity pausing risk | Any period of inactivity | Upgrade to Pro |
| Audit log > 1M rows | Monitor quarterly | Consider partitioning |
| Bandwidth > 2 GB/month | Monitor monthly | Upgrade to Pro |
| Need PITR | Production deployment | Upgrade to Pro |
| Need custom domain | Production deployment | Upgrade to Pro |

## Performance Considerations

### Query Load per Request (Estimated)
| Page | Queries | Complexity |
|------|:-------:|:----------:|
| Dashboard | 8-12 | Medium (aggregations) |
| Driver List | 1-2 | Low |
| Payroll Processing | 10-20 | High (calculations) |
| Invoice Generation | 5-10 | Medium |
| Report Generation | 3-8 | Medium-High |
| ZATCA Transmission | 3-5 | Medium |

### Estimated Monthly API Requests (10 tenants, 100 users)
- Dashboard loads: 100 users × 30 days × 5 views = 15,000
- CRUD operations: 100 users × 30 days × 20 ops = 60,000
- Background (proxy): 15,000 + 60,000 = 75,000
- Server actions: ~150,000
- **Total: ~225,000 requests/month** — well within Free plan

## Recommendations

### Immediate (Before Production)
1. **Upgrade to Supabase Pro** ($25/month) — custom domain, PITR, no pausing
2. **Monitor storage growth** — PDFs and documents accumulate
3. **Enable PITR** — Critical for financial data recovery

### 3-Month Review
4. **Audit audit_log table size** — Consider archival strategy
5. **Review query performance** — Add indexes as needed
6. **Consider read replicas** if dashboard load increases

### 12-Month Review
7. **Evaluate Team plan** if >50 tenants
8. **Consider dedicated compute** for heavy payroll/reporting workloads
9. **Implement caching layer** (Redis) to reduce DB load
