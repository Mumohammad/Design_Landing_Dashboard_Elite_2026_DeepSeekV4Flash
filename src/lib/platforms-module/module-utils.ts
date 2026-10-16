// Pure, client-safe logic for the platforms module. Server actions (the
// "use server" sibling actions.ts) import from here; Client Components may
// import this file directly.

// ── CSV paste-import parsing (RFC-4180-ish) ─────────────────────────────────

export interface ParsedDailyRow {
  ok: boolean
  rowNumber: number
  driver_code: string
  entry_date: string
  shift_label: string
  orders_delivered: number | null
  orders_failed: number | null
  orders_returned: number | null
  gross_revenue: number | null
  notes: string
  error?: string
}

export interface ParseResult {
  rows: ParsedDailyRow[]
  okCount: number
  errorCount: number
}

/**
 * Split a CSV blob into physical rows honoring double-quoted fields
 * (RFC-4180: quotes may contain commas and doubled "" quotes).
 */
export function splitCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else if (c === "\r") {
      // skip — \n handles the row break
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "")
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse pasted CSV rows for the daily-entry importer.
 * Header (1st non-empty row) is REQUIRED:
 *   driver_code, entry_date, shift_label, orders_delivered, orders_failed,
 *   orders_returned, gross_revenue, notes
 * The natural key (tenant_id, entry_date, driver_id, platform_id,
 * COALESCE(shift_label,'full_day')) makes re-imports idempotent at the DB
 * level — duplicate rows surface as per-row insert failures, reported
 * partial-failure style (good rows commit, bad rows are listed).
 */
export function parseDailyRowsCsv(text: string, platformId: string): ParseResult {
  const raw = splitCsvRows(text.replace(/^\uFEFF/, ""))
  if (raw.length === 0) {
    return { rows: [], okCount: 0, errorCount: 0 }
  }
  const header = raw[0].map((h) => h.trim().toLowerCase())
  const need = ["driver_code", "entry_date"]
  for (const col of need) {
    if (!header.includes(col)) {
      return { rows: [{ ok: false, rowNumber: 1, driver_code: "", entry_date: "", shift_label: "", orders_delivered: null, orders_failed: null, orders_returned: null, gross_revenue: null, notes: "", error: `missing required column "${col}" in header` }], okCount: 0, errorCount: 1 }
    }
  }
  const idx = (name: string) => header.indexOf(name)

  const rows: ParsedDailyRow[] = []
  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i]
    const rowNumber = i + 1
    const driver_code = (cells[idx("driver_code")] ?? "").trim()
    const entry_date = (cells[idx("entry_date")] ?? "").trim()
    const shift_label = (cells[idx("shift_label")] ?? "").trim()
    const delivered = num(cells[idx("orders_delivered")])
    const failed = num(cells[idx("orders_failed")])
    const returned = num(cells[idx("orders_returned")])
    const revenue = num(cells[idx("gross_revenue")])
    const notes = (cells[idx("notes")] ?? "").trim()

    let error: string | undefined
    if (!driver_code) error = "driver_code is required"
    else if (!DATE_RE.test(entry_date)) error = "entry_date must be yyyy-mm-dd"
    else if (delivered === null && failed === null && returned === null && revenue === null) {
      error = "at least one of orders_delivered / orders_failed / orders_returned / gross_revenue is required"
    }

    rows.push({
      ok: !error,
      rowNumber,
      driver_code,
      entry_date,
      shift_label,
      orders_delivered: delivered,
      orders_failed: failed,
      orders_returned: returned,
      gross_revenue: revenue,
      notes,
      error,
    })
  }
  void platformId
  return {
    rows,
    okCount: rows.filter((r) => r.ok).length,
    errorCount: rows.filter((r) => !r.ok).length,
  }
}

// ── Payment balance semantics (invoiced − paid) ─────────────────────────────

export type PaymentStatus = "pending" | "partial" | "paid" | "overdue" | "disputed"

/**
 * Derive the outstanding balance and the payment status of a period row.
 * Pure twin of what the drill-down ledger renders.
 */
export function paymentBalance(
  expected: number | null | undefined,
  received: number | null | undefined,
  declared: PaymentStatus | null | undefined
): { outstanding: number; status: PaymentStatus } {
  const exp = Number(expected ?? 0)
  const rec = Number(received ?? 0)
  const outstanding = Math.max(0, exp - rec)
  let status: PaymentStatus = declared ?? "pending"
  if (!declared || declared === "pending" || declared === "partial") {
    if (exp > 0 && rec >= exp) status = "paid"
    else if (rec > 0 && rec < exp) status = "partial"
    else status = "pending"
  }
  return { outstanding, status }
}

/** yyyy-mm for period keys. */
export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

// ── Drill-down rollups (no zero-filling: months without rows are absent) ───

export interface DailyRollup {
  entry_date: string
  orders: number
  delivered: number
  deliveredPct: number | null
  grossRevenue: number
}

export function rollupDaily(
  rows: { entry_date: string; orders_delivered: number | null; orders_failed: number | null; orders_returned: number | null; orders_cancelled: number | null; gross_revenue: number | null }[]
): DailyRollup[] {
  const byDate = new Map<string, DailyRollup>()
  for (const r of rows) {
    const cur =
      byDate.get(r.entry_date) ??
      { entry_date: r.entry_date, orders: 0, delivered: 0, deliveredPct: null, grossRevenue: 0 }
    const delivered = Number(r.orders_delivered ?? 0)
    const failed = Number(r.orders_failed ?? 0)
    const returned = Number(r.orders_returned ?? 0)
    const cancelled = Number(r.orders_cancelled ?? 0)
    cur.orders += delivered + failed + returned + cancelled
    cur.delivered += delivered
    cur.grossRevenue += Number(r.gross_revenue ?? 0)
    byDate.set(r.entry_date, cur)
  }
  return [...byDate.values()]
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    .map((d) => ({
      ...d,
      deliveredPct: d.orders > 0 ? (d.delivered / d.orders) * 100 : null,
    }))
}

export interface MonthRollup {
  period: string
  delivered: number
  revenue: number
}

export function rollupMonthly(
  rows: { period_year: number; period_month: number; total_delivered: number | null; total_revenue: number | null }[]
): MonthRollup[] {
  return rows
    .map((r) => ({
      period: periodKey(r.period_year, r.period_month),
      delivered: Number(r.total_delivered ?? 0),
      revenue: Number(r.total_revenue ?? 0),
    }))
    .sort((a, b) => a.period.localeCompare(b.period))
}
