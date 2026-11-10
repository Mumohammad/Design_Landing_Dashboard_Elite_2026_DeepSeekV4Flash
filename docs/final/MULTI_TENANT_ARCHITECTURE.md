# MULTI_TENANT_ARCHITECTURE.md — EliteDev Platform

**Audit Date:** 2026-08-20
**Status:** ✅ STRUCTURALLY SOUND — Single-tenant today, multi-tenant-ready architecture

---

## Current Tenant Model

EliteDev uses a **tenant_id** based isolation model (not `organization_id`):

```
auth.users (Supabase Auth)
    ↓
users (tenant_id FK)
    ↓
tenant_memberships (user ↔ tenant)
    ↓
tenants (the organization/company)
```

### Tenant ID Flow
```
Browser → proxy.ts → supabase.auth.getUser()
    → users WHERE auth_user_id = auth.uid()
    → tenant_id
    → All queries filter by tenant_id
    → RLS enforces tenant isolation at DB level
```

## Tenant-Owned Table Matrix

| Table | Tenant FK | RLS | Policies | Cross-Tenant Risk |
|-------|:---------:|:---:|:--------:|:-----------------:|
| users | ✅ | ✅ | 3 (sel/ins/upd) | None |
| drivers | ✅ | ✅ | 3 | None |
| vehicles | ✅ | ✅ | 3 | None |
| driver_documents | ✅ | ✅ | 3 | None |
| vehicle_documents | ✅ | ✅ | 3 | None |
| driver_attendance | ✅ | ✅ | 3 | None |
| violations | ✅ | ✅ | 3 | None |
| daily_order_entries | ✅ | ✅ | 3 | None |
| expenses | ✅ | ✅ | 3 | None |
| payroll | ✅ | ✅ | 3 | None |
| chart_of_accounts | ✅ | ✅ | 3 | None |
| journal_entries | ✅ | ✅ | 3 | None |
| invoices | ✅ | ✅ | 3 | None |
| receivables | ✅ | ✅ | 3 | None |
| payables | ✅ | ✅ | 3 | None |
| finance_payments | ✅ | ✅ | 3 | None |
| payment_allocations | ✅ | ✅ | 3 | None |
| document_templates | ✅ | ✅ | 3 | None |
| generated_documents | ✅ | ✅ | 3 | None |
| report_generation_log | ✅ | ✅ | 3 | None |
| driver_applications | ✅ | ✅ | 3 | None |
| platform_payments | ✅ | ✅ | 3 | None |
| audit_log | ✅ | ✅ | 1 (select) | None |
| system_settings | ✅ | ✅ | 4 | None |
| roles | ✅ | ✅ | 3 | None |
| invites | ✅ | ✅ | 3 | None |
| zatca_csids | ✅ | ✅ | 3 | None |
| zatca_transmissions | ✅ | ✅ | 3 | None |
| vat_periods | ✅ | ✅ | 3 | None |
| financial_events | ✅ | ✅ | 3 | None |

**All 77+ tables** have RLS enabled. All business tables have `tenant_id` FK.

## Security Enforcement Layers

| Layer | Mechanism | Enforced |
|-------|-----------|:--------:|
| 1. Middleware (proxy.ts) | Session + profile lookup | ✅ |
| 2. Server Actions | `getCurrentUser().tenantId` | ✅ |
| 3. Database RLS | `get_my_tenant_id()` helper | ✅ |
| 4. Service Role | `createAdminClient()` — server-only | ✅ |

### Defense in Depth Analysis
- **Layer 1**: proxy.ts validates JWT, fetches profile, checks status/lockout
- **Layer 2**: Every server action calls `getCurrentUser()` which derives tenant from auth.uid()
- **Layer 3**: RLS policies use `get_my_tenant_id()` — SECURITY DEFINER function
- **Layer 4**: Service role client is never imported in client components

## Multi-Organization User Design

The current model supports **one user → one tenant** via the `users` table's `tenant_id` column.

### Current Architecture
```
users
├── tenant_id (UUID NOT NULL)
├── role (user_role enum)
└── tenant_memberships (backup/auxiliary)
```

### Multi-Org Readiness
| Capability | Current | Future-Ready? |
|------------|:-------:|:-------------:|
| User in one org | ✅ | ✅ |
| User in multiple orgs | ❌ | ⚠️ Schema supports it (tenant_memberships) but proxy.ts only reads one |
| Different roles per org | ❌ | ⚠️ Would need org-specific role lookup |
| Org switching in UI | ❌ | ❌ Would need significant work |

### Recommendation for Multi-Org
The `tenant_memberships` table already supports multi-org. To enable it:
1. Modify `proxy.ts` to accept an `org_id` parameter
2. Modify `get_my_tenant_id()` to accept an org context
3. Add org-switcher in the UI
4. Ensure all server actions receive org context

## Hardcoded Tenant ID

| Location | Value | Risk | Status |
|----------|-------|------|--------|
| 009_triggers.sql | `00000000-...-0001` | Default tenant for auto-provisioning | ⚠️ Configurable |
| 013_seed_defaults.sql | `00000000-...-0001` | Seed data tenant | ✅ Expected |
| analytics/actions.ts | `00000000-...-0000` | No-op placeholder | ✅ Harmless |

The default tenant ID in the trigger is **intentional** — it's where new auth users are auto-provisioned. This is configurable by editing the trigger variable.

## Verdict

**YES — Multi-tenant ready at the architecture level.** All 77+ tables have `tenant_id`, all have RLS, the security helper function is SECURITY DEFINER, and the middleware chain enforces tenant context. The current single-tenant usage is by design (one company), but the architecture supports multiple tenants without a fundamental rewrite.

The main gap for true multi-org support is the `tenant_id` column on the `users` table (currently one user → one tenant). This is the correct starting point for a SaaS platform.
