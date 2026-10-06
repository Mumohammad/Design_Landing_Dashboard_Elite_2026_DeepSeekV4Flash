// Pure, client-safe logic for the violations module (Module 5). Server actions
// (the "use server" sibling actions.ts) import from here; Client Components
// may import this file directly. No DB access, no "use server" — this is the
// testable twin layer established by the platforms/maintenance modules.

import { parseCsv } from "@/lib/accounting/csv-utils"

// ── Status machine (review workflow) ────────────────────────────────────────

export type ViolationStatus =
  | "open"
  | "under_review"
  | "acknowledged"
  | "disputed"
  | "resolved"
  | "deduction_applied"
  | "waived"
  | "escalated"
  | "closed"

/**
 * The review workflow's allowed transitions:
 *   open → under_review | resolved (direct approve) | waived
 *   under_review → resolved | waived
 *   resolved → deduction_applied (ledger row applied to a payroll period)
 *   deduction_applied → resolved (ledger rollback, mirrors M3)
 * Waive is part of the review workflow, so it is reachable from both open and
 * under_review (with a mandatory reason). disputed/acknowledged/escalated/
 * closed are terminal here — the driver-dispute flow lives elsewhere.
 */
const VIOLATION_TRANSITIONS: Record<string, readonly string[]> = {
  open: ["under_review", "resolved", "waived"],
  under_review: ["resolved", "waived"],
  resolved: ["deduction_applied"],
  deduction_applied: ["resolved"],
}

export function isViolationTransitionAllowed(
  from: string | null | undefined,
  to: string
): boolean {
  return (VIOLATION_TRANSITIONS[from ?? ""] ?? []).includes(to)
}

// ── KPIs (open · under review · deducted this month · total deductions) ─────

export interface ViolationKpis {
  open: number
  underReview: number
  deductedThisMonth: number
  totalDeductions: number
}

/**
 * Derive the module KPIs. Ledger rows are the source of truth for SAR totals
 * (the `deduction_amount` on the violation is the queue value; the ledger
 * carries what was actually applied/rolled back). Months are compared on the
 * `yyyy-mm` prefix of `applied_at` — no zero-filling.
 */
export function violationKpis(
  violations: { status: string | null }[],
  ledger: { deduction_amount: number | null; status: string | null; applied_at: string | null }[],
  now: Date
): ViolationKpis {
  const monthKey = deductionMonthKey(now)
  let deductedThisMonth = 0
  let totalDeductions = 0
  for (const r of ledger) {
    if (r.status !== "applied") continue
    const amount = Number(r.deduction_amount ?? 0)
    totalDeductions += amount
    if ((r.applied_at ?? "").slice(0, 7) === monthKey) deductedThisMonth += amount
  }
  return {
    open: violations.filter((v) => v.status === "open").length,
    underReview: violations.filter((v) => v.status === "under_review").length,
    deductedThisMonth,
    totalDeductions,
  }
}

// ── Timeline (created → reviewed → queued → applied/waived/rolled back) ─────

export interface ViolationTimelineEvent {
  key: "reported" | "reviewed" | "queued" | "applied" | "rolled_back" | "waived"
  at: string
  by?: string | null
  note?: string | null
}

type LedgerLite = {
  status: string | null
  created_at: string | null
  applied_at: string | null
  rolled_back_at: string | null
  rollback_reason: string | null
}

/**
 * Compose the violation's event timeline from its own review columns plus its
 * ledger rows (queued/applied/rolled_back). Events without a timestamp are
 * absent, never zero-filled. Sorted ascending by time.
 */
export function buildViolationTimeline(
  v: {
    reported_at: string | null
    reported_by: string | null
    reviewed_at: string | null
    reviewed_by: string | null
    waived_at: string | null
    waived_by: string | null
    waiver_reason?: string | null
  },
  ledger: LedgerLite[] = []
): ViolationTimelineEvent[] {
  const events: ViolationTimelineEvent[] = []
  if (v.reported_at) events.push({ key: "reported", at: v.reported_at, by: v.reported_by })
  if (v.reviewed_at) events.push({ key: "reviewed", at: v.reviewed_at, by: v.reviewed_by })
  if (v.waived_at) events.push({ key: "waived", at: v.waived_at, by: v.waived_by, note: v.waiver_reason ?? null })
  for (const l of ledger) {
    if (l.created_at) events.push({ key: "queued", at: l.created_at })
    if (l.applied_at) events.push({ key: "applied", at: l.applied_at })
    if (l.rolled_back_at) events.push({ key: "rolled_back", at: l.rolled_back_at, note: l.rollback_reason })
  }
  return events.sort((a, b) => a.at.localeCompare(b.at))
}

// ── Waiver limit (system_settings violations.admin_waiver_limit_sar) ────────

/**
 * `violations.admin_waiver_limit_sar` = "Max violation amount waivable without
 * GM approval". Waivers above the limit are refused for non-GM actors (the
 * server action composes this with the role check).
 */
export function isWaiverOverLimit(amount: number, limit: number | null | undefined): boolean {
  if (limit == null) return false
  return amount > Number(limit)
}

// ── Deduction-month helpers (ledger deduction_month keys) ───────────────────

/** `yyyy-mm` key used by violation_deduction_ledger.deduction_month. */
export function deductionMonthKey(d: Date | string): string {
  const iso = typeof d === "string" ? d : d.toISOString()
  return iso.slice(0, 7)
}

/** Current month + `count - 1` following months (queue-ahead options). */
export function deductionMonthOptions(now: Date, count = 3): string[] {
  const out: string[] = []
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  for (let i = 0; i < count; i++) {
    out.push(deductionMonthKey(d.toISOString()))
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return out
}

// ── Payroll-period guards (pure twins of the server-action checks) ──────────

/**
 * Ledger rows may only be applied to UNPOSTED periods. The prompt is strict:
 * `draft` / `calculated` only — never in_review/approved/paid/locked.
 */
export function canApplyToPeriod(status: string | null | undefined): boolean {
  return status === "draft" || status === "calculated"
}

/** Rollback is refused once the period is locked or actually paid. */
export function canRollbackFromPeriod(status: string | null | undefined): boolean {
  return status !== "locked" && status !== "paid"
}

// ── External-fines CSV paste parser ─────────────────────────────────────────

export interface ParsedFineRow {
  ok: boolean
  rowNumber: number
  external_ref: string
  external_source: string
  vehicle_plate: string
  violation_date: string
  violation_location: string
  violation_type_code: string
  fine_amount: number | null
  payment_deadline: string
  match_notes: string
  error?: string
}

export interface ParseFinesResult {
  rows: ParsedFineRow[]
  okCount: number
  errorCount: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse pasted government-fine rows. Header (1st non-empty row) is REQUIRED;
 * `external_ref` is the only mandatory column — the (tenant, external_ref,
 * source) UNIQUE key makes re-imports idempotent at the DB level (duplicates
 * surface as per-row failures, partial-failure style).
 */
export function parseFinesCsv(text: string): ParseFinesResult {
  // parseCsv (accounting/csv-utils) is RFC-4180-ish, client-safe and shared.
  const raw = parseCsv(text.replace(/^\uFEFF/, ""))
  if (raw.length === 0) {
    return { rows: [], okCount: 0, errorCount: 0 }
  }
  const header = raw[0].map((h) => h.trim().toLowerCase())
  if (!header.includes("external_ref")) {
    return {
      rows: [
        {
          ok: false,
          rowNumber: 1,
          external_ref: "",
          external_source: "",
          vehicle_plate: "",
          violation_date: "",
          violation_location: "",
          violation_type_code: "",
          fine_amount: null,
          payment_deadline: "",
          match_notes: "",
          error: 'missing required column "external_ref" in header',
        },
      ],
      okCount: 0,
      errorCount: 1,
    }
  }
  const idx = (name: string) => header.indexOf(name)

  const rows: ParsedFineRow[] = []
  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i]
    const rowNumber = i + 1
    const external_ref = (cells[idx("external_ref")] ?? "").trim()
    const external_source = (cells[idx("external_source")] ?? "").trim()
    const vehicle_plate = (cells[idx("vehicle_plate")] ?? "").trim()
    const violation_date = (cells[idx("violation_date")] ?? "").trim()
    const violation_location = (cells[idx("violation_location")] ?? "").trim()
    const violation_type_code = (cells[idx("violation_type_code")] ?? "").trim()
    const fine_amount = num(cells[idx("fine_amount")])
    const payment_deadline = (cells[idx("payment_deadline")] ?? "").trim()
    const match_notes = (cells[idx("match_notes")] ?? "").trim()

    let error: string | undefined
    if (!external_ref) error = "external_ref is required"
    else if (violation_date && !DATE_RE.test(violation_date)) error = "violation_date must be yyyy-mm-dd"
    else if (payment_deadline && !DATE_RE.test(payment_deadline)) error = "payment_deadline must be yyyy-mm-dd"
    else if (fine_amount !== null && fine_amount < 0) error = "fine_amount must be ≥ 0"

    rows.push({
      ok: !error,
      rowNumber,
      external_ref,
      external_source,
      vehicle_plate,
      violation_date,
      violation_location,
      violation_type_code,
      fine_amount,
      payment_deadline,
      match_notes,
      error,
    })
  }
  return {
    rows,
    okCount: rows.filter((r) => r.ok).length,
    errorCount: rows.filter((r) => !r.ok).length,
  }
}

/** Map an external-fine source onto the violations.source enum; 'manual' fallback. */
export function fineSourceToViolationSource(
  source: string | null | undefined
): "manual" | "absher" | "najm" | "moi" | "platform_report" | "internal" {
  if (source === "najm" || source === "moi" || source === "absher") return source
  return "manual"
}
