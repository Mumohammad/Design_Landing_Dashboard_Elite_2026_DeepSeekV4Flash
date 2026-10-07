// Pure, client-safe logic for the Reports hub (Module 12/13 surface —
// report_generation_log + document_templates + generated_documents).
// Server actions import from here; Client Components may import directly.
// No DB access, no "use server".

// ── Report catalog (code-defined; DB enum report_type mirrors it) ───────────

export type CatalogReportType =
  | "driver_performance"
  | "payroll_summary"
  | "fleet_cost"
  | "revenue"
  | "violations_report"
  | "attendance_summary"
  | "executive_dashboard"
  | "hs_reconciliation"

export interface ReportCatalogEntry {
  type: CatalogReportType
  /** Period picker shown (a month the collectors filter by). */
  requiresPeriod: boolean
}

/**
 * The selectable report catalog — the DB enum also carries a legacy `custom`
 * value, which is deliberately NOT offered (it echoes params back, it does
 * not read live tables).
 */
export const REPORT_CATALOG: ReportCatalogEntry[] = [
  { type: "driver_performance", requiresPeriod: false },
  { type: "payroll_summary", requiresPeriod: true },
  { type: "fleet_cost", requiresPeriod: false },
  { type: "revenue", requiresPeriod: true },
  { type: "violations_report", requiresPeriod: false },
  { type: "attendance_summary", requiresPeriod: true },
  { type: "executive_dashboard", requiresPeriod: true },
  { type: "hs_reconciliation", requiresPeriod: true },
]

export function isCatalogReportType(v: string): v is CatalogReportType {
  return REPORT_CATALOG.some((e) => e.type === v)
}

// ── Month range (the collectors' date filters) ──────────────────────────────

export interface MonthRange {
  /** `YYYY-MM-01` */
  start: string
  /** `YYYY-MM-<last>` — real last day (28/29/30/31), never an out-of-range literal. */
  end: string
}

/**
 * Inclusive date range for a calendar month. The prior implementation
 * filtered `entry_date <= YYYY-MM-31`, which Postgres rejects with
 * `date/time field value out of range` for 30/29/28-day months.
 */
export function monthRange(year: number, month: number): MonthRange {
  const y = Math.trunc(year)
  const m = Math.trunc(month)
  const mm = String(m).padStart(2, "0")
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate() // day 0 of next month
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` }
}

// ── Generation-log rows ──────────────────────────────────────────────────────

/** A log row is expired once its 24h link lifetime has passed. */
export function isReportExpired(expiresAt: string | null | undefined, now: Date): boolean {
  if (!expiresAt) return true
  const t = new Date(expiresAt).getTime()
  return Number.isNaN(t) || t <= now.getTime()
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Generated-document status transitions ───────────────────────────────────
// doc_generation_status: draft | generated | printed | archived

export type DocStatus = "draft" | "generated" | "printed" | "archived"

/** Printing is allowed from draft/generated (re-print of printed stays possible via view). */
export function canPrintDoc(status: string | null | undefined): boolean {
  return status === "draft" || status === "generated"
}

/** Archiving is allowed for any live status except already-archived. */
export function canArchiveDoc(status: string | null | undefined): boolean {
  return !!status && status !== "archived"
}
