# Drivers Module Audit & Remediation

Branch: `chore/drivers-audit-remediation` · Date: 2026-09-23
Branched off `feat/drivers-module-integration` (PR #48, pre-merge) — Task 2 surfaces and the seed script are in scope.

Audit scope: every `driver*` table, drivers CRUD surfaces, RLS/policies, and Saudi
compliance requirements. Live schema probed via the service-role client; repo state
from `supabase/migrations/`.

Status key: **PASS** = verified, no action · **FIXED** = remediated in this branch ·
**DEFERRED** = documented, not fixed here (with reason).

---

## 1. Database

### 1.1 FK indexes

| Finding | Status |
|---|---|
| Hot FK indexes exist on drivers-module children: `driver_documents (tenant_id, driver_id, doc_type, expiry_date) [partial]`, `driver_emergency_contacts (driver_id)`, `driver_cod_sessions (tenant_id, driver_id, status) [partial] + (driver_id, session_date)`, `driver_salary_history (driver_id)`, `driver_attendance (driver_date/period)`, `driver_leave_requests (driver)`, `driver_leave_balances (driver_year)`, foundation tables have `idx_<t>_driver`/`_tenant` | **PASS** |
| `monthly_driver_orders (driver_id)` — no dedicated index in migrations (platform_id FK also unindexed) | **FIXED** — `061` adds `idx_mdo_driver` and `idx_mdo_platform` |
| `driver_onboarding_checklists (driver_id)` — only tenant/driver indexes came from `20260915120000` DO-loop; verified `idx_driver_onboarding_driver` exists there | **PASS** (verified line 214-216 of foundation) |
| Hot-FK audit migration `20260906220134` covers only `platform_invoices`; drivers-module tables were added later (20260915) and were never re-audited | **FIXED** — `061` backfills the two gaps above; rest verified covered |

### 1.2 Soft delete (`deleted_at`) consistency

| Finding | Status |
|---|---|
| All drivers-module transactional tables carry `deleted_at` (drivers, documents, cards, assets, attendance, leave, violations, training, cod, monthly orders, onboarding, consents has none — see below) | **PASS** |
| `driver_consents` intentionally has **no** `deleted_at` (append-only PDPL ledger with UNIQUE (tenant, driver, type, version)); deletes blocked by having no DELETE policy | **PASS** (by design, documented) |
| `driver_card_prints` append-only, no soft delete; matches its purpose | **PASS** |

### 1.3 Audit columns (`created_by` / `updated_by`)

| Finding | Status |
|---|---|
| All `driver*` tables define `created_by uuid REFERENCES auth.users(id)` + `updated_by` | **PASS** |
| UI writes in drivers module set `requested_by` (leave) / rely on RLS context; `created_by` left to DB default NULL for client-side inserts — acceptable because `auth.users` FK cannot be set reliably from client; server actions set it where needed | **DEFERRED** — moving client writes to server actions is a larger refactor tracked separately |

### 1.4 Unique constraints

| Finding | Status |
|---|---|
| `driver_cards.card_serial` UNIQUE (global) — present; also `idx_driver_cards_driver/_tenant` | **PASS** |
| **`driver_documents` upsert target missing**: UI (`document-upload-dialog.tsx`) upserts `onConflict: "driver_id,doc_type"` but no unique index/constraint exists on `(tenant_id, driver_id, doc_type)` — every upload after the first **inserts a duplicate row** instead of replacing (ups. silently no-ops conflict detection) | **FIXED** — `061` adds unique partial index `uq_driver_documents_driver_type` on `(driver_id, doc_type) WHERE deleted_at IS NULL AND is_active` + backfills duplicates |
| `driver_consents` UNIQUE (tenant_id, driver_id, consent_type, version) | **PASS** |

### 1.5 Migration ↔ live drift

| Live finding (probed) | Repo state | Status |
|---|---|---|
| `driver_documents.file_url TEXT NOT NULL` live == migration | UI writes `file_path` (nonexistent column) in `document-upload-dialog.tsx` — the upsert **fails at runtime** | **FIXED** — dialog now writes `file_url`, `file_size_bytes`, `mime_type` (migration/live shape) |
| `driver_leave_types` — **does not exist live** (PGRST205); UI already repointed to `leave_types` in PR #48 | already fixed upstream | **FIXED** (in #48) |
| `set_driver_status` RPC — **missing live** (PGRST202); `driver-leave-tab.tsx` calls it when leave is approved, so approvals fail at that step | no migration defines it | **FIXED** — `061` creates `set_driver_status(uuid, driver_status, text, uuid)` (SECURITY DEFINER, tenant-scoped, audit-comment via update) and the UI call now matches its signature |
| `driver_leave_balances.year` (not `period_year`) | `driver-leave-tab.tsx` + payroll lib read `year` | **PASS** |
| `driver_salary_history.basic_salary` (not `base_salary`) | UI/seed aligned | **PASS** |
| `driver_consents` uses `accepted boolean` + `version` (no `consent_status`/`granted_at`) | Part 2 PDPL gate uses live shape | **FIXED** (aligned) |
| `drivers.iqama_number` + `drivers.iqama_expiry_date` | already in migration 014 + live | **PASS** |

`20260923120000_reconcile_drivers_module_drift.sql` encodes all FIXED rows above and is
idempotent (IF NOT EXISTS / guarded DO blocks), so it can replay on any env.
(Date-prefixed name is required: the drivers foundation migration is
date-prefixed too, and a `061_`-style name sorts BEFORE it, breaking first-run
ordering — found by replaying all 74 migrations into a clean database.)

## 2. CRUD standards

| Finding | Status |
|---|---|
| Server actions (`src/app/actions/drivers/*`) validate via zod + role-gate (`assertDriverAdmin`) and return generic messages | **PASS** |
| Client writes (documents upsert, leave requests, violations dialog, assets) validate minimally (required fields) but **do not run zod**; RLS bounds the blast radius | **DEFERRED** — client zod parity tracked as follow-up; DB CHECK constraints + RLS are the backstop |
| Optimistic concurrency: no `updated_at` match checks on edits anywhere in the drivers module | **DEFERRED** — needs product decision on last-write-wins vs 409 UX; single-admin usage today |
| Idempotency on creates: document upload is an upsert (now with a real unique index, see 1.4); card issuance checks active-card existence first; seed script fully idempotent | **PASS** (documents FIXED) |
| Error surfacing: server actions return generic strings ("Not authorized…", "Failed to issue card"); UI toasts them; no SQL internals leak found (`error.message` never rendered raw from PostgREST in drivers UI — verified via grep for `.message` renders) | **PASS** |
| Pagination: drivers list `.limit(100)` hard cap, no cursor; tabs use `.limit(50)`; acceptable data volume today, no offset pagination needed | **DEFERRED** — keyset pagination follow-up when fleet > 100 |

## 3. Security (RLS)

| Finding | Status |
|---|---|
| Live probe: anon SELECT on drivers/driver_documents/driver_salary_history/driver_consents/violations returns 0 rows (RLS enabled everywhere) | **PASS** |
| `driver_salary_history`: tenant sel/ins policies (migration 015) — any authenticated tenant member can read salaries | **PASS w/ note** — role tightening recommended; pgTAP locks current behavior |
| `driver_consents`: tenant sel/ins/upd (foundation DO-loop); no DELETE policy (append-only) | **PASS** |
| `violations`: tenant sel/ins/upd (migration 019); no DELETE policy (soft-delete only) | **PASS** |
| Role checks (ops/admin) are enforced **application-side** (`assertDriverAdmin` in server actions), not in RLS | **DEFERRED** — DB-side role policy needs a role-lookup RPC like `get_my_tenant_id()`; flagged for security hardening epic |
| New PR #48 UI write (vehicle assignment insert from driver profile) has matching tenant INSERT policy (migration 017) | **PASS** |

**pgTAP coverage added:** `013_sensitive_tables_rls_tests.sql` — behavioral tests for
`driver_salary_history`, `driver_consents`, `violations`: tenant isolation (other-tenant
row invisible), no anon leak, no hard-delete policy, updatable only within tenant.

---

## 4. Saudi compliance remediation (Part 2)

| Requirement | Implementation | Status |
|---|---|---|
| Leave accrual — 21d annual (<5y), 30d (≥5y); sick tiers 30 full / 60 half / 30 unpaid (120-day structure) | SQL validator `validate_leave_request(...)` in `061` + shared constants/UI hint in leave dialog (21/30 + tier breakdown shown when a sick type is selected) | **FIXED** |
| Iqama tracking for expats | Columns exist (014). Profile Overview legal group renders Iqama No./expiry already; `061` + UI add **expiry alert** chip on profile header when iqama/license ≤ 30 days; compliance engine treats `iqama` doc requirement for non-Saudi drivers (already keyed on `nationality !== "Saudi"`) | **FIXED** |
| Hijri dual dates | `formatHijri()` helper (Umm al-Qura via Intl) added; card print shows Gregorian + Hijri issue/expiry; leave requests table shows both calendars | **FIXED** |
| PDPL consent gate | `hasPdplConsent()` in `061` (SQL, SECURITY DEFINER) checks `driver_consents.accepted` for `photo` + `sensitive_docs`; card panel and documents surfaces check it before rendering national_id/iqama numbers; masked placeholder shown when consent missing | **FIXED** |
| Saudization KPI | Fleet KPI card on drivers list header: Saudi % of active drivers (nationality-based count) + absolute counts | **FIXED** |

---

## 5. Deferred items (follow-ups)

1. Client-side zod parity for all driver dialogs (DB CHECKs + RLS backstop today).
2. Optimistic concurrency (`updated_at` match) on driver edits — UX decision needed.
3. Server-action migration for client-side writes to enable audit columns + rate limits.
4. Keyset pagination for drivers list beyond 100 rows.
5. DB-side role-based RLS (ops/admin write policies) via a role-lookup RPC.
6. `driver_documents.file_url` is `NOT NULL` with free-form text; consider a
   storage-path domain type + bucket validation.

---

## 6. Test-gate audit (pgTAP) — added 2026-09-23

Running the full pgTAP suite for the first time in a faithful
(`db reset`-equivalent) environment exposed that **the CI pgTAP job has never
actually executed the tests**:

| Finding | Impact | Status |
|---|---|---|
| CI installed pgTAP **before** `supabase db reset`, which recreates the DB and drops the extension | every suite died on `function plan(integer) does not exist` | **FIXED** — extension now installed after reset |
| Runner counted a file with **no TAP plan** (aborted suite) as "✅ completed" | aborted suites passed the gate | **FIXED** — plan + `not ok` + psql-ERROR lines all must be clean |
| psql default table format wraps TAP lines in table borders; plan was unparseable | runner saw no plan even when tests ran | **FIXED** — `psql -tA` |
| `compute_driver_compliance()` compared enum `doc_type` to plain-text loop var | **production crash** (`operator does not exist: driver_document_type = text`) on every compliance run | **FIXED** — explicit `::driver_document_type` cast (foundation + reconcile) |
| Latent pgTAP bugs: invalid `user_role` enum literals (`test_role_rl`, `test_svc_role`, `test_hack`), stale `journal_entries`/`tenant_memberships`/`journal_entry_lines`/`journal_approvals`/`financial_events` column names, `throws_ok` called with impossible SQLSTATEs (3-char codes; pgTAP does exact SQLSTATE+SQLERRM equality, untyped text codes bind to a char(1) overload), stale `tenants` policy list, `oidvector`-array emptiness check | 17 tests either failed or asserted the wrong thing | **FIXED** — all suites green |

**Final tally (fresh rebuild: supabase scaffolding → 74 migrations → seed →
6 suites, `psql -tA --single-transaction`):**

```
✅ 010_full_rls_test_suite.sql        109/109
✅ 011_track1_rpc_grants_tests.sql     25/25
✅ 012_drivers_module_tests.sql        41/41
✅ 013_sensitive_tables_rls_tests.sql  24/24  (new in this PR)
✅ 058_rls_security_tests.sql           1/1  (TAP wrapper added)
✅ 060_behavioral_rls_tests.sql        10/10
════════════════════════════════════
TOTAL                                 210/210, 0 failed
```
