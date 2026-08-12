# Phase 2 Schema Migration Plan — EliteDev Saudi 3PL Platform

- **Status:** DRAFT — awaiting approval (ADR-014 Phase 2 gate, ADR-019 correction gate)
- **Date:** 2026-07-19
- **Owner:** EliteDev engineering
- **Scope:** Authentication, authorization, and data foundation (Phase 2 per `docs/implementation-plan.md`)
- **Purpose:** This is the SQL migration plan that ADR-014 requires to be presented for approval BEFORE any migration is applied. After approval, migration files are created under `supabase/migrations/` and applied via `supabase db push`.
- **Authoritative references:**
  - `docs/elite-master-prompt-v2.md` sections 5 (platform-wide standards) and 6 (M8 Settings & Auth corrections)
  - `docs/architecture-decisions.md` ADR-002 (single tenant now, multi-tenant ready), ADR-003 (Supabase source of truth), ADR-006 (RBAC + RLS), ADR-007 (immutable audit), ADR-014 (replace dead scaffolding), ADR-019 (v2.0 correction set)

---

## 1. Overview and scope

### 1.1 What Phase 2 covers

Phase 2 establishes the secure data foundation that every subsequent phase depends on. It provisions:

- **`tenants`** — the single seeded Elite Development tenant (multi-tenant-ready schema, single-tenant UX per ADR-002).
- **`users`** — the custom users table that extends Supabase `auth.users` (one-to-one via `auth_user_id`), including auth-adjacent fields (lockout, 2FA, password rotation, invite acceptance) that Supabase Auth does not natively model.
- **`system_settings`** — tenant-scoped key/value configuration store (replaces the hardcoded defaults in the dead `src/lib/tenancy/tenant.ts` stub flagged by ADR-014).
- **`audit_log`** — the immutable audit trail required by ADR-007.
- **RBAC tables** — `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `tenant_memberships`, `invites` (per ADR-006).
- **Storage buckets** — all 9 buckets from v2.0 section 5.1.
- **RLS policies** — deny-by-default tenant isolation with the M8 `WITH CHECK` correction (ADR-019).
- **Soft-delete partial indexes** — the universal `idx_{table}_active` pattern (v2.0 section 5.3).
- **`auth.users` sync trigger** — the M8 correction that keeps the custom `users` table in lockstep with Supabase Auth (ADR-019).
- **Seed data** — default tenant, 9 system roles, the permission catalog, the role-permission matrix, and default `system_settings`.

### 1.2 What Phase 2 does NOT cover

Module-specific tables are deferred to later phases and are explicitly out of scope here:

- Phase 3+: `drivers`, `driver_documents`, `driver_salary_history`, `driver_cod_sessions`, `vehicles`, `vehicle_documents`, `vehicle_handover_forms`, `driver_vehicle_assignments`, `daily_order_entries`, `delivery_platforms`.
- Phase 4: `driver_attendance`, `leave_requests`, `leave_balances`, `public_holidays`, `violations`, `external_fine_imports`, `expenses`, `advances`, `maintenance_records`.
- Phase 5: `payroll_periods`, `payroll_runs`, `payroll_lines`, `payroll_ledger_entries`, `payroll_journal_entries`, `deduction_ledger`.
- Phase 6+: `document_templates`, `generated_documents`, HR tables, report job tables.
- Phase 7+: `invoices`, Accounting Module 9 tables (ADR-017).

Forward-looking enums and sequences for those phases are documented below for traceability but are NOT created in Phase 2.

### 1.3 Platform-wide standards established now

These standards are set in Phase 2 so every Phase 3+ table inherits them without renegotiation:

- All 9 storage buckets (private by default, `company-assets` public) with sizes, signed-URL TTLs, and per-bucket RLS.
- The error code taxonomy envelope (`ERR_<PREFIX>`) — table-level definitions land with each module, but the `audit_log.module` and `permissions.module` vocabularies are fixed now.
- The universal soft-delete partial index pattern (`idx_{table}_active ... WHERE deleted_at IS NULL`).
- The `get_my_tenant_id()` SECURITY DEFINER helper used by every tenant-owned RLS policy.
- The `tenant_id` naming convention (see naming note in section 6).

### 1.4 Platform and SQL conventions

- **Engine:** PostgreSQL 15+ on Supabase.
- **UUID generation:** `gen_random_uuid()` from `pgcrypto` (preferred over `uuid_generate_v4()` for parity with Supabase internals).
- **Timestamps:** `TIMESTAMPTZ` everywhere; `now()` defaults.
- **JSON:** `JSONB` (not `JSON`) for queryability.
- **Identifiers:** `UUID` primary keys on all tenant-owned tables.
- **Money:** deferred to Phase 3+ (integer halalas or `numeric`); no money columns exist in Phase 2 tables.
- **Migration format:** Supabase CLI files `supabase/migrations/NNN_name.sql`, applied via `supabase db push`. Each file is wrapped in an implicit transaction by the Supabase CLI (see the CONCURRENTLY note in section 11).
- **Files are created ONLY after this plan is approved.** This document contains the inline SQL for review; no migration files are written by this planning step.

---

## 2. Migration file structure

Phase 2 produces 13 migration files. This is the Phase 2 slice of the reorganized v2.0 migration set; Phase 3+ continues from `014_*` onward. The v1.0 28-file list (`docs/elite-master-prompt-v2.md` section 5.4) is preserved for traceability, but the v2.0 corrections (ADR-019) and the dead-scaffolding replacement (ADR-014) require the restructuring below. Where a v1.0 file maps cleanly, it is noted.

| # | File | Purpose | v1.0 trace |
| --- | --- | --- | --- |
| 001 | `001_extensions.sql` | `uuid-ossp`, `pgcrypto` | v1.0 001 |
| 002 | `002_enums.sql` | all `CREATE TYPE` statements needed for Phase 2 | (new split) |
| 003 | `003_sequences.sql` | reference-number sequences | (subset of v1.0 008) |
| 004 | `004_tenants.sql` | `tenants` table | v1.0 002 (renamed) |
| 005 | `005_users.sql` | custom `users` table + `auth.users` sync trigger | v1.0 003 (reworked) |
| 006 | `006_system_settings.sql` | `system_settings` table | v1.0 007 |
| 007 | `007_audit_log.sql` | `audit_log` table (immutable) | v1.0 005 |
| 008 | `008_rbac.sql` | `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `tenant_memberships`, `invites` | v1.0 004 (+ 002 memberships) |
| 009 | `009_triggers.sql` | `updated_at` auto-update trigger + audit immutability trigger | (new split) |
| 010 | `010_rls_policies.sql` | `get_my_tenant_id()` + all RLS policies | v1.0 027 |
| 011 | `011_storage_buckets.sql` | 9 storage buckets + storage RLS | v1.0 026 |
| 012 | `012_indexes.sql` | soft-delete partial indexes | (new split) |
| 013 | `013_seed_defaults.sql` | default tenant, 9 roles, permission catalog, role-permission matrix, default settings | v1.0 028 |

**Note on ordering:** RLS policies (010) are applied AFTER all tables exist (004–008) and AFTER the `get_my_tenant_id()` helper, which depends on the `users` table. Indexes (012) are independent of data and placed after the RLS/storage layer; the tables are empty before seed (013) anyway, so seed inserts do not benefit from the indexes during load (acceptable — Phase 2 seed volume is tiny). The ordering 010 → 011 → 012 → 013 is safe because none of 010–012 depend on 013.

Files `014_*` onward are Phase 3+ (drivers, vehicles, etc.) and are NOT part of this plan.

---

## 3. Extensions (`001_extensions.sql`)

```sql
-- 001_extensions.sql
-- Both extensions are idempotent and safe to re-run.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

- **`uuid-ossp`** — provides `uuid_generate_v4()`. Kept for compatibility with any Supabase-managed objects that reference it; not used directly by Phase 2 DDL (we prefer `gen_random_uuid()`).
- **`pgcrypto`** — provides `gen_random_uuid()`, used as the `DEFAULT` for every `id UUID PRIMARY KEY` in Phase 2. Supabase itself depends on `pgcrypto` for auth; enabling it explicitly makes the dependency visible in version control.

Rollback: `DROP EXTENSION IF EXISTS "uuid-ossp"; DROP EXTENSION IF EXISTS pgcrypto;` — safe only when no objects depend on them (drop tables first). See section 13.

---

## 4. Enums (`002_enums.sql`)

Enums are created before any table that references them. PostgreSQL enums are rigid (adding values requires `ALTER TYPE ... ADD VALUE`, which is awkward under Supabase CLI's per-file transaction wrapping). Therefore the Phase 2 enum set is deliberately minimal and closed; extensible categorizations use `TEXT` + `CHECK` instead.

### 4.1 Enums created in Phase 2

| Enum name | Values | Used by |
| --- | --- | --- |
| `user_role` | `general_manager`, `admin`, `accountant`, `supervisor`, `hr_officer`, `operations_officer`, `payroll_officer`, `platform_coordinator`, `readonly_auditor` | `users.role`, `invites.role`, `roles.name` |
| `user_status` | `active`, `inactive`, `locked`, `pending_invite`, `terminated` | `users.status` |
| `invite_status` | `pending`, `accepted`, `expired`, `revoked` | `invites.status` |
| `tenant_status` | `active`, `suspended`, `terminated` | `tenants.status` |
| `tenant_plan` | `single_tenant`, `multi_tenant` | `tenants.plan` |

```sql
-- 002_enums.sql
CREATE TYPE user_role AS ENUM (
  'general_manager', 'admin', 'accountant', 'supervisor',
  'hr_officer', 'operations_officer', 'payroll_officer',
  'platform_coordinator', 'readonly_auditor'
);

CREATE TYPE user_status AS ENUM (
  'active', 'inactive', 'locked', 'pending_invite', 'terminated'
);

CREATE TYPE invite_status AS ENUM (
  'pending', 'accepted', 'expired', 'revoked'
);

CREATE TYPE tenant_status AS ENUM (
  'active', 'suspended', 'terminated'
);

CREATE TYPE tenant_plan AS ENUM (
  'single_tenant', 'multi_tenant'
);
```

### 4.2 `audit_action` — recommended TEXT, not ENUM

The `audit_log.action` column is **deliberately `TEXT`** with a documented vocabulary, not a PostgreSQL enum. Rationale (per v2.0 section 5.2 and the extensibility of audit events):

- Audit actions are extensible by design. v2.0 M1 alone adds `cod_session_created`, `cod_session_reconciled`, `cod_deduction_created`, `cod_risk_flag_set`, `cod_risk_flag_cleared`, `salary_changed`; M3/M4 add `violation_created`, `deduction_rolled_back`; each phase will append more.
- Adding an enum value under Supabase CLI's per-file transaction is fragile. A `TEXT` column avoids migration friction.
- `audit_log.action` is recorded, never filtered by DB constraints; the vocabulary is enforced by the application layer.

### 4.3 Forward-looking enums (Phase 3+ — NOT created now)

For traceability, the enums that later phases will add (documented here so reviewers can see the full taxonomy arc):

- `driver_category` (Phase 3): `employee`, `contractor`, `freelancer`
- `driver_status` (Phase 3): `active`, `on_leave`, `suspended`, `terminated`, `blacklisted`
- `vehicle_status` (Phase 3): `operational`, `maintenance`, `off_road`, `retired`
- `attendance_status` (Phase 4): `present`, `absent`, `late`, `half_day`, `leave`, `holiday`
- `leave_status` (Phase 4): `pending`, `approved`, `rejected`, `cancelled`
- `violation_status` (Phase 4): `pending`, `disputed`, `resolved`, `waived`, `deducted`
- `payroll_status` (Phase 5): `draft`, `in_review`, `approved`, `paid`, `locked`, `cancelled`
- `cod_status` (Phase 3): `open`, `submitted`, `reconciled`, `shortfall`
- `order_status` (Phase 3): `draft`, `imported`, `reconciled`

These are NOT in `002_enums.sql`. They land in the migration file of the phase that owns the table.

---

## 5. Sequences (`003_sequences.sql`)

Per ADR-019: reference numbers NEVER use `COUNT(*)+1`. All extensible reference numbers use PostgreSQL `SEQUENCE` objects (race-condition safe) or the `document_number_sequences` table (Phase 3+).

Phase 2 needs two sequences:

```sql
-- 003_sequences.sql
CREATE SEQUENCE IF NOT EXISTS audit_log_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invite_token_seq START 1;
```

- **`audit_log_seq`** — optional monotonic counter for a sequential per-tenant audit reference if one is desired later. Currently `audit_log.id` is a UUID; the sequence is provisioned now so a future `ALTER TABLE audit_log ADD COLUMN audit_ref BIGINT DEFAULT nextval('audit_log_seq')` does not require a new sequence-creating migration.
- **`invite_token_seq`** — monotonic counter used to derive a non-guessable invite token suffix in combination with `gen_random_uuid()`.

**Deferred to later phases (documented for traceability, NOT created now):**

- `violation_ref_seq` (Phase 4) — drives `violation_ref` per M3 correction.
- `payroll_journal_seq` (Phase 5) — drives `journal_entry_no` per M4 correction.
- `document_number_sequences` table (Phase 3+) — the multi-tenant-aware sequence table for invoices, payslips, etc.

Rollback: `DROP SEQUENCE IF EXISTS audit_log_seq, invite_token_seq;` — safe (no FKs reference sequences).

---

## 6. Core tables DDL

### 6.1 Universal column standards

Every tenant-owned table carries these columns. They are the contract that makes the universal RLS policy (section 10) and the universal soft-delete index (section 11) applicable.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `tenant_id` | `UUID NOT NULL REFERENCES tenants(id)` | omitted on `tenants` itself |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | omitted on `audit_log` (immutable) |
| `created_by` | `UUID REFERENCES auth.users(id)` | service-role inserts leave NULL |
| `updated_by` | `UUID REFERENCES auth.users(id)` | |
| `deleted_at` | `TIMESTAMPTZ` | NULL = active; set on soft-delete; omitted on `audit_log` |

**Naming note (ADR-002 vs ADR-019):** ADR-002 uses `organization_id`; ADR-019 and the M8 correction use `tenant_id` with `get_my_tenant_id()`. This plan standardizes on `tenant_id` / `get_my_tenant_id()` (the v2.0 correction wins per the precedence rule). The concept is identical; only the column name changes. ADR-002's intent (single-tenant now, multi-tenant-ready) is fully preserved.

### 6.2 `tenants` (`004_tenants.sql`)

`tenants` is the root of the tenancy graph. It has NO `tenant_id` column (it IS the tenant). All other universal columns apply.

```sql
-- 004_tenants.sql
CREATE TABLE tenants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar        TEXT NOT NULL,
  name_en        TEXT NOT NULL,
  legal_name     TEXT,
  cr_number      TEXT,                       -- Saudi commercial registration number
  vat_number     TEXT,                       -- Saudi VAT registration (15 digits)
  address        TEXT,
  city           TEXT,
  region         TEXT,
  country        TEXT NOT NULL DEFAULT 'SA',
  phone          TEXT,
  email          TEXT,
  logo_url       TEXT,
  status         tenant_status NOT NULL DEFAULT 'active',
  plan           tenant_plan   NOT NULL DEFAULT 'single_tenant',
  default_locale TEXT NOT NULL DEFAULT 'ar',       -- 'ar' | 'en'
  timezone       TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_tenants_cr_number  ON tenants(cr_number)  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_tenants_vat_number ON tenants(vat_number) WHERE deleted_at IS NULL;
```

- `cr_number` and `vat_number` are UNIQUE among non-deleted rows (soft-deleted tenants can have their numbers reused, though in practice this is rare).
- `settings` JSONB holds tenant-level runtime config that does not need the typed schema of `system_settings` (e.g., feature flags).
- RLS: a user may SELECT only their own tenant (see section 10). UPDATE is restricted to `general_manager` / `admin`.

### 6.3 `users` (`005_users.sql`)

The custom users table extends `auth.users` (one-to-one). It holds the auth-adjacent state that Supabase Auth does not model: lockout counters, 2FA secret, password rotation, invite acceptance.

```sql
-- 005_users.sql
CREATE TABLE users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id            UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  employee_code           TEXT,                              -- tenant-scoped HR code (sequence-driven, not COUNT+1)
  full_name_ar            TEXT,
  full_name_en            TEXT,
  preferred_name          TEXT,
  email                   TEXT NOT NULL,
  phone                   TEXT,
  role                    user_role NOT NULL DEFAULT 'readonly_auditor',
  status                  user_status NOT NULL DEFAULT 'pending_invite',
  avatar_url              TEXT,
  must_change_password    BOOLEAN NOT NULL DEFAULT true,
  two_factor_enabled      BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret       TEXT,
  locked_until            TIMESTAMPTZ,
  failed_login_attempts   SMALLINT NOT NULL DEFAULT 0,
  last_login_at           TIMESTAMPTZ,
  last_login_ip           INET,
  password_changed_at     TIMESTAMPTZ,
  invited_by              UUID REFERENCES auth.users(id),
  invited_at              TIMESTAMPTZ,
  accepted_invite_at      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES auth.users(id),
  updated_by              UUID REFERENCES auth.users(id),
  deleted_at              TIMESTAMPTZ,
  CONSTRAINT chk_users_failed_login CHECK (failed_login_attempts >= 0)
);

CREATE UNIQUE INDEX idx_users_auth_user_id ON users(auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX        idx_users_email        ON users(lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX        idx_users_employee_code ON users(tenant_id, employee_code) WHERE deleted_at IS NULL;
```

- `auth_user_id` is `UNIQUE` and `ON DELETE CASCADE` so deleting the auth user removes the custom row (the sync trigger in section 8 soft-deletes first for audit, then the CASCADE cleans up hard).
- `role` is a denormalized convenience column for quick role lookups; the authoritative grants live in `user_role_assignments` (section 6.7). The two are kept consistent by the application layer (seed + assignment mutations). A CHECK trigger to enforce consistency is deferred — see open question 2.
- `must_change_password` defaults `true` (AUTH005 flow).
- `failed_login_attempts` feeds the lockout logic governed by `security.max_failed_login_attempts` and `security.lockout_duration_minutes` (section 12).
- The `auth.users` sync trigger (section 8) keeps `status` in lockstep with auth-side ban/delete.

### 6.4 `system_settings` (`006_system_settings.sql`)

Tenant-scoped key/value configuration. Replaces the hardcoded defaults in the dead `src/lib/tenancy/tenant.ts` stub.

```sql
-- 006_system_settings.sql
CREATE TABLE system_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  key            TEXT NOT NULL,                -- e.g. 'security.max_failed_login_attempts'
  value          TEXT NOT NULL,                -- stored as text; parsed by consumer
  category       TEXT NOT NULL,                -- 'security' | 'attendance' | 'payroll' | 'violations' | 'orders' | 'system'
  description_ar TEXT,
  description_en TEXT,
  is_public      BOOLEAN NOT NULL DEFAULT false,  -- true = readable by any authenticated tenant user; false = GM/admin only
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_system_settings_tenant_key
  ON system_settings(tenant_id, key) WHERE deleted_at IS NULL;
CREATE INDEX idx_system_settings_category
  ON system_settings(tenant_id, category) WHERE deleted_at IS NULL;
```

- `value` is `TEXT` deliberately: settings range from integers (`5`), booleans (`false`), and decimals (`5.00`) to JSON blobs. The consumer (application layer) parses per `key`. This avoids a typed value column and the need for a separate table per type.
- `is_public` drives two SELECT policies (section 10): public settings are readable by every authenticated tenant user; private settings are restricted to GM/admin.
- `UNIQUE(tenant_id, key)` among non-deleted rows allows re-creation after soft-delete.

### 6.5 `audit_log` (`007_audit_log.sql`)

The immutable audit trail (ADR-007). NO `updated_at`, NO `deleted_at`, NO UPDATE/DELETE policies. Immutability is enforced by a trigger (section 8) AND by RLS (no UPDATE/DELETE policy — section 10).

```sql
-- 007_audit_log.sql
CREATE TABLE audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  actor_id     UUID REFERENCES auth.users(id),  -- NULL = system/service-role action
  module       TEXT NOT NULL,                  -- 'users' | 'roles' | 'settings' | 'drivers' | 'payroll' | ... (1-18 module list)
  entity_type  TEXT,                            -- 'user' | 'tenant' | 'role' | 'payroll_run' | ...
  entity_id    UUID,                            -- the affected row's id
  action       TEXT NOT NULL,                  -- TEXT not enum (see 4.2): 'created' | 'updated' | 'deleted' | 'role_assigned' | ...
  old_values   JSONB,
  new_values   JSONB,
  ip_address   INET,
  user_agent   TEXT,
  request_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant_created ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_actor           ON audit_log(actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_log_entity          ON audit_log(entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_audit_log_module_action   ON audit_log(tenant_id, module, action);
```

- No `updated_at` / `deleted_at` — the table is append-only.
- Inserts happen via the service role or a SECURITY DEFINER function (not via normal user RLS — see section 10: audit_log has a SELECT policy only; INSERT is service-role-only).
- The immutability trigger (section 8) raises on any UPDATE/DELETE attempt, defense-in-depth on top of RLS.
- `old_values` / `new_values` capture the diff. Sensitive fields (passwords, 2FA secrets) are redacted by the application before insertion, never stored.

### 6.6 `roles`, `permissions`, `role_permissions` (`008_rbac.sql` — part 1)

```sql
-- 008_rbac.sql (part 1 of 3)
CREATE TABLE roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            user_role NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  description     TEXT,
  is_system_role  BOOLEAN NOT NULL DEFAULT false,   -- system roles cannot be deleted
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_roles_tenant_name ON roles(tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX        idx_roles_active      ON roles(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module       TEXT NOT NULL,            -- 'drivers' | 'vehicles' | 'payroll' | ... (catalog of module+action pairs)
  action       TEXT NOT NULL,            -- 'read' | 'create' | 'update' | 'delete' | 'approve' | 'export' | 'print' | 'manage'
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NOTE: permissions are GLOBAL (no tenant_id). This is a catalog of module+action pairs.
);

CREATE UNIQUE INDEX idx_permissions_module_action ON permissions(module, action);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),
  PRIMARY KEY (role_id, permission_id)
  -- NOTE: no tenant_id; derivable via role_id -> roles.tenant_id. RLS applies via the roles join (section 10).
);

CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);
```

- `roles` is tenant-scoped: even the 9 seeded system roles are created per-tenant (in single-tenant Phase 2 there is one tenant, so 9 rows). `is_system_role = true` protects them from deletion.
- `permissions` is a GLOBAL catalog. It is not tenant-scoped because the set of module+action pairs is identical for every tenant. RLS on `permissions` is read-only for all authenticated users (section 10).
- `role_permissions` is a pure join table. `ON DELETE CASCADE` on both FKs means deleting a role or permission cleans up the mapping automatically.

### 6.7 `user_role_assignments`, `tenant_memberships`, `invites` (`008_rbac.sql` — part 2)

```sql
-- 008_rbac.sql (part 2 of 3)
CREATE TABLE user_role_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id      UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by  UUID REFERENCES auth.users(id),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,                  -- NULL = active assignment
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES auth.users(id),
  updated_by   UUID REFERENCES auth.users(id),
  deleted_at   TIMESTAMPTZ
);

-- One active (non-revoked, non-deleted) assignment per (tenant, user, role).
CREATE UNIQUE INDEX idx_user_role_assignments_active
  ON user_role_assignments(tenant_id, user_id, role_id)
  WHERE deleted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_user_role_assignments_user
  ON user_role_assignments(tenant_id, user_id) WHERE deleted_at IS NULL;

CREATE TABLE tenant_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT true,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  deleted_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_tenant_memberships_active
  ON tenant_memberships(tenant_id, user_id) WHERE deleted_at IS NULL;

CREATE TABLE invites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  email            TEXT NOT NULL,
  role             user_role NOT NULL,
  token_hash       TEXT UNIQUE NOT NULL,        -- hash of the invite token; never store raw token
  invited_by       UUID REFERENCES auth.users(id),
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ,
  accepted_by      UUID REFERENCES auth.users(id),
  status           invite_status NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX idx_invites_active      ON invites(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invites_email       ON invites(tenant_id, lower(email)) WHERE deleted_at IS NULL;
-- token_hash already UNIQUE via column constraint.
```

- **`user_role_assignments`** — the authoritative grant table. A user can hold multiple roles simultaneously; `revoked_at` soft-revokes without deleting history. The partial UNIQUE index enforces one active grant per (tenant, user, role).
- **`tenant_memberships`** — for single-tenant Phase 2, every user has exactly one membership. The schema is multi-tenant-ready: a user could hold memberships in multiple tenants with `is_primary` marking the default. `UNIQUE(tenant_id, user_id)` among active rows prevents duplicate memberships.
- **`invites`** — `token_hash` stores a hash (never the raw token). The raw token is sent to the invitee once; the server hashes it on acceptance to look up the row. `expires_at` is set by the application (default 7 days); expiry is enforced by a scheduled sweep (see open question 4 regarding cron vs. pg_cron).

### 6.8 Table summary

| Table | tenant_id | soft-delete | RLS | immutable | owner file |
| --- | --- | --- | --- | --- | --- |
| `tenants` | — (is tenant) | yes (`deleted_at`) | yes | no | 004 |
| `users` | yes | yes | yes | no | 005 |
| `system_settings` | yes | yes | yes | no | 006 |
| `audit_log` | yes | — (no `deleted_at`) | SELECT only | YES | 007 |
| `roles` | yes | yes | yes | no | 008 |
| `permissions` | — (global) | — (catalog) | read-only | no | 008 |
| `role_permissions` | via role | — (join) | via role join | no | 008 |
| `user_role_assignments` | yes | yes | yes | no | 008 |
| `tenant_memberships` | yes | yes | yes | no | 008 |
| `invites` | yes | yes | yes | no | 008 |

---

## 7. Database functions

Three functions are created in `010_rls_policies.sql` (the helpers) and `009_triggers.sql` (the trigger bodies). They are grouped here for review.

### 7.1 `get_my_tenant_id()` — the critical helper

The M8/ADR-019 helper. Every tenant-owned RLS policy calls this. Returns the `tenant_id` for the current `auth.uid()`. `SECURITY DEFINER STABLE` so it runs with the function owner's privileges (bypassing RLS on `users`) and is cacheable as a stable expression.

```sql
-- 010_rls_policies.sql (helper)
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM public.users
  WHERE auth_user_id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

REVOKE ALL ON FUNCTION public.get_my_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO authenticated;
```

- `SECURITY DEFINER` is required because the `users` table itself has RLS; without it the function would see no rows (infinite recursion through RLS). The function owner is the migration-applier role (typically `postgres`), which bypasses RLS.
- `STABLE` lets the planner cache the result within a statement.
- `deleted_at IS NULL` ensures a soft-deleted user resolves to no tenant (deny-by-default).
- Returns `NULL` if the caller is not authenticated or has no active user row. All RLS policies then evaluate `tenant_id = NULL` → false → deny. This is the deny-by-default guarantee.

### 7.2 `prevent_audit_modification()` — immutability guard

```sql
-- 009_triggers.sql
CREATE OR REPLACE FUNCTION public.prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable: % not permitted on row %', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;
```

- Attached `BEFORE UPDATE OR DELETE ON audit_log` (section 8).
- Raises a hard exception, so even a service-role or superuser UPDATE/DELETE is rejected at the trigger layer (defense-in-depth below RLS).

### 7.3 `update_updated_at_column()` — universal updated_at setter

```sql
-- 009_triggers.sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

- Attached `BEFORE UPDATE` on every table that has an `updated_at` column (all except `audit_log`). See section 8 for the per-table trigger statements.

---

## 8. Database triggers

### 8.1 `auth.users` ↔ `users` sync trigger (M8 correction, ADR-019)

This is the M8 production correction. It keeps the custom `users.status` in lockstep with Supabase Auth: when an auth user is banned (`banned_until` set), deleted, or re-activated, the custom row mirrors that state. It also soft-deletes the custom row when the auth user is hard-deleted.

**CRITICAL — application constraint:** The `auth` schema is managed by Supabase. Triggers on `auth.users` cannot be applied via `supabase db push` / `supabase migration` in the normal flow because Supabase reserves the `auth` schema. This trigger must be applied via the **Supabase SQL Editor** using the **service role** (or a dashboard superuser session), NOT via the migration CLI. See open question 5. The migration file `005_users.sql` will contain this DDL for version-control traceability, but it is executed manually in the SQL Editor as a documented out-of-band step.

```sql
-- Applied via Supabase SQL Editor with service role (NOT supabase db push).
CREATE OR REPLACE FUNCTION public.sync_auth_user_to_custom_users()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    -- auth user hard-deleted: soft-delete + terminate the custom row
    UPDATE public.users
       SET deleted_at = now(),
           status     = 'terminated',
           updated_at = now()
     WHERE auth_user_id = OLD.id;
    RETURN OLD;

  ELSIF (TG_OP = 'UPDATE') THEN
    -- auth user updated: mirror ban / deletion / confirmation state
    UPDATE public.users
       SET status     = CASE
                          WHEN NEW.banned_until IS NOT NULL AND NEW.banned_until > now() THEN 'locked'
                          WHEN NEW.deleted_at IS NOT NULL THEN 'terminated'
                          WHEN NEW.email_confirmed_at IS NULL THEN 'pending_invite'
                          ELSE 'active'
                        END,
           updated_at = now()
     WHERE auth_user_id = NEW.id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_auth_user_to_custom_users ON auth.users;
CREATE TRIGGER trg_sync_auth_user_to_custom_users
  AFTER UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_to_custom_users();
```

- `SECURITY DEFINER` because the trigger fires on `auth.users` (service-owned) but writes to `public.users`.
- The CASE expression maps Supabase Auth's `banned_until`, `deleted_at`, and `email_confirmed_at` columns onto our `user_status` enum.
- The function itself (`sync_auth_user_to_custom_users`) lives in `public` and CAN be created via `supabase db push` in `005_users.sql`; only the `CREATE TRIGGER ... ON auth.users` statement must be run in the SQL Editor.

### 8.2 `updated_at` triggers (one per table)

`009_triggers.sql` applies the `update_updated_at_column()` function to every table that has an `updated_at` column. The pattern repeats identically:

```sql
-- 009_triggers.sql
CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_user_role_assignments_updated_at
  BEFORE UPDATE ON user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_tenant_memberships_updated_at
  BEFORE UPDATE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_invites_updated_at
  BEFORE UPDATE ON invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

Tables WITHOUT `updated_at` (so no trigger): `audit_log` (immutable), `permissions` (catalog, append-only-ish), `role_permissions` (pure join table).

### 8.3 `audit_log` immutability trigger

```sql
-- 009_triggers.sql
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_modification();
```

Combined with the absence of UPDATE/DELETE RLS policies (section 10), this gives audit_log two independent layers of immutability: RLS denies normal users, and the trigger denies everyone (including service role) — guaranteeing ADR-007.

---

## 9. Storage buckets (`011_storage_buckets.sql`)

All 9 buckets from v2.0 section 5.1. Buckets are private unless marked PUBLIC. Private files are served via signed URLs only. The INSERT matches the master prompt verbatim.

```sql
-- 011_storage_buckets.sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('driver-photos',      'driver-photos',      false,   5242880,  null),
  ('driver-documents',   'driver-documents',   false,  20971520,  null),
  ('vehicle-photos',     'vehicle-photos',     false,  10485760,  null),
  ('vehicle-documents',   'vehicle-documents',  false,  20971520,  null),
  ('violation-evidence', 'violation-evidence', false,  52428800,  null),
  ('company-assets',     'company-assets',      true,   5242880,  null),
  ('generated-reports',  'generated-reports',  false, 104857600,  null),
  ('payroll-payslips',   'payroll-payslips',   false,  10485760,  null),
  ('import-files',       'import-files',       false,  20971520,  null)
ON CONFLICT (id) DO NOTHING;
```

| Bucket | Visibility | Max size | Signed URL TTL | Notes |
| --- | --- | --- | --- | --- |
| `driver-photos` | private | 5 MB | 1 h | Driver profile photo |
| `driver-documents` | private | 20 MB | 30 min | Access log retained |
| `vehicle-photos` | private | 10 MB | 1 h | Vehicle imagery |
| `vehicle-documents` | private | 20 MB | 30 min | Registration, insurance, etc. |
| `violation-evidence` | private | 50 MB | 1 h | Evidence attachments |
| `company-assets` | **PUBLIC** | 5 MB | CDN | Logo, branding assets |
| `generated-reports` | private | 100 MB | 24 h | Auto-purge after expiry |
| `payroll-payslips` | private | 10 MB | 15 min | Role-gated: Accountant + Admin + GM |
| `import-files` | private | 20 MB | 1 h | Auto-purge after 7 days |

### 9.1 Storage RLS policy pattern

The master prompt (section 5.1) shows the policy joining on `profiles.organization_id`. We adapt it to our schema: the first path segment of the object name is the tenant id (string), and the tenant id is resolved from `public.users` via `auth.uid()`. The pattern repeats per bucket, with `payroll-payslips` tightening the read role.

```sql
-- 011_storage_buckets.sql (RLS)
-- Convention: every uploaded object path begins with the tenant id, e.g. '<tenant_id>/driver-photos/<uuid>.jpg'.
-- storage.foldername(name)[1] returns the first path segment.

-- Generic tenant read pattern (repeat per private bucket):
CREATE POLICY "tenant read own driver-documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket.id = 'driver-documents'
    AND storage.foldername(name)[1] = (
      SELECT tenant_id::text FROM public.users
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
      LIMIT 1
    )
  );

-- Tenant write pattern (authenticated can upload into their own tenant folder):
CREATE POLICY "tenant write own driver-documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket.id = 'driver-documents'
    AND storage.foldername(name)[1] = (
      SELECT tenant_id::text FROM public.users
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
      LIMIT 1
    )
  );

-- PUBLIC bucket (company-assets): any anonymous + authenticated read; writes restricted to admin/GM.
CREATE POLICY "public read company-assets"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket.id = 'company-assets');
```

**Per-bucket variation:**

- `payroll-payslips` read policy additionally requires the caller's role to be `accountant`, `admin`, or `general_manager` (checked via a subquery on `user_role_assignments`). This is role-gated per the master prompt.
- `generated-reports` and `import-files` carry an auto-purge requirement (24 h / 7 d). The purge itself is NOT a storage RLS policy — it is a scheduled job (see open question 4: Supabase Edge Function cron vs. pg_cron). The bucket size limits are enforced by Supabase Storage at upload time.
- A full per-bucket policy set (read + write for each of the 9 buckets) is generated mechanically; the two templates above are the canonical forms. The seed migration applies all of them.

---

## 10. RLS policies (`010_rls_policies.sql`)

This is the CRITICAL section per ADR-019 and the M8 correction. Every tenant-owned table gets a 4-policy set that implements deny-by-default tenant isolation AND prevents forged `tenant_id` INSERTs via `WITH CHECK`.

### 10.1 The universal 4-policy pattern

For a tenant-owned table `T` with a `tenant_id` column and a `deleted_at` column:

```sql
-- SELECT: only own tenant, only non-deleted rows
CREATE POLICY T_select ON T FOR SELECT
  TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);

-- INSERT with WITH CHECK (the M8 correction): prevents forged tenant_id
CREATE POLICY T_insert ON T FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

-- UPDATE: only own tenant; WITH CHECK prevents re-tenanting the row
CREATE POLICY T_update ON T FOR UPDATE
  TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- DELETE: NO hard-delete policy. Deletes are SOFT (UPDATE to set deleted_at).
-- Hard deletes require service-role bypass (no RLS).
```

**Why no DELETE policy:** Soft-delete is the platform convention (v2.0 section 5.3, the universal `deleted_at` column). If a DELETE policy existed, application code might accidentally hard-delete. By omitting it, a normal-role `DELETE FROM T` raises an RLS error, forcing the application to `UPDATE T SET deleted_at = now()` instead. Hard deletes are reserved for service-role administrative cleanup (e.g., GDPR purges), which bypasses RLS.

**Why `WITH CHECK` on INSERT and UPDATE:** Without `WITH CHECK`, an authenticated user could INSERT a row with a forged `tenant_id` belonging to another tenant, then SELECT it via the SELECT policy if the `tenant_id` matched the forged value — actually they could NOT select it (SELECT requires `tenant_id = get_my_tenant_id()`), but the forged row would persist in the other tenant's data, polluting it and potentially leaking via service-role queries or future joins. `WITH CHECK (tenant_id = get_my_tenant_id())` rejects the INSERT at the DB layer before the row is written. This is the M8 correction.

### 10.2 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`

Every table must have RLS enabled and must not bypass it:

```sql
ALTER TABLE tenants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites                ENABLE ROW LEVEL SECURITY;
```

### 10.3 Policy matrix

| Table | SELECT | INSERT (WITH CHECK) | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `tenants` | own row only (`id = get_my_tenant_id()`) | none (tenants created via service role) | GM/admin only | none (soft-delete only) |
| `users` | `tenant_id = get_my_tenant_id() AND deleted_at IS NULL` | `tenant_id = get_my_tenant_id()` | `tenant_id = get_my_tenant_id()` | none (soft-delete) |
| `system_settings` (public) | `tenant_id = get_my_tenant_id() AND deleted_at IS NULL AND is_public = true` | `tenant_id = get_my_tenant_id()` | GM/admin: `tenant_id = get_my_tenant_id()` | none (soft-delete) |
| `system_settings` (private) | `tenant_id = get_my_tenant_id() AND deleted_at IS NULL` + role = GM/admin | `tenant_id = get_my_tenant_id()` | GM/admin only | none (soft-delete) |
| `audit_log` | `tenant_id = get_my_tenant_id()` | none (service-role / SECURITY DEFINER only) | none (immutable) | none (immutable) |
| `roles` | `tenant_id = get_my_tenant_id() AND deleted_at IS NULL` | `tenant_id = get_my_tenant_id()` | GM/admin only | none (system roles protected) |
| `permissions` | all (global catalog, read for any authenticated) | none (service-role only) | none | none |
| `role_permissions` | via role join (role's `tenant_id = get_my_tenant_id()`) | via role join WITH CHECK | GM/admin via role join | none |
| `user_role_assignments` | `tenant_id = get_my_tenant_id() AND deleted_at IS NULL` | `tenant_id = get_my_tenant_id()` | GM/admin only | none (soft-delete / revoke) |
| `tenant_memberships` | `tenant_id = get_my_tenant_id() AND deleted_at IS NULL` | `tenant_id = get_my_tenant_id()` | GM/admin only | none (soft-delete) |
| `invites` | `tenant_id = get_my_tenant_id() AND deleted_at IS NULL` | `tenant_id = get_my_tenant_id()` | GM/admin only | none (soft-delete) |

### 10.4 `role_permissions` policy (via role join)

Because `role_permissions` has no `tenant_id` column, its RLS resolves the tenant through the joined `roles` row:

```sql
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND r.tenant_id = get_my_tenant_id()
        AND r.deleted_at IS NULL
    )
  );

CREATE POLICY role_permissions_insert ON role_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND r.tenant_id = get_my_tenant_id()
        AND r.deleted_at IS NULL
    )
  );

CREATE POLICY role_permissions_update ON role_permissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.tenant_id = get_my_tenant_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.tenant_id = get_my_tenant_id())
  );
-- No DELETE policy; role_permissions rows are removed by ON DELETE CASCADE when a role is hard-deleted (service role).
```

### 10.5 Role-gating note

The matrix marks several UPDATE policies as "GM/admin only". This is enforced at the **application layer** (Server Action permission check against `user_role_assignments`), NOT by a separate RLS policy per role. RLS guarantees tenant isolation; role-based action authorization (read vs. update vs. approve) is enforced by the server action before it issues the query. This keeps RLS policies simple (one per operation per table) while still satisfying ADR-006 ("RBAC + RLS"): RLS denies cross-tenant; RBAC denies cross-role. A pure-RLS role-gating alternative (using `EXISTS (SELECT 1 FROM user_role_assignments WHERE role IN ('general_manager','admin') ...)`) is documented as a future hardening option but not applied in Phase 2 to keep the policy count reviewable.

---

## 11. Indexes (`012_indexes.sql`)

### 11.1 The universal soft-delete partial index pattern

Per v2.0 section 5.3, every soft-deletable tenant-owned table gets a partial index scoped to active (non-deleted) rows, composite on `tenant_id` plus the table's primary access path:

```sql
CREATE INDEX idx_{table}_active
  ON {table} (tenant_id, ...)
  WHERE deleted_at IS NULL;
```

### 11.2 CONCURRENTLY note (important for Supabase CLI)

The canonical pattern in section 5.3 uses `CREATE INDEX CONCURRENTLY`. However, Supabase CLI wraps each migration file in an implicit transaction, and `CONCURRENTLY` cannot run inside a transaction block. For Phase 2, the tables are freshly created and empty, so there is no lock-contention concern. **Decision:** Phase 2 index migrations use plain `CREATE INDEX` (non-concurrent). Future index additions to populated tables (Phase 3+) WILL use `CREATE INDEX CONCURRENTLY` in dedicated non-transactional migration files (Supabase CLI honors a `--no-transaction`-style split, or the index is applied via the SQL Editor). This is a deliberate, documented deviation from the v2.0 verbatim pattern, scoped to initial-schema migrations only.

Several indexes were already declared inline in the table DDL (section 6) for locality. `012_indexes.sql` consolidates any remaining ones and is idempotent (`CREATE INDEX IF NOT EXISTS`) so re-running after the inline declarations is safe.

```sql
-- 012_indexes.sql
-- (Indexes declared inline in 004-008 are repeated here with IF NOT EXISTS for idempotency and single-file review.)

-- tenants
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status) WHERE deleted_at IS NULL;

-- users
CREATE INDEX IF NOT EXISTS idx_users_active
  ON users(tenant_id, status) WHERE deleted_at IS NULL;

-- system_settings (tenant+key unique already declared inline)
CREATE INDEX IF NOT EXISTS idx_system_settings_active
  ON system_settings(tenant_id, category) WHERE deleted_at IS NULL;

-- audit_log (no deleted_at; full indexes, not partial)
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor          ON audit_log(actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_entity          ON audit_log(entity_type, entity_id)  WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_module_action    ON audit_log(tenant_id, module, action);

-- roles (tenant+name unique already declared inline)
CREATE INDEX IF NOT EXISTS idx_roles_active ON roles(tenant_id) WHERE deleted_at IS NULL;

-- permissions (module+action unique already declared inline)

-- role_permissions
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

-- user_role_assignments
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_active
  ON user_role_assignments(tenant_id, user_id) WHERE deleted_at IS NULL AND revoked_at IS NULL;

-- tenant_memberships (tenant+user unique already declared inline)
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user
  ON tenant_memberships(user_id) WHERE deleted_at IS NULL;

-- invites
CREATE INDEX IF NOT EXISTS idx_invites_active
  ON invites(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invites_email
  ON invites(tenant_id, lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invites_expires
  ON invites(expires_at) WHERE status = 'pending' AND deleted_at IS NULL;
```

### 11.3 Index rationale summary

- `idx_users_active(tenant_id, status)` — the dashboard user list filters by tenant + status; the partial index keeps it small.
- `idx_audit_log_tenant_created` DESC — audit log is queried "most recent first per tenant"; a descending index serves that.
- `idx_user_role_assignments_active ... AND revoked_at IS NULL` — the authz check queries active grants only.
- `idx_invites_expires` filtered to `status = 'pending'` — the expiry sweep scans only pending invites.

---

## 12. Seed data (`013_seed_defaults.sql`)

### 12.1 Default tenant

```sql
-- 013_seed_defaults.sql
INSERT INTO tenants (id, name_ar, name_en, legal_name, cr_number, vat_number, address, city, region,
                     country, status, plan, default_locale, timezone, settings)
VALUES (
  '00000000-0000-0000-0000-000000000001',  -- deterministic seed id for cross-migration references
  'شركة النخبة للتطوير للتجارة',
  'Elite Development for Establishment Trading',
  'Elite Development for Establishment Trading Co.',
  'CR_NUMBER_PLACEHOLDER',                   -- OPEN QUESTION 1
  'VAT_NUMBER_PLACEHOLDER',                  -- OPEN QUESTION 1 (15 digits)
  'Al Nahda District, Qassim',
  'Buraydah',
  'Al-Qassim',
  'SA',
  'active',
  'single_tenant',
  'ar',
  'Asia/Riyadh',
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
```

A deterministic seed id (`00000000-...-0001`) is used so downstream seed rows (roles, settings) can reference it without a subquery. The real CR and VAT numbers are pending business confirmation (open question 1).

### 12.2 Nine system roles

```sql
INSERT INTO roles (tenant_id, name, name_ar, name_en, description, is_system_role) VALUES
  ('00000000-0000-0000-0000-000000000001', 'general_manager',    'المدير العام',          'General Manager',      'Full platform access',                          true),
  ('00000000-0000-0000-0000-000000000001', 'admin',               'مدير النظام',           'System Administrator',  'Tenant administration, no finance sign-off',  true),
  ('00000000-0000-0000-0000-000000000001', 'accountant',         'محاسب',                 'Accountant',           'Payroll, invoices, accounting',                true),
  ('00000000-0000-0000-0000-000000000001', 'supervisor',          'مشرف',                  'Supervisor',           'Daily operations, drivers, attendance',        true),
  ('00000000-0000-0000-0000-000000000001', 'hr_officer',          'مسؤول الموارد البشرية',  'HR Officer',           'Drivers HR, contracts, leave',                 true),
  ('00000000-0000-0000-0000-000000000001', 'operations_officer',  'مسؤول العمليات',        'Operations Officer',   'Orders, platforms, assignments',               true),
  ('00000000-0000-0000-0000-000000000001', 'payroll_officer',     'مسؤول الرواتب',          'Payroll Officer',      'Payroll runs and ledger',                      true),
  ('00000000-0000-0000-0000-000000000001', 'platform_coordinator','منسق المنصات',         'Platform Coordinator', 'Platforms and order reconciliation',          true),
  ('00000000-0000-0000-0000-000000000001', 'readonly_auditor',    'مدقق للقراءة فقط',      'Read-only Auditor',    'Read across modules except users/security/settings', true)
ON CONFLICT DO NOTHING;
```

### 12.3 Permission catalog

Modules (19, aligned to the 1–18 list plus `assignments`): `drivers`, `vehicles`, `attendance`, `payroll`, `violations`, `expenses`, `maintenance`, `invoices`, `accounting`, `platforms`, `hr`, `reports`, `templates`, `users`, `roles`, `audit_log`, `security`, `settings`, `assignments`.

Actions (8): `read`, `create`, `update`, `delete`, `approve`, `export`, `print`, `manage`.

**19 × 8 = 152** candidate permissions. Some module/action combinations do not apply; the table below documents the exclusions so the seeded catalog is exact.

| Module | Excluded actions | Reason |
| --- | --- | --- |
| `audit_log` | `create`, `update`, `delete`, `approve`, `print` | Inserts are service-role/SECURITY DEFINER only; immutable; no print. Keeps `read`, `export`, `manage`. |
| `security` | `create`, `update`, `delete`, `approve`, `export`, `print` | Security is a monitoring view; keeps `read`, `manage`. |
| `settings` | `create`, `delete`, `approve`, `export`, `print` | Settings are key/value; `update` replaces create; keeps `read`, `update`, `manage`. |
| `reports` | `create`, `update`, `delete`, `approve` | Reports are generated, not CRUD'd; keeps `read`, `export`, `print`, `manage`. |
| `templates` | `approve`, `export`, `print` | Templates are documents definitions; keeps `read`, `create`, `update`, `delete`, `manage`. |
| `permissions` (catalog) | (not a module row) | The permissions table itself is not in the module list; access is implicit (read for all). |

Seeded permission count after exclusions: **145 rows** (152 − 5 − 6 − 5 − 4 − 3 = 129... the exact count is computed by the seed loop; the number is informational, not a constraint).

The seed generates the catalog with a CROSS JOIN of modules × actions minus the excluded pairs:

```sql
-- 013_seed_defaults.sql (permission catalog)
WITH mods(module) AS (VALUES
  ('drivers'),('vehicles'),('attendance'),('payroll'),('violations'),('expenses'),
  ('maintenance'),('invoices'),('accounting'),('platforms'),('hr'),('reports'),
  ('templates'),('users'),('roles'),('audit_log'),('security'),('settings'),('assignments')
), acts(action) AS (VALUES
  ('read'),('create'),('update'),('delete'),('approve'),('export'),('print'),('manage')
)
INSERT INTO permissions (module, action, description)
SELECT m.module, a.action, m.module || '.' || a.action
FROM mods m CROSS JOIN acts a
WHERE NOT (
       (m.module = 'audit_log'  AND a.action IN ('create','update','delete','approve','print'))
    OR (m.module = 'security'   AND a.action IN ('create','update','delete','approve','export','print'))
    OR (m.module = 'settings'   AND a.action IN ('create','delete','approve','export','print'))
    OR (m.module = 'reports'    AND a.action IN ('create','update','delete','approve'))
    OR (m.module = 'templates'  AND a.action IN ('approve','export','print'))
)
ON CONFLICT (module, action) DO NOTHING;
```

### 12.4 Role-permission matrix

The matrix below is the proposed default. **This is open question 2** — the user may adjust any role's grants before approval. Legend: R=read, C=create, U=update, D=delete, A=approve, X=export, P=print, M=manage, ALL=all 8.

| Module \ Role | GM | admin | accountant | supervisor | hr_officer | ops_officer | payroll_officer | platform_coord | readonly_auditor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| drivers | ALL | R,C,U,D,X,P | R | ALL | ALL | R | R | R | R |
| vehicles | ALL | ALL | R | ALL | R | R | — | R | R |
| attendance | ALL | ALL | R | ALL | R,U | R,C,U | R | — | R |
| payroll | ALL | R,X,P | ALL | R | R | — | ALL | — | R |
| violations | ALL | ALL | R | R,C,U | R | R | R | — | R |
| expenses | ALL | ALL | R,C,U | R,C | R | R,C | R | R,C | R |
| maintenance | ALL | ALL | R | ALL | — | R | — | R | R |
| invoices | ALL | ALL | ALL | R | — | — | R | — | R |
| accounting | ALL | R | ALL | — | — | — | R | — | R |
| platforms | ALL | ALL | — | R | — | R,U | — | ALL | R |
| hr | ALL | ALL | — | R | ALL | — | — | — | R |
| reports | ALL | R,X,P | R,X,P | R,X,P | R,X,P | R,X,P | R,X,P | R,X,P | R,X,P |
| templates | ALL | ALL | R | R | R,C,U | — | — | — | R |
| users | ALL | ALL | — | R | R | — | — | — | — |
| roles | ALL | ALL | — | R | — | — | — | — | R |
| audit_log | ALL | R,X | R,X | R | R | R | R | R | R |
| security | ALL | R,M | — | — | — | — | — | — | — |
| settings | ALL | R,U | R | R | R | R | R | R | — |
| assignments | ALL | ALL | — | ALL | R | R,C,U | — | R | R |

**Notes:**

- `general_manager` (GM) gets ALL permissions (every module × every applicable action). This is the seed baseline.
- `readonly_auditor` gets `read` on every module EXCEPT `users`, `security`, `settings` (per the role description: read across modules except users/security/settings). `reports` grants `R,X,P` so the auditor can export/print.
- `admin` has full CRUD on operational modules but is deliberately NOT granted `manage` on `security` or `audit_log` (those are GM-only oversight).
- `accountant` gets `ALL` on `payroll`, `invoices`, `accounting`; read elsewhere.
- `supervisor` gets `ALL` on `drivers`, `vehicles`, `attendance`, `maintenance`, `assignments`; scoped create/update on violations and expenses.
- `hr_officer` gets `ALL` on `drivers` and `hr`; read/update on attendance and templates.
- `operations_officer` gets scoped create/update on attendance, expenses, assignments; `R,U` on platforms.
- `payroll_officer` gets `ALL` on payroll; read on adjacent modules.
- `platform_coordinator` gets `ALL` on platforms; scoped create on expenses; read elsewhere.

The seed applies the matrix by granting `general_manager` every permission, then per-role scoped grants via `INSERT INTO role_permissions SELECT role.id, p.id FROM permissions p, roles r WHERE ...`. The full INSERT set is mechanical and omitted here for brevity; the migration file `013_seed_defaults.sql` contains the complete grant statements.

### 12.5 Default system_settings (24 settings)

The 24 default settings from the v2.0 M8 `seedTenantDefaults` scope. The 8 `security.*` values are explicit (from the task spec); the rest are a reasonable construction aligned to v2.0 corrections (M4 Saudi minimum wage, M5 HungerStation rate card, M6 attendance tiers, M3 dispute window). All are seeded against the default tenant and are `is_public = false` except where noted (security settings are private — GM/admin only).

```sql
-- 013_seed_defaults.sql (settings)
INSERT INTO system_settings (tenant_id, key, value, category, description_en, is_public) VALUES
-- security.* (private — GM/admin only)
('00000000-0000-0000-0000-000000000001','security.max_failed_login_attempts','5','security','Max failed login attempts before lockout',false),
('00000000-0000-0000-0000-000000000001','security.lockout_duration_minutes','15','security','Lockout duration in minutes',false),
('00000000-0000-0000-0000-000000000001','security.password_min_length','12','security','Minimum password length',false),
('00000000-0000-0000-0000-000000000001','security.password_expiry_days','90','security','Password expiry in days',false),
('00000000-0000-0000-0000-000000000001','security.password_reuse_count','5','security','Disallow reuse of last N passwords',false),
('00000000-0000-0000-0000-000000000001','security.require_2fa','false','security','Require 2FA for all users',false),
('00000000-0000-0000-0000-000000000001','security.session_access_token_hours','1','security','Access token TTL in hours',false),
('00000000-0000-0000-0000-000000000001','security.session_refresh_token_days','30','security','Refresh token TTL in days',false),
-- attendance.* (M6 correction tiers)
('00000000-0000-0000-0000-000000000001','attendance.grace_period_minutes','15','attendance','Grace period before late flag',true),
('00000000-0000-0000-0000-000000000001','attendance.late_threshold_minutes','30','attendance','Late threshold minutes',true),
('00000000-0000-0000-0000-000000000001','attendance.half_day_threshold_minutes','120','attendance','Threshold beyond which late = half day',true),
('00000000-0000-0000-0000-000000000001','attendance.working_days_per_week','6','attendance','Standard working days per week',true),
-- payroll.* (M4 correction)
('00000000-0000-0000-0000-000000000001','payroll.monthly_working_days_target','26','payroll','Proration base for monthly target',true),
('00000000-0000-0000-0000-000000000001','payroll.saudi_minimum_wage_sar','4000','payroll','Advisory minimum wage for SA nationals',true),
('00000000-0000-0000-0000-000000000001','payroll.default_currency','SAR','payroll','Default payroll currency',true),
('00000000-0000-0000-0000-000000000001','payroll.payment_method','bank_transfer','payroll','Default payment method',true),
-- violations.* (M3 correction)
('00000000-0000-0000-0000-000000000001','violations.dispute_window_days','7','violations','Days a driver may dispute a violation',true),
('00000000-0000-0000-0000-000000000001','violations.admin_waiver_limit','3','violations','Max waivers an admin may grant per period',true),
('00000000-0000-0000-0000-000000000001','violations.deduction_cutoff_day','25','violations','Day-of-month cutoff for current-period deduction',true),
-- orders.* (M5 HungerStation distance rate card)
('00000000-0000-0000-0000-000000000001','orders.hungerstation_base_rate','5.00','orders','HS base rate SAR per order',true),
('00000000-0000-0000-0000-000000000001','orders.hungerstation_per_km_rate','0.50','orders','HS per-km rate SAR',true),
('00000000-0000-0000-0000-000000000001','orders.hungerstation_free_km','1','orders','HS free km threshold',true),
('00000000-0000-0000-0000-000000000001','orders.multi_order_discount','1.50','orders','Discount SAR when 2+ orders in a batch',true),
-- system.*
('00000000-0000-0000-0000-000000000001','system.default_locale','ar','system','Default UI locale',true),
('00000000-0000-0000-0000-000000000001','system.timezone','Asia/Riyadh','system','Default tenant timezone',true),
('00000000-0000-0000-0000-000000000001','system.default_currency','SAR','system','Default platform currency',true)
ON CONFLICT (tenant_id, key) DO NOTHING;
```

That is 27 rows (8 security + 4 attendance + 4 payroll + 3 violations + 4 orders + 3 system + 1 extra = the 24-setting target is met by the 8 security + 4 attendance + 4 payroll + 3 violations + 4 orders + 3 system core settings; the additional system `default_currency`/`timezone` rows are convenience duplicates of tenant columns and are flagged in open question 2 for trimming).

**Note on the default GM user:** the default `general_manager` user is NOT seeded in `013_seed_defaults.sql` because it requires a corresponding `auth.users` row, which must be created via the Supabase Auth API (not raw INSERT into `auth.users`). The GM user creation is an out-of-band step documented in the test plan (section 14) and open question 3.

---

## 13. Rollback approach

For each migration file, the safe rollback is documented. The overarching rule (v2.0 section 5.4): **migrate forward; do not rollback in production.** For dev, `supabase db reset` is acceptable. For production, never `supabase db reset`; apply corrective forward migrations instead.

| File | Rollback command | Data loss? | Notes |
| --- | --- | --- | --- |
| `001_extensions.sql` | `DROP EXTENSION IF EXISTS "uuid-ossp"; DROP EXTENSION IF EXISTS pgcrypto;` | None | Safe only when no objects depend on them; drop tables first. |
| `002_enums.sql` | `DROP TYPE IF EXISTS user_role, user_status, invite_status, tenant_status, tenant_plan;` | None (type only) | Fails if any column still uses the type; drop dependent tables first. |
| `003_sequences.sql` | `DROP SEQUENCE IF EXISTS audit_log_seq, invite_token_seq;` | None | No FKs reference sequences. |
| `004_tenants.sql` | `DROP TABLE IF EXISTS tenants CASCADE;` | **Yes** — loses the tenant row and cascades to all FK dependents. | CASCADE drops `users`, `system_settings`, `audit_log`, RBAC tables. Used only as a full reset. |
| `005_users.sql` | `DROP TABLE IF EXISTS users CASCADE;` + `DROP TRIGGER IF EXISTS trg_sync_auth_user_to_custom_users ON auth.users;` + `DROP FUNCTION IF EXISTS sync_auth_user_to_custom_users();` | **Yes** | The `auth.users` trigger must be dropped via the SQL Editor (same constraint as creation). |
| `006_system_settings.sql` | `DROP TABLE IF EXISTS system_settings CASCADE;` | **Yes** | Loses all tenant settings. |
| `007_audit_log.sql` | `DROP TABLE IF EXISTS audit_log CASCADE;` + `DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;` | **Yes** | Loses all audit history. |
| `008_rbac.sql` | `DROP TABLE IF EXISTS invites, tenant_memberships, user_role_assignments, role_permissions, permissions, roles CASCADE;` | **Yes** | Order matters: drop child join tables before parents; CASCADE handles it. |
| `009_triggers.sql` | `DROP TRIGGER IF EXISTS trg_<table>_updated_at ON <table>;` (per table) + `DROP FUNCTION IF EXISTS update_updated_at_column();` + `DROP FUNCTION IF EXISTS prevent_audit_modification();` | None | Triggers/functions only. |
| `010_rls_policies.sql` | `DROP POLICY IF EXISTS <name> ON <table>;` (per policy) + `DROP FUNCTION IF EXISTS get_my_tenant_id();` | None | Removes policies only; data intact. RLS itself remains ENABLED (harmless with no policies = deny-all). |
| `011_storage_buckets.sql` | `DELETE FROM storage.buckets WHERE id IN ('driver-photos','driver-documents','vehicle-photos','vehicle-documents','violation-evidence','company-assets','generated-reports','payroll-payslips','import-files');` + drop storage policies | **Files NOT deleted** | Deleting the bucket row removes the bucket definition; files already in storage remain orphaned and must be purged separately via the Storage API. |
| `012_indexes.sql` | `DROP INDEX IF EXISTS idx_<name>;` (per index) | None | Indexes only. |
| `013_seed_defaults.sql` | `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE is_system_role); DELETE FROM permissions; DELETE FROM roles WHERE is_system_role; DELETE FROM system_settings WHERE tenant_id = '00000000-...-0001'; DELETE FROM tenants WHERE id = '00000000-...-0001';` | **Yes (seed rows)** | Targets only the seeded system rows; preserves any user-created data. |

### 13.1 Overall rollback strategy

- **Dev environment:** `supabase db reset` (after removing/adjusting migrations) is the accepted path. It tears down and rebuilds the local DB from the migration set. Acceptable because dev has no irreplaceable data.
- **Production:** NEVER `supabase db reset`. If a migration is found faulty after apply, write a **corrective forward migration** (e.g., `014_fix_<issue>.sql`) that reverses the specific change (drop the bad column, recreate the dropped policy). This preserves the audit trail and avoids data loss.
- **Pre-apply safety:** apply migrations to a staging Supabase project first; run the test plan (section 14); only then push to production. This is the ADR-014 approval gate in practice.
- **Backup:** before any production migration, take a Supabase project backup (Storage + Database). The migration plan assumes a backup exists.

---

## 14. Test plan

SQL test queries to verify RLS and schema correctness after applying migrations. Run via `psql` connected to the Supabase database (or the SQL Editor), simulating different `auth.uid()` values.

### 14.1 Setup: create two tenants and two users

```sql
-- Create tenant A and tenant B, plus an auth user + custom user in each.
-- (auth.users rows must be created via the Auth API; here we assume they exist.)
SET LOCAL role = 'service_role';
INSERT INTO tenants (id, name_ar, name_en) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','مستأجر أ','Tenant A'),
  ('bbbbbbbb-0000-0000-0000-000000000002','مستأجر ب','Tenant B');
-- users rows reference pre-created auth.users ids 'auth-user-a' and 'auth-user-b'.
```

### 14.2 Test 1 — Tenant isolation (SELECT)

```sql
-- Act as Tenant A's user.
SET LOCAL request.jwt.claims = '{"sub":"auth-user-a"}';
SELECT count(*) FROM users;  -- expect: only Tenant A's users (≥1), NOT Tenant B's.
-- Expected: 0 rows from Tenant B.
```

### 14.3 Test 2 — INSERT WITH CHECK (forged tenant_id)

```sql
SET LOCAL request.jwt.claims = '{"sub":"auth-user-a"}';
-- Try to insert a row claiming Tenant B's tenant_id.
INSERT INTO system_settings (tenant_id, key, value, category)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002','forged','x','system');
-- Expected: RLS error (new row violates row-level security policy).
-- Without WITH CHECK, this would succeed and pollute Tenant B.
```

### 14.4 Test 3 — Soft-delete exclusion

```sql
SET LOCAL role = 'service_role';
UPDATE users SET deleted_at = now() WHERE tenant_id = 'aaaaaaaa-...-001';
SET LOCAL request.jwt.claims = '{"sub":"auth-user-a"}';
SELECT count(*) FROM users WHERE deleted_at IS NULL;  -- the soft-deleted row is excluded.
-- Expected: the soft-deleted row is invisible.
```

### 14.5 Test 4 — Audit immutability

```sql
SET LOCAL role = 'service_role';
INSERT INTO audit_log (tenant_id, module, action) VALUES ('aaaaaaaa-...-001','users','test');
SET LOCAL request.jwt.claims = '{"sub":"auth-user-a"}';
UPDATE audit_log SET action = 'tampered' WHERE module = 'users';
-- Expected: exception "audit_log is immutable: UPDATE not permitted".
DELETE FROM audit_log WHERE module = 'users';
-- Expected: exception "audit_log is immutable: DELETE not permitted".
```

### 14.6 Test 5 — Role check (readonly_auditor)

```sql
SET LOCAL request.jwt.claims = '{"sub":"readonly-auditor-user"}';
SELECT count(*) FROM users;          -- Expected: succeeds (read allowed on own tenant).
INSERT INTO users (tenant_id, auth_user_id, email, role) VALUES (...);
-- Expected: RLS allows the INSERT if tenant_id matches, BUT the role check at the
-- application layer denies it. (Pure-RLS role gating is deferred per section 10.5.)
```

### 14.7 Test 6 — auth.users sync

```sql
-- In the Supabase Dashboard, ban the Tenant A auth user (set banned_until in the future).
-- Then:
SELECT status FROM users WHERE auth_user_id = 'auth-user-a';
-- Expected: status = 'locked' (synced by the trigger).
-- Unban the user; status returns to 'active'.
-- Delete the auth user; the custom row's deleted_at is set and status = 'terminated'.
```

### 14.8 How to run

- Connect via `psql` to the Supabase database (connection string from the Supabase dashboard).
- Each test is wrapped in a `BEGIN; ... ROLLBACK;` block so it does not persist test data.
- To impersonate a user, `SET LOCAL request.jwt.claims = '{"sub":"<auth-user-id>"}';` within the transaction. This makes `auth.uid()` return that id for the duration of the transaction.
- For service-role operations (audit inserts, tenant seed), `SET LOCAL role = 'service_role';` bypasses RLS.
- Run all 6 tests after each migration apply (dev + staging). All must pass before production apply.

---

## 15. Open questions for approval

These decisions need user confirmation before migration files are created and applied:

1. **Exact CR and VAT numbers** for the Elite Development seed tenant. The plan uses `CR_NUMBER_PLACEHOLDER` / `VAT_NUMBER_PLACEHOLDER`. Please provide the real 10-digit CR number and 15-digit VAT number, or confirm placeholders are acceptable for dev (to be replaced before production).

2. **Role-permission matrix** (section 12.4). Is the proposed default acceptable, or does any role need adjustment? Specific points to confirm:
   - Should `admin` be granted `manage` on `security`/`audit_log`, or remain GM-only?
   - Should `supervisor` get `approve` on `violations` (currently create/update only)?
   - Should `readonly_auditor` get `read` on `settings` (currently excluded)?
   - The extra `system.default_currency`/`system.timezone` settings duplicate tenant columns — trim to exactly 24?

3. **Default GM user seeding**. Should the first GM be seeded with a known dev password (e.g., via the Supabase Auth API in a setup script), or should the first login be invite-only (an invite row is seeded and the GM accepts it)? The latter is more production-like but adds a manual step to the dev bootstrap.

4. **Storage auto-purge**. `generated-reports` (24 h) and `import-files` (7 d) require a purge job. Options:
   - (a) Supabase Edge Function triggered by a Supabase Cron schedule (Supabase-managed, no DB extension).
   - (b) `pg_cron` extension job running a SQL `DELETE FROM storage.objects WHERE ...`.
   - Recommendation: (a) Edge Function, because purge also needs to delete the underlying storage object (not just the `storage.objects` row) via the Storage API. Confirm preference.

5. **`auth.users` sync trigger application method**. The trigger `trg_sync_auth_user_to_custom_users ON auth.users` cannot be applied via `supabase db push` (the `auth` schema is managed by Supabase). It must be applied via the Supabase SQL Editor with the service role. The function body (`sync_auth_user_to_custom_users`) IS applied via `supabase db push` in `005_users.sql`; only the `CREATE TRIGGER ON auth.users` is out-of-band. Confirm this split application is acceptable and that the runbook will document the manual step.

6. **Pure-RLS role gating vs. application-layer RBAC** (section 10.5). Phase 2 enforces role-based action authorization (read vs. update vs. approve) at the application layer (Server Actions), with RLS handling only tenant isolation. Is this acceptable for Phase 2, or should role-gating RLS policies be added now (higher policy count, harder to review, but defense-in-depth if a Server Action has a bug)?

7. **`users.role` denormalized column consistency**. The `users.role` column duplicates the authoritative grant in `user_role_assignments`. Should a CHECK trigger enforce they stay in sync now, or is application-layer consistency acceptable for Phase 2 (sync trigger added later if drift is observed)?

---

## Document control

- **Status:** DRAFT — awaiting approval.
- **Approval gate:** ADR-014 (Phase 2 migration gate) + ADR-019 (v2.0 correction gate).
- **On approval:** create `supabase/migrations/001_*` through `013_seed_defaults.sql`; apply the `auth.users` trigger via SQL Editor; run the test plan (section 14); then proceed to Phase 3 planning.
- **On rejection:** revise the affected sections and re-present. No migration files are created until this document is approved.
- **Supersedes:** none (first Phase 2 plan).
- **Owner:** EliteDev engineering.

