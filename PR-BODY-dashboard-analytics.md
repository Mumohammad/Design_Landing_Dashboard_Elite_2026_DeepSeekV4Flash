# /dashboard Analytics Restoration (Prompt G)

Restores a real analytics `/dashboard` against **today's** architecture — live DB reads only, RLS-safe, composed over the module surfaces that now exist (drivers, users, approvals #52, audit-trail #51, payroll/vehicles wiring #53). The Sep 8 attempt (#16) is not revived: no demo-pattern reads, no fabricated series, no duplicate route.

**Zero new tables, zero new RPCs, zero new indexes, zero new dependencies.** Every KPI is composed over existing tables/rollups; the only DB code touched is the two pre-existing SECURITY DEFINER RPCs (`fetch_pending_approvals` #52, called with the server-side tenant id) and existing indexes (audit_log `(tenant_id, created_at DESC)` 007, payroll `idx_payroll_periods_active` 022 + `idx_monthly_orders_period_read` #53). No migration ships.

## Route decision (first commit)

`src/app/dashboard/` does not exist on master (checked `ls src/app/dashboard src/app/(dashboard)/dashboard` — exactly one `page.tsx` serves `/dashboard`, under the `(dashboard)` group with `loading.tsx` + `error.tsx`). There is no `/dashboard/overview` route on master (zero references). The tenant fleet overview IS the `/dashboard` snapshot — preserved and extended in place. The #16 conflict cannot recur.

## KPI coverage table

| Card / chart | Tables read | Aggregation | Deep link |
| --- | --- | --- | --- |
| Total / Active drivers | `drivers` | count, `status='active'`, soft-delete filtered | `/drivers` |
| Total vehicles / Assigned / Available | `vehicles` | counts by `status` (`assigned`/`available` = #53 wiring states) | `/vehicles` |
| In maintenance | `vehicles` | `status='in_maintenance'` count | `/maintenance` |
| Total orders, completion %, revenue | `daily_order_entries` | period-window sums (`delivered/failed/cancelled/returned/gross_revenue`), current vs previous period | `/platforms`, `/reports` |
| Net payroll (latest approved period) | `driver_payroll_periods` | sum `net_payroll` per (year, month), latest vs previous approved period | `/payroll` |
| Open violations | `violations` | in-window count with open-status list | `/violations` |
| Pending applications | `driver_applications` | head-count, `submitted/under_review` | `/applications` |
| Expiring (≤30d) / expired documents | `drivers` (iqama/license) + `vehicles` (insurance/registration) | date-bucket counts | `/drivers` |
| **Open approvals** (new) | `fetch_pending_approvals` RPC (#52) | queue depth by type + stale>7d; **counts only, no PII projected** | `/approvals` |
| **Audit activity** (new) | `audit_log` (#51) | head-count since period start, existing `(tenant_id, created_at DESC)` index | `/audit-log` |
| **COD reconciliation** (new) | `driver_cod_sessions` | `rollupCodSessions` (#53 twin): pending sessions + variance/collected/submitted sums | `/payroll` |
| Cross-module ops panel (new) | all of the above | one tile per module, each deep-linking | `/vehicles` `/approvals` `/payroll` `/audit-log` |

**Charts (truthful sources only):** orders trend + revenue-vs-payroll use `daily_order_entries` (in-window) and `driver_payroll_periods` (approved periods, monthly) — **no zero-fill between months**: months without rows simply don't exist in the series, so nothing is invented. Violations trend from in-window rows. Recharts **3.6.0** (already installed) — no new dependency.

**Filters:** period selector (7d/30d/90d/12m) drives windowed reads where the sources support it; platform/category filters kept (real columns). **CSV export:** KPI-snapshot download (RFC-4180 + UTF-8 BOM, payroll-utils convention) — one row per KPI with source table + deep link; unavailable modules exported as null with `available=no` so coverage is honest. **PDPL/i18n:** aggregates are counts (no PII); Hijri dual date in the header via the shared `formatHijri` util (`islamic-umalqura`, no dependency); every new string in ar-SA + EN.

## NOT restored from the old dashboard (deliberate)

- **The pre-Sep-8 demo "financial hero" KPIs** (`monthlyRevenue`, `pendingInvoices`, `netOperationalResult`, `pendingPayrolls`) — hard-coded template numbers with no real source tables behind invoices/payables on master; inventing them would violate the no-fabrication rule. Accounting belongs to that module's backlog.
- **The #16 wholesale-restored code path** — demo-pattern reads and the duplicate `src/app/dashboard` route that killed it; nothing is imported from it.
- **Zero-filled trend lines** — the old charts drew smooth 12-month curves by zero-filling missing months; missing months are now absent, not drawn as zeros.
- **Static "recent activity" filler** — the activity feed stays, but only from real rows (`driver_applications`, `violations`, `vehicle_maintenance_events`, `drivers`).
- Realtime refresh, configurable/widget layouts, scheduled email reports — out of scope per the prompt (backlog).

## Gates

| Gate | Result |
| --- | --- |
| Route-conflict sweep | `src/app/dashboard` absent; exactly one `page.tsx` under `src/app/(dashboard)/dashboard/` |
| `pnpm lint` | exit 0, 0 errors, 71 warnings (baseline) |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm test` | **505/505** (41 files; +14 dashboard-utils) |
| `pnpm build` | exit 0 |
| pgTAP | n/a — **no DB objects ship** (full suite baseline 306 ok stands) |
| Anti-goal + conflict-marker sweep | clean (0 hits in changed analytics files) |

## Migration push

No migration ships in this PR. Post-merge migration pushes are automated by `.github/workflows/supabase-deploy.yml` (Prompt H, #54) as of this PR's merge base — no manual action line needed.

## How to verify in 60 seconds

1. Route check: `ls src/app/dashboard` → does not exist; `ls "src/app/(dashboard)/dashboard"` → one `page.tsx` (+#54's own gates).
2. `pnpm exec vitest run src/lib/analytics/dashboard-utils.test.ts` → 14/14 (trend no-zero-fill included).
3. Sign in → `/dashboard`: KPI rows render with live counts; the **Cross-Module Operations** panel shows fleet split, approvals depth (deep-links `/approvals`), COD reconciliation, audit volume.
4. Header date shows Gregorian · Hijri (Umm al-Qura); **Export CSV** downloads the KPI snapshot (open in Excel — Arabic-safe BOM).
5. Switch period 30D → 12M: monthly charts re-bucket; months with no rows are absent (no flat zero line).
6. As a viewer-role user, `/approvals` queue shows the same total the dashboard's Open Approvals KPI shows (both server-tenant-scoped).

## Agent worklog (chat context only — not committed)

```
## 2026-09-27 — /dashboard Analytics Restoration (Prompt G) — v4-flash
Branch: feat/dashboard-analytics (off master c061cb1 = #54 merged).
Found on master: the grouped-ops /dashboard (54b81c0) is already live-DB
(RLS client, availability flags) — NOT the #16 demo path. So the work =
bring it to module convention + compose the new-module KPIs it predates.
Shipped: zod-parsed filters (catch→defaults) on getDashboardSnapshot; new
KPIs — approvals depth via fetch_pending_approvals (#52, admin client,
server-side tenantId, depth-only projection), audit_log volume (007 index
covers (tenant_id, created_at DESC)), COD rollup via #53 rollupCodSessions,
fleet available/assigned split (#53 wiring states); OpsPanel (4 deep-link
tiles, ar/EN inline); DashboardHeader (Hijri dual date via shared
formatHijri islamic-umalqura; KPI CSV snapshot export, nulls for
unavailable modules); client-safe dashboard-utils (monthly trend builder
with NO zero-fill, mergePayrollTrend, approvals aggregation, toCsv twin)
+ 14 vitest tests. i18n: ops* keys in types + translations (ar+en).
Not restored (deliberate): demo financial hero KPIs (no source tables),
#16 code path/route, zero-filled charts, static activity filler.
DB: no migration — all reads compose existing tables/RPCs/indexes; no
new RPC justified (window reads are index-covered; rollups in-app per
#53 precedent). pgTAP untouched (306 baseline stands).
Gotchas: i18n dashboard section is typed via src/lib/i18n/types.ts —
new keys must be added there too (tsc TS2353 otherwise); delivery group
route already owned /dashboard — no route work needed; audit_log count
query uses head:true+count exact (no row transfer).
Gates: route sweep OK, lint 0 err (71 warn = baseline), tsc 0,
vitest 505/505 (41 files), build 0, anti-goal sweep clean.
Backlog: accounting-sourced financial KPIs (invoices/expenses), realtime
refresh, widget layouts, scheduled email reports, 12m payroll trend on
the revenue chart once enough approved periods exist.
```

## References

- `src/lib/analytics/actions.ts` — snapshot aggregation (extended, zod-parity)
- `src/lib/payroll/payroll-utils.ts` / `src/lib/approvals/` — reused rollup + queue-RPC patterns
- `docs/phase-2-schema-plan.md` § 020/022 — orders/payroll schema
- PR-BODY-payroll-vehicles-wiring.md (#53) — rollup twins, fleet statuses, CSV convention
- PR-BODY-approvals-module.md (#52) / PR-BODY-audit-trail (#51) — RPC surfaces consumed
