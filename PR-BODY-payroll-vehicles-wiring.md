# Payroll / Vehicles Cross-Wiring (Prompt F)

Closes the operational triangle: **vehicles** and **payroll** become live two-way citizens. `/vehicles` shows who is driving what (current-driver chip, docs-expiry chips) and assigns/unassigns drivers from the vehicle side via shared, permission-gated server actions; `/payroll` computes its KPIs from live operational data (monthly orders rollup, COD sessions rollup), exposes guarded status transitions instead of a free-form cancel, and exports CSV. The drivers page's assignment card now uses the same shared actions — one code path for the triangle.

**Composed, not invented.** Zero new tables: every read/write composes over pre-existing surfaces (`vehicles`/`vehicle_documents` 016, `vehicle_assignments` 017, `driver_payroll_periods`/`monthly_driver_orders`/`driver_cod_sessions` 022, `audit_log` ADR-007). What's genuinely new: 4 predicate indexes, one DB-level integrity guard (PAY004), two shared server-action modules + their client-safe pure twins, and the surface wiring.

---

## Part 0 — Seed repair (blocker fix, included here)

`scripts/seed-users-test-data.mts` inserted auth users with `_users_seed: true` metadata, but the 060 hardened trigger requires **`_invite_provisioned: true`** — every signup was rejected with `AUTH010`, surfacing only as an opaque 500 `{}` from `auth.admin.createUser`. Fixed the metadata; the seed now completes:

- **5 users created** (`ED-SEED-USERS-*`: viewer / supervisor / pending / locked / inactive) — `users` count **136 → 141**, rows verified.
- **4 consents** recorded (PDPL gate coverage for the seeded personas).

## Part 1 — Surface (`/vehicles`, `/payroll` + shared actions)

### Route/use-case coverage table (live DB facts per row)

| Route / use-case | Reads (tables) | Writes | Handlers / notes |
| --- | --- | --- | --- |
| `/vehicles` — fleet list | `vehicles` + `drivers` (current-driver join) + `vehicle_documents` | **none** | New **assigned-driver chip** (deep-links the driver profile) and **docs-expiry chip** column (`worstDocsExpiryState` over the vehicle's document dates) |
| `/vehicles/[id]` — vehicle detail | `vehicles`, `vehicle_assignments`, `drivers` | **none** | `AssignDriverCard` (new, overview section): current-driver card with deep link to the driver profile; `AssignmentCard` links deep into driver/vehicle from history rows |
| `/vehicles/[id]` — assign driver | `vehicles` (availability), `drivers` | `vehicle_assignments` insert + `vehicles.status available→assigned` + `drivers.current_vehicle_id` | `assignVehicleToDriver()` (`src/lib/vehicles/assignments.ts`) — `requirePermission("assignments","create")`; zod parity; **race-safe conditional UPDATE** claims the available vehicle (0 rows ⇒ "no longer available"), compensation rollback if the insert fails; `vehicle.assigned` webhook; audit row |
| `/vehicles/[id]` — unassign driver | `vehicle_assignments`, `vehicles`, `drivers` | assignment closed (`is_current=false`, `unassigned_at`), vehicle → `available` | `unassignVehicleFromDriver()` — `requirePermission("assignments","update")`; same claim discipline; `vehicle.unassigned` webhook; audit row |
| Driver detail — assignment card | `src/components/drivers/vehicle-assignment-card.tsx` | via the **same two shared actions** | No more inline browser writes from the driver page — the triangle shares one code path; React-compiler-safe deferred load |
| `/payroll` — KPI cards | `driver_payroll_periods` + `monthly_driver_orders` | **none** | New **monthly orders KPI**: page-level rollup (`rollupMonthlyOrders`) by `(period_year, period_month)` |
| `/payroll` — COD column | `driver_cod_sessions` | **none** | Live rollup (`rollupCodSessions`, collected − submitted) with fallback to the period's stored `cod_deduction` when no sessions exist |
| `/payroll` — status transitions | `driver_payroll_periods` | guarded conditional UPDATE (`eq(status, from)` claim — 0 rows ⇒ "period changed under you") | `transitionPayrollStatus()` (`src/lib/payroll/status-actions.ts`) — `requirePermission("payroll","update")`; buttons render **only** for edges in `ALLOWED_PAYROLL_TRANSITIONS`; `cancelled` **demands a reason**; `period_locked` guard; `payroll.approved` webhook; audit row with `surface` |
| `/payroll` — CSV export | fetched rows | **none** | `payrollRowsToCsv()` (RFC-4180 escaping, UTF-8 BOM — approvals precedent) |
| Client-safe pure logic | — | — | `assignment-utils.ts` + `payroll-utils.ts` (transitions maps, `isIsoDate`, `worstDocsExpiryState`, `periodKey`, rollups, CSV) — importable by client components, since `"use server"` modules cannot be |

## Part 2 — Migration + pgTAP

**Migration (this PR):** `20260927120000_payroll_vehicles_wiring.sql` — idempotent, forward-only, no grants changed.

1. **4 predicate indexes:** `idx_vehicles_availability_claim` (the assign action's claim predicate — no existing index leads with `(tenant_id, status)` partial `available`), `idx_monthly_orders_period_read` (payroll's period-first rollup), `idx_cod_sessions_session_date_driver` (COD rollup, date-first), `idx_payroll_periods_transition_claim` (status-scoped queue reads + transition claim); `idx_payroll_periods_active` (022) re-asserted for drift-proofing.
2. **`enforce_payroll_cancel_reason()`** — constraint trigger on `driver_payroll_periods` refuses `status → 'cancelled'` without a reason (**PAY004**), on INSERT and UPDATE. DB-level parity with the server-action guard (users-module idiom; 058 self-escalation precedent).

**Suite `064_payroll_vehicles_wiring_tests.sql` (22 tests, `plan(22)` exact)** proves: all 4 wiring indexes with partial predicates; PAY004 on both insert and update paths, cancel-with-reason accepted, non-cancelled statuses free; one-current-assignment count + a live exercise of the availability-claim UPDATE (flips exactly once); **anon-zero across all five wired tables**; authenticated RLS visibility per table; **cross-tenant isolation via a REAL tenant-B user** (`get_my_tenant_id()` resolves from `public.users` by `auth_user_id`, not from a spoofable JWT claim — the tenant-B fixture authenticates its own user); `payroll_status` enum carries all seven states; trigger attached; `search_path` pinned.

### Suite hardening this PR had to make (reused-DB discipline)

The worklog gotcha is real and bit hard: `--single-transaction` **commits at EOF even on success**, so every green run leaves fixtures behind. 064's fixtures are fully idempotent (insert-if-absent + state resets). While proving the full suite green on this DB, two pre-existing master bugs surfaced and are fixed here:

- **061:** `plan(28)` vs 24 actual assertions (drift, CI-invisible), plus unguarded random-UUID auth fixture that poisons any re-run → guarded idempotent fixtures with a fixed auth UUID, ledger purge, `plan(24)`.
- **062:** unguarded fixed-UUID fixtures poison re-runs and the suite can never clean `audit_log` itself → self-purge at fixture time (immutability trigger disabled for the purge as superuser, re-enabled immediately; audit rows deleted **before** their FK-referenced users/drivers).
- **013:** left as on master — pre-existing plan-line drift (plan 24 / 21 assertions) and 3 seed-config-dependent DO-block `PERFORM` failures locally; the CI gate (exit code + plan line present + zero `not ok` + zero psql ERROR) counts the file passed. Noted, not papered over.

**Full-suite result** (local docker DB, `psql -tA --single-transaction`, CI gate parity — exit 0 + plan emitted + 0 `not ok` + 0 `ERROR` per file):

```
PASS 010_full_rls_test_suite.sql        — 109 ok
PASS 011_track1_rpc_grants_tests.sql    —  25 ok
PASS 012_drivers_module_tests.sql       —  41 ok
PASS 013_sensitive_tables_rls_tests.sql —  15 ok (pre-existing drift/failures noted above)
PASS 058_rls_security_tests.sql         —   1 ok
PASS 060_behavioral_rls_tests.sql       —  10 ok
PASS 061_users_module_tests.sql         —  24/24 (plan exact, re-run safe — hardened this PR)
PASS 062_audit_trail_tests.sql          —  25/25 (plan exact, re-run safe — hardened this PR)
PASS 063_approvals_module_tests.sql     —  34/34
PASS 064_payroll_vehicles_wiring_tests.sql — 22/22   ← NEW
────────────────────────────────────────────────
TOTAL 306 ok, 0 not-ok, 0 psql errors, 10/10 files pass the CI gate
```

## Part 3 — Permissions, PDPL, i18n

- **Permission gates:** `assignments` create/update (013 catalog: supervisor / operations_officer / admin) on the vehicle-side actions; `payroll` update (payroll_officer / accountant / admin) on transitions; GM bypasses via `can()`. Tenant scoping from `getCurrentUser()` only, never the browser.
- **PDPL:** no new personal-data projections; payroll export carries payroll figures for permission-holders only, same as the existing surface.
- **Bilingual parity:** pages reuse existing `t.*` namespaces; the new card follows the repo's inline AR/EN convention. AIDesigner shell/tokens untouched.

### Anti-goal sweep

```
grep -rinE 'mock|TODO|FIXME|XXX|lorem|placeholder|not.implemented' <changed .ts/.tsx/.sql/.mts>
→ 4 hits, all legitimate UI `placeholder` input attributes. Zero mock data,
  TODOs, FIXMEs, or lorem; zero merge-conflict markers in the tree.
```

### Gate results

| Gate | Result |
| --- | --- |
| `pnpm lint` | exit 0, **0 errors, 71 warnings** (below the 77 pre-change baseline — no new warnings) |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm test` | **491/491** (40 files; +25: 11 assignment-utils + 14 payroll-utils) |
| `pnpm build` | exit 0 |
| pgTAP full suite | **306 ok / 0 not-ok / 0 errors**, 10/10 files pass the CI gate; 064 = 22/22 (plan exact) |
| Anti-goal / conflict-marker sweep | clean |

## Agent worklog entry (chat context only — not committed)

```
## 2026-09-27 — Payroll / Vehicles Cross-Wiring (Prompt F) — v4-flash
Branch: feat/payroll-vehicles-wiring (off master df47ce3).
Shipped: shared assign/unassign vehicle actions (assignments.ts: requirePermission
assignments create/update, zod, tenant-scoped, race-safe conditional UPDATE claim
on vehicles.status='available', compensation on insert failure, vehicle.assigned/
unassigned webhooks, audit, revalidatePaths); vehicle-side AssignDriverCard +
fleet chips (current-driver, docs-expiry) on /vehicles + /[id]; drivers page
assignment card migrated to the shared actions. transitionPayrollStatus
(status-actions.ts: payroll update permission, ALLOWED_PAYROLL_TRANSITIONS,
mandatory reason on cancelled, eq(status,from) claim, period_locked guard,
payroll.approved webhook, audit surface). /payroll: live orders KPI
(monthly_driver_orders), COD rollup (driver_cod_sessions) with cod_deduction
fallback, guarded transition buttons, payrollRowsToCsv export. Pure client-safe
twins: assignment-utils / payroll-utils (+25 vitest tests). DB 20260927120000:
4 predicate indexes + re-assert, PAY004 cancel-reason constraint trigger.
Part 0: seed-users-test-data metadata _users_seed → _invite_provisioned
(AUTH010 contract); 5 ED-SEED-USERS-* + 4 consents; users 136→141 verified.
Tests: 064_payroll_vehicles_wiring_tests.sql 22/22 (plan exact). Suite
hardening: 061 plan 28→24 + idempotent fixtures (fixed auth UUID; unguarded
random-UUID insert poisoned re-runs); 062 self-purge incl. audit_log with
immutability trigger toggled (single-transaction COMMITS at EOF even on
success — every run leaks; suites must self-repair). 013 left as master
(plan drift + 3 seed-dependent DO-block fails; CI-gate passes).
Gotchas: "use server" modules can't be imported by client components even for
pure exports → pure helpers live in separate client-safe modules; a
data-modifying CTE must be top-level (no scalar-subquery WITH UPDATE);
vehicle_assignments has NO unique pair index (017) — one-current is an
app-layer invariant, assert counts not 23U01; get_my_tenant_id() reads
public.users by auth_user_id — JWT tenant_id claims don't move tenant
resolution, cross-tenant tests need a REAL second-tenant user; pgTAP
plan(N) MUST equal assertion count incl. DO-block PERFORM assertions
(013's invisible failures).
Gates: lint 0 err (71 warn < 77 baseline), tsc 0, vitest 491/491 (40 files),
build 0, pgTAP 306 ok / 0 not-ok / 0 errors (CI-gate parity, 10/10 files).
Post-merge: supabase db push --project-ref wwfnsbilmyxeawgzicmv.
Deferred: WPS-format bank file (CSV interim), payslip generation, realtime
refresh, payroll calculation engine, maintenance-events/odometer UI wiring.
```

## How to verify in 60 seconds

1. `docker exec -i supabase_db_nextjs-version psql -U postgres -d postgres -tA --single-transaction < supabase/tests/064_payroll_vehicles_wiring_tests.sql` → `1..22`, zero `not ok`.
2. `psql -c "INSERT INTO driver_payroll_periods (tenant_id, driver_id, period_year, period_month, status) VALUES (...,'cancelled')"` → `PAY004: cancellation reason required`; add `cancel_reason` and it lands.
3. Sign in as GM → **/vehicles/[id]** → assign a driver → the current-driver card deep-links the driver; **/vehicles** shows the assigned-driver chip and the docs-expiry chip.
4. Unassign from the vehicle card → vehicle returns to `available`, the driver page card clears.
5. **/payroll** → orders KPI + COD column (live rollup), transition a `draft` period → `calculated`; the cancelled option demands a reason; CSV export downloads.
6. Race check: open the same vehicle in two tabs, assign in both → the loser reports "no longer available" instead of a 500.

**Post-merge:** `supabase db push --project-ref wwfnsbilmyxeawgzicmv` (deploys do **not** apply migrations automatically; staging first, then prod).

## Backlog (explicitly out of scope here)

- WPS-formatted bank submission file (CSV export is the interim), payslip PDFs.
- Payroll calculation engine (amounts stay as stored), overtime/allowance breakdowns.
- Realtime refresh on fleet/payroll boards; maintenance-events + odometer-log UI wiring.
- 013 suite repair (plan drift + DO-block assertions) — pre-existing, tracked separately.

## References

- `docs/phase-2-schema-plan.md` — vehicles (§ 016/017), payroll (§ 022)
- `supabase/migrations/013_permissions_catalog.sql` — assignments/payroll grant rows
- `PR-BODY-approvals-module.md`, `PR-BODY-users-module.md` — surface/PR conventions followed
- Conditional-UPDATE claim precedent: FX-06 `approve_expense_atomic`, approvals decision RPCs
- `docs/agent-worklog.md` — leak-discipline gotchas this suite hardened against
