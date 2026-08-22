# Load Testing Guide

EliteDev uses **k6** (primary) and a **Node.js runner** (alternative) for load testing critical query paths before general availability.

## Quick Start

```bash
# Option A: Node.js runner (no installation needed)
pnpm loadtest                        # All scenarios, 10 VUs, 30s
pnpm loadtest:dashboard              # Dashboard only
pnpm loadtest:payroll                # Payroll only
pnpm loadtest:accounting             # Accounting only

# Option B: k6 (install first)
pnpm loadtest:setup                  # Installs k6
pnpm loadtest:k6                     # All scenarios
pnpm loadtest:k6:dashboard           # Dashboard only
pnpm loadtest:k6:payroll             # Payroll only
pnpm loadtest:k6:accounting          # Accounting only
```

## Scenarios

### Dashboard (`GET /api/load-test?scenario=dashboard`)

Exercises the 8 database queries behind `getDashboardSnapshot()`:

| Query | Table | Budget | Description |
|-------|-------|-------:|-------------|
| `dashboard_platforms` | `delivery_platforms` | 200ms | Platform list for filter/breakdown |
| `dashboard_drivers` | `drivers` | 200ms | Driver KPIs + compliance expiry |
| `dashboard_vehicles` | `vehicles` | 150ms | Vehicle KPIs + insurance/registration |
| `dashboard_orders` | `daily_order_entries` | 300ms | Orders + revenue trend data |
| `dashboard_payroll` | `driver_payroll_periods` | 250ms | Payroll KPIs + target buckets |
| `dashboard_violations` | `violations` | 150ms | Open violations + trend |
| `dashboard_maintenance` | `vehicle_maintenance_events` | 150ms | Maintenance costs + status |
| `dashboard_applications` | `driver_applications` | 100ms | Pending application count |

### Payroll (`GET /api/load-test?scenario=payroll`)

Exercises payroll calculation query paths:

| Query | Table | Budget | Description |
|-------|-------|-------:|-------------|
| `payroll_drivers` | `drivers` | 150ms | Active drivers for calculation |
| `payroll_periods` | `driver_payroll_periods` | 200ms | Period history + status |
| `payroll_wps` | `driver_payroll_periods` + `drivers` (join) | 300ms | WPS SIF generation data |

### Accounting (`GET /api/load-test?scenario=accounting`)

Exercises accounting module query paths:

| Query | Table | Budget | Description |
|-------|-------|-------:|-------------|
| `accounting_coa` | `chart_of_accounts` | 200ms | Chart of accounts tree |
| `accounting_journal` | `journal_entries` | 250ms | Journal entry list |
| `accounting_invoices` | `invoices` | 250ms | Invoice list |
| `accounting_parties` | `customers` + `suppliers` | 200ms | Party counts |
| `accounting_vat` | `vat_returns` | 200ms | VAT return history |

## k6 Load Profiles

### Dashboard Profile

| Stage | Duration | VUs | Purpose |
|-------|----------|----:|---------|
| Warm-up | 30s | 10 | JIT compilation, connection pool init |
| Ramp-up | 60s | 10→50 | Gradual load increase |
| Steady | 120s | 50 | Sustained production-like load |
| Peak | 60s | 50→100 | Surge simulation |
| Sustained peak | 120s | 100 | Extended peak load |
| Cool-down | 30s | 100→0 | Drain connections |

### Payroll Profile

| Stage | Duration | VUs | Purpose |
|-------|----------|----:|---------|
| Warm-up | 20s | 5 | Conservative start |
| Ramp-up | 45s | 5→30 | Gradual increase |
| Steady | 90s | 30 | Production-like |
| Peak | 45s | 30→60 | Surge |
| Sustained peak | 90s | 60 | Extended peak |
| Cool-down | 20s | 60→0 | Drain |

### Combined Profile

| Stage | Duration | VUs | Purpose |
|-------|----------|----:|---------|
| Warm-up | 30s | 10 | JIT + pool |
| Ramp-up | 60s | 10→50 | Gradual |
| Steady | 120s | 50 | Production baseline |
| Peak | 60s | 50→100 | Surge |
| Sustained peak | 120s | 100 | Extended |
| Stress | 60s | 100→150 | Beyond capacity |
| Cool-down | 30s | 150→0 | Drain |

## Success Criteria

| Metric | Dashboard | Payroll | Accounting |
|--------|----------:|--------:|-----------:|
| p95 latency | < 2,000ms | < 3,000ms | < 3,000ms |
| p99 latency | < 5,000ms | < 6,000ms | < 6,000ms |
| Error rate | < 1% | < 1% | < 1% |
| Query budgets | All within | All within | All within |

## Running Against Staging

```bash
# k6
BASE_URL=https://staging.elitedev.com.sa k6 run loadtest/all.js

# Node.js
BASE_URL=https://staging.elitedev.com.sa pnpm loadtest:all

# With auth (production only)
BASE_URL=https://staging.elitedev.com.sa LOAD_TEST_SECRET=xxx k6 run loadtest/all.js
```

## Node.js Runner Options

```bash
node loadtest/run.js [scenario] [--vus N] [--duration S]

# Examples:
node loadtest/run.js dashboard --vus 20 --duration 60
node loadtest/run.js all --vus 50 --duration 120
```

## Output

### k6

Results are saved to `loadtest/results/<scenario>-<timestamp>.json` with:
- HTTP metrics (requests, errors, duration percentiles)
- Custom scenario metrics
- Threshold pass/fail status
- Per-query budget tracking

### Node.js Runner

Console output with:
- Request count, success/fail, RPS
- Duration percentiles (p50, p75, p90, p95, p99)
- Per-query budget status
- Threshold pass/fail

## Interpreting Results

### Healthy Response

```
  Response Times:
    Avg:    150ms
    p50:    120ms
    p95:    380ms
    p99:    850ms

  Thresholds:
    ✓ p95 < 3000ms
    ✓ p99 < 6000ms
    ✓ Error rate < 1%
```

### Degraded Response (Action Required)

```
  Response Times:
    Avg:    2400ms
    p95:    5200ms     ← EXCEEDS 3000ms budget

  Thresholds:
    ✗ p95 < 3000ms    ← FAILED
    ✓ p99 < 6000ms
    ✓ Error rate < 1%

  Dashboard Queries:
    dashboard_orders    3200ms  (budget: 300ms)  OVER BUDGET
    dashboard_payroll   2800ms  (budget: 250ms)  OVER BUDGET
```

### Common Bottlenecks

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `dashboard_orders` high | No index on `entry_date` | Add composite index |
| `payroll_wps` high | Join without index | Add FK index on `driver_id` |
| `accounting_journal` high | Large table, no limit | Add pagination |
| All queries degraded | Connection pool exhausted | Increase `pool_size` |
| Error rate spike | Supabase connection limit | Upgrade plan or optimize |

## Database Index Recommendations

Based on load test query patterns, these indexes should exist:

```sql
-- Dashboard: orders date range
CREATE INDEX IF NOT EXISTS idx_doe_entry_date
  ON daily_order_entries (entry_date DESC)
  WHERE deleted_at IS NULL;

-- Dashboard: orders by platform
CREATE INDEX IF NOT EXISTS idx_doe_platform_date
  ON daily_order_entries (platform_id, entry_date DESC)
  WHERE deleted_at IS NULL;

-- Payroll: periods by tenant + status
CREATE INDEX IF NOT EXISTS idx_dpp_tenant_status
  ON driver_payroll_periods (tenant_id, status, period_year DESC, period_month DESC)
  WHERE deleted_at IS NULL;

-- Payroll: WPS generation (join path)
CREATE INDEX IF NOT EXISTS idx_dpp_status_driver
  ON driver_payroll_periods (status, driver_id)
  WHERE deleted_at IS NULL;

-- Accounting: journal entries by date
CREATE INDEX IF NOT EXISTS idx_je_entry_date
  ON journal_entries (entry_date DESC)
  WHERE deleted_at IS NULL;

-- Accounting: invoices by date
CREATE INDEX IF NOT EXISTS idx_inv_invoice_date
  ON invoices (invoice_date DESC)
  WHERE deleted_at IS NULL;

-- Accounting: VAT returns by period
CREATE INDEX IF NOT EXISTS idx_vr_period
  ON vat_returns (period_year DESC, period_month DESC)
  WHERE deleted_at IS NULL;
```

## API Endpoint: `/api/load-test`

The profiling endpoint is gate-protected:

| Environment | Auth Required | Behavior |
|-------------|:------------:|----------|
| Development | No | Always accessible |
| Staging | No | Always accessible |
| Production | Yes | Requires `Bearer LOAD_TEST_SECRET` |

Query parameters:
- `scenario` — `dashboard`, `payroll`, `accounting`, or `all` (default: `all`)

Response structure:
```json
{
  "totalMs": 450,
  "budget": { ... },
  "scenarios": [
    {
      "scenario": "dashboard",
      "timestamp": "2026-08-22T12:00:00Z",
      "queries": [
        {
          "name": "dashboard_drivers",
          "durationMs": 45,
          "rows": 120,
          "budget": 200,
          "withinBudget": true
        }
      ],
      "summary": {
        "totalMs": 350,
        "queryCount": 8,
        "avgMs": 44,
        "p50Ms": 38,
        "p95Ms": 95,
        "allWithinBudget": true
      }
    }
  ]
}
```

## CI Integration

Load tests are NOT run in CI (they require a live database). Instead:

1. **PR checks**: TypeScript + unit tests + build (fast)
2. **Pre-deploy**: Run `pnpm loadtest` against staging preview
3. **Pre-release**: Run full k6 profile against staging
4. **Post-deploy**: Run against production with `LOAD_TEST_SECRET`

## When to Run

| Phase | Command | Frequency |
|-------|---------|-----------|
| Development | `pnpm loadtest` | Before PR |
| Staging | `pnpm loadtest:all` | Before deploy |
| Pre-release | `k6 run loadtest/all.js` | Before GA |
| Production | `k6 run loadtest/all.js` | Monthly |
| After index change | `pnpm loadtest:dashboard` | Immediately |
