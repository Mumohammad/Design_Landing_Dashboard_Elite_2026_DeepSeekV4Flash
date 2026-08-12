# Elite Development — Dashboard Metric Dictionary

Every number on the dashboard is computed in `src/lib/analytics/actions.ts`
(`getDashboardSnapshot`) from real Supabase tables using the RLS-bound server
client. **No dashboard KPI is hardcoded** — if a source table is missing or a
query fails, the module is flagged `available: false` and the UI shows an
offline/empty state instead of fabricated values.

Time windows: KPIs compare the **current period** (7/30/90/365 days ending
today) against the **previous period** of equal length.

---

## Executive KPIs

| Metric | Definition | Source | Formula | Comparison |
|---|---|---|---|---|
| Total Drivers | All non-deleted drivers | `drivers` (deleted_at IS NULL) | `COUNT(*)` | — (snapshot) |
| Active Drivers | Drivers with status `active` | `drivers.status` | `COUNT(*) WHERE status='active'` | — (snapshot) |
| Total Vehicles | All non-deleted vehicles | `vehicles` | `COUNT(*)` | — (snapshot) |
| Vehicles in Maintenance | Vehicles with status `in_maintenance` | `vehicles.status` | `COUNT(*)` | — (snapshot) |
| Total Orders | Orders delivered in period | `daily_order_entries.orders_delivered` | `SUM(orders_delivered)` | Previous period |
| Completion Rate | Delivered ÷ attempted | `daily_order_entries` | `SUM(delivered) / SUM(delivered+cancelled+failed+returned)` × 100 | Previous period (pp) |
| Revenue | Gross revenue in period | `daily_order_entries.gross_revenue` | `SUM(gross_revenue)` | Previous period |
| Net Payroll | Latest approved payroll period | `driver_payroll_periods` (status approved/paid/locked, latest year+month) | `SUM(net_payroll)` | Previous month period |
| Open Violations | Open-status violations in period | `violations.status` (open/under_review/acknowledged/disputed/escalated) | `COUNT(*)` | Previous period |
| Pending Applications | Submitted + under review | `driver_applications.status` | `COUNT(*)` | — (snapshot) |
| Expiring Documents | Expiry within 30 days | `drivers.iqama/license_expiry_date`, `vehicles.insurance/registration_expiry` | `COUNT(*) WHERE 0 ≤ daysUntil ≤ 30` | — (snapshot) |
| Expired Documents | Expiry before today | same sources | `COUNT(*) WHERE daysUntil < 0` | — (snapshot) |

## Payroll summary (latest calculated period)

| Metric | Source | Formula |
|---|---|---|
| Gross | `driver_payroll_periods.total_earnings` | `SUM` |
| Bonuses | `orders_bonus` | `SUM` |
| Deductions | `total_deductions` | `SUM` |
| Net | `net_payroll` | `SUM` |
| Avg net | `net_payroll` | `AVG` |
| Above / Below target | `orders_achieved` vs `orders_prorated_target` (engine output) | `COUNT` by sign of variance |
| Negative balance | `net_payroll < 0` | `COUNT` |

The dashboard **consumes** payroll engine results (`src/lib/payroll/calculation-engine.ts`)
stored on `driver_payroll_periods`; it never re-calculates payroll itself.

## Driver targets

- Achievement % = `orders_achieved / orders_prorated_target × 100` (the engine's
  prorated target — never the flat monthly target).
- Status: `≥100%` exceeded · `90–99%` on track · `<90%` below.
- Distribution buckets: `<70%`, `70–89%`, `90–99%`, `100%`, `>100%`.

## Compliance

- `iqama`/`license` from `drivers`; `insurance`/`registration` from `vehicles`.
- Buckets: `valid` (>30 days), `expiring` (0–30 days), `expired` (<0 days).
- Days are computed against today's date at server time.

## Platform performance

- Source: `daily_order_entries` joined to `delivery_platforms` (by platform_id).
- Metrics per platform: orders, revenue, distinct drivers, completion rate.
- The platform **filter** uses `delivery_platforms.code`.

## Trends

| Trend | Source | Bucketing |
|---|---|---|
| Orders (orders/completed/cancelled/failed) | `daily_order_entries` | daily (7d/30d), monthly (90d/12m) |
| Revenue (+ payroll overlay) | `daily_order_entries.gross_revenue`, `driver_payroll_periods.net_payroll` | daily / monthly |
| Violations (+ penalties) | `violations` | daily / monthly |

## Actions & insights

- Actions: expired docs (critical), expiring docs (warning), open violations
  (warning), pending applications (info), vehicles in maintenance (info),
  drivers below target (warning) — only rendered when the real count is > 0.
- Insights: orders/completion/revenue/maintenance % change vs previous period,
  best platform by completion rate, count of below-target drivers — all derived
  from the computed numbers above. No fabricated insight text.

## Filters

- `period` (7d/30d/90d/12m): applied to all time-window queries.
- `platform` (delivery_platforms.code or "all"): applied to order queries and
  platform breakdown; driver/vehicle KPIs are global (documented exception).
- `category` (driver category or "all"): applied to the drivers query.

## Refresh strategy

- Manual refresh (↻) re-runs `getDashboardSnapshot` server-side; `lastUpdated`
  is shown in the toolbar. Realtime subscriptions and SQL view/RPC aggregation
  are on the roadmap (see `docs/implementation-plan.md` notes).

## Known caveats (Phase 1)

- **Payroll overlay:** the revenue chart's payroll series uses monthly bucket
  keys, so on the 7D/30D presets (daily buckets) the series is hidden by
  design; it appears on 90D/12M.
- **Delta chips** are shown only when a real previous value exists — a zero
  previous period never renders a fabricated "+100%".
- **Open violations** is a snapshot metric (no period comparison — open status
  has no historical snapshot).
- **Accessibility:** the driver performance table serves as the data-table
  alternative for the driver-target chart; tabular alternatives for the other
  charts are a Phase 2 item.
- **Platform filter options** derive from order data in the selected period;
  platforms with zero orders in the period can't be selected until they have
  orders (documented exception).
