# DATABASE_SCALABILITY.md — EliteDev Platform

**Audit Date:** 2026-08-20

---

## Current Schema Scale

| Metric | Value |
|--------|:-----:|
| Total tables | 77+ |
| Total migrations | 57 |
| Total SQL lines | ~10,135 |
| RLS policies | 100+ |
| Indexes | ~30+ |
| Triggers | 6 |
| Helper functions | 2 (get_my_tenant_id, get_my_user_id) |

## Capacity Model

### Per-Tenant Assumptions
| Resource | Small Tenant | Medium Tenant | Large Tenant |
|----------|:-----------:|:-------------:|:------------:|
| Users | 5 | 25 | 100 |
| Drivers | 10 | 200 | 1,000 |
| Vehicles | 5 | 100 | 500 |
| Orders/month | 100 | 5,000 | 50,000 |
| Payroll records/year | 60 | 600 | 6,000 |
| Documents | 50 | 1,000 | 10,000 |
| Audit events/year | 5,000 | 100,000 | 1,000,000 |
| DB size | 10 MB | 200 MB | 2 GB |
| Storage | 50 MB | 2 GB | 20 GB |

### Multi-Tenant Aggregate
| Tenants | Users | DB Size | Storage | API/month |
|:-------:|:-----:|:-------:|:-------:|:---------:|
| 1 | 5-100 | 10 MB-2 GB | 50 MB-20 GB | 50K-500K |
| 10 | 50-1,000 | 100 MB-20 GB | 500 MB-200 GB | 500K-5M |
| 100 | 500-10,000 | 1-200 GB | 5-2 TB | 5M-50M |
| 1,000 | 5,000-100,000 | 10-2 TB | 50-200 TB | 50M-500M |

## Performance-Critical Queries

| Query | Tables | Current Index | Recommendation |
|-------|--------|:-------------:|----------------|
| Dashboard KPIs | drivers, vehicles, orders, payroll | tenant_id | Add composite indexes |
| Payroll processing | driver_payroll_periods, payroll_journal_entries | tenant_id, period | Add covering index |
| Invoice list | invoices, invoice_lines | tenant_id, status | Add (tenant_id, created_at) |
| Journal entries | journal_entries, journal_entry_lines | tenant_id, period | Add (tenant_id, status, created_at) |
| Audit log | audit_log | tenant_id, created_at | Add (tenant_id, action, created_at) |
| Attendance | driver_attendance | driver_id, date | Add (tenant_id, date, driver_id) |

## Partitioning Strategy (When Needed)

### Trigger: Audit log > 10M rows
```sql
-- Partition by tenant_id for multi-tenant isolation
CREATE TABLE audit_log_partitioned (
  LIKE audit_log INCLUDING ALL
) PARTITION BY LIST (tenant_id);
```

### Trigger: Financial tables > 1M rows
```sql
-- Partition by tenant_id + period
CREATE TABLE journal_entries_partitioned (
  LIKE journal_entries INCLUDING ALL
) PARTITION BY RANGE (period_start);
```

## Backup & Recovery

| Metric | Requirement | Current |
|--------|:-----------:|:-------:|
| RPO | <1 hour | 24 hours (daily backup) |
| RTO | <4 hours | Untested |
| Backup frequency | Hourly | Daily |
| PITR | Required for production | Pro plan only |
| Cross-region | Recommended | Not available on Free |
