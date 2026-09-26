// Pure helpers for the Approvals module (unified decision inbox).
//
// No Supabase / React imports — unit-testable per the drivers/users/audit-trail
// module precedent (vitest, node environment).
//
// The queue composes THREE pre-existing decision sources (nothing invented):
//   expense        → expenses.is_approved = false            (021)
//   leave_request  → driver_leave_requests.status = pending  (018)
//   application    → driver_applications.status IN (submitted, under_review) (029/030)
//
// PDPL note: applicant PII (mobile, identity numbers) is never projected from
// the queue RPC — the RPC returns a presence flag only, and the server layer
// masks requester names per the users-module consent gate (maskRequesterName).

/** Queue item types (the `item_type` discriminator from fetch_pending_approvals). */
export const APPROVAL_ITEM_TYPES = [
  "expense",
  "leave_request",
  "application",
] as const

export type ApprovalItemType = (typeof APPROVAL_ITEM_TYPES)[number]

/** Bilingual type badge labels for the queue's type column + facet. */
export const APPROVAL_TYPE_META: Record<
  ApprovalItemType,
  { ar: string; en: string; color: string; module: string; entity: string; href: string }
> = {
  expense: {
    ar: "مصروف",
    en: "Expense",
    color: "#E87D3E",
    module: "expenses",
    entity: "expense",
    href: "/expenses",
  },
  leave_request: {
    ar: "إجازة سائق",
    en: "Driver leave",
    color: "#0EA5E9",
    module: "attendance",
    entity: "leave_request",
    href: "/drivers",
  },
  application: {
    ar: "طلب توظيف",
    en: "Application",
    color: "#6366F1",
    module: "hr",
    entity: "driver_application",
    href: "/applications",
  },
}

/** Hard pagination caps (repo convention — audit/users/drivers surfaces). */
export const APPROVALS_PAGE_SIZE_MAX = 100
export const APPROVALS_PAGE_SIZE_DEFAULT = 50

/** Error codes surfaced by the decision RPCs (raw passthrough taxonomy). */
export const DECISION_ERROR_CODES = {
  LVE001: { ar: "طلب الإجازة غير موجود", en: "Leave request not found" },
  LVE002: { ar: "تم البت في هذا الطلب مسبقاً", en: "This leave request was already decided" },
  LVE003: { ar: "قرار غير صالح", en: "Invalid decision" },
  LVE004: { ar: "سبب الرفض مطلوب", en: "A rejection reason is required" },
  APP001: { ar: "الطلب غير موجود", en: "Application not found" },
  APP002: { ar: "تم البت في هذا الطلب مسبقاً", en: "This application was already decided" },
  APP003: { ar: "قرار غير صالح", en: "Invalid decision" },
  APP004: { ar: "سبب الرفض مطلوب", en: "A rejection note is required" },
} as const

export type DecisionErrorCode = keyof typeof DECISION_ERROR_CODES

/** True when the message begins with a known decision error code. */
export function isDecisionErrorCode(message: string): message is `${DecisionErrorCode}: ${string}` {
  const code = message.split(":")[0]?.trim()
  return code !== "" && Object.prototype.hasOwnProperty.call(DECISION_ERROR_CODES, code)
}

/** Bilingual envelope for a decision error message (raw passthrough otherwise). */
export function decisionErrorText(message: string, isAr: boolean): string {
  const code = message.split(":")[0]?.trim() as DecisionErrorCode | ""
  if (code && isDecisionErrorCode(message)) {
    return isAr ? DECISION_ERROR_CODES[code].ar : DECISION_ERROR_CODES[code].en
  }
  return message
}

export type ApprovalSubjectMeta = {
  amount?: number | string | null
  currency?: string | null
  expense_type?: string | null
  category?: string | null
  vendor?: string | null
  expense_date?: string | null
  driver_id?: string | null
  leave_type?: string | null
  start_date?: string | null
  end_date?: string | null
  days_requested?: number | null
  reason?: string | null
  full_name?: string | null
  mobile_hashed?: string | null
  city?: string | null
  work_type?: string | null
  driver_category?: string | null
  status?: string | null
}

/** Queue row shape returned by fetch_pending_approvals (RPC projection). */
export type ApprovalQueueRow = {
  /** EnterpriseModulePage generic constraint (row key). */
  id?: string
  item_type: ApprovalItemType
  item_id: string
  subject: string
  subject_meta: ApprovalSubjectMeta
  requester: string
  requested_at: string
}

/** Bilingual one-line subject for the queue's subject column. */
export function subjectLine(row: Pick<ApprovalQueueRow, "item_type" | "subject" | "subject_meta">, isAr: boolean): string {
  const m = row.subject_meta ?? {}
  switch (row.item_type) {
    case "expense": {
      const amount = Number(m.amount ?? 0)
      const cur = m.currency ?? "SAR"
      return `${row.subject} — ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`
    }
    case "leave_request": {
      const days = m.days_requested ?? 0
      return `${m.leave_type ?? row.subject} · ${isAr ? `${days} أيام` : `${days} days`}`
    }
    case "application":
      return m.full_name ?? row.subject
  }
}

/**
 * PDPL masking for the requester column. Application requester names are
 * masked behind the users-module consent gate — when consent is absent the
 * full name collapses to its initials; expense vendors are supplier entities
 * (not data subjects) and pass through; leave requesters are internal staff
 * and pass through. Consent resolution happens server-side (queries.ts).
 */
export function maskRequesterName(
  itemType: ApprovalItemType,
  requester: string,
  full_name: string | null,
  consent: boolean
): string {
  if (itemType !== "application") return requester || "—"
  const name = (full_name ?? "").trim()
  if (!name) return "—"
  if (consent) return name
  const parts = name.split(/\s+/).filter(Boolean)
  return parts
    .map((p) => `${Array.from(p)[0] ?? ""}.`)
    .join(" ")
    .trim() || "—"
}

/** "Age" of a pending item in days (queue column — human decision latency). */
export function pendingAgeDays(requestedAt: string, now = new Date()): number {
  const t = new Date(requestedAt).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}

/** True when the item waited longer than the escalation threshold (3 days). */
export function isStale(requestedAt: string, now = new Date()): boolean {
  return pendingAgeDays(requestedAt, now) >= 3
}

export type ApprovalFilterState = {
  from: string
  to: string
  type: ApprovalItemType | "all"
}

export const EMPTY_FILTERS: ApprovalFilterState = {
  from: "",
  to: "",
  type: "all",
}

export function isFiltersActive(f: ApprovalFilterState): boolean {
  return f.from !== "" || f.to !== "" || f.type !== "all"
}

/** ISO date (yyyy-mm-dd) -> inclusive local ISO range bounds for the RPC. */
export function dateRangeBounds(from: string, to: string): { fromIso: string | null; toIso: string | null } {
  const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00` : null
  const toIso = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : null
  return { fromIso, toIso }
}

export type CsvCell = string | number | boolean | null | undefined

/** RFC-4180-safe CSV line builder with a UTF-8 BOM (Excel + Arabic safe). */
export function approvalsToCsv(header: string[], rows: CsvCell[][]): string {
  const escape = (v: CsvCell) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "\uFEFF" + [header, ...rows].map((r) => r.map(escape).join(",")).join("\n")
}

/** Deep-link for one queue row's module surface (drives the deep-link column). */
export function itemDeepLink(row: Pick<ApprovalQueueRow, "item_type" | "item_id" | "subject_meta">): string {
  const meta = APPROVAL_TYPE_META[row.item_type]
  switch (row.item_type) {
    case "application":
      return `/applications/${row.item_id}`
    case "leave_request": {
      const driverId = row.subject_meta?.driver_id
      return driverId ? `/drivers/${driverId}` : meta.href
    }
    case "expense":
      return meta.href
  }
}
