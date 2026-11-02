// Expense claims dashboard maths. Amounts are always grouped per currency —
// never summed across currencies. Receipt VAT is "shown on receipts"
// (unverified until approved); it is never labelled recoverable/deductible.
import { COUNTED_STATUSES, PENDING_STATUSES, num, type ClaimStatus, type ExpenseClaim } from "./constants"

export interface ClaimFilters {
  from?: string | null
  to?: string | null
  status?: ClaimStatus[] | null
  category?: string[] | null
  department?: string[] | null
  submitter?: string[] | null
  currency?: string[] | null
  q?: string | null
}

export function claimDate(c: Pick<ExpenseClaim, "expense_date" | "created_at">): string {
  return c.expense_date ?? c.created_at.slice(0, 10)
}

export function filterClaims<T extends ExpenseClaim>(claims: T[], f: ClaimFilters, names: Record<string, string> = {}): T[] {
  const has = (list: string[] | null | undefined, v: string | null) => !list?.length || list.includes(v ?? "")
  const q = f.q?.trim().toLowerCase()
  return claims.filter((c) => {
    const d = claimDate(c)
    if (f.from && d < f.from) return false
    if (f.to && d > f.to) return false
    if (!has(f.status, c.status) || !has(f.category, c.category) || !has(f.department, c.department) || !has(f.submitter, c.submitter_id) || !has(f.currency, c.currency)) return false
    if (q) {
      const hay = [c.claim_no, c.supplier_name, c.receipt_number, c.business_purpose, c.department, c.project, c.cost_center, c.customer, names[c.submitter_id]].join(" ").toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export interface Money { total: number; vat: number; net: number; count: number }
const zero = (): Money => ({ total: 0, vat: 0, net: 0, count: 0 })
const r2 = (n: number) => Math.round(n * 100) / 100

function add(m: Money, c: ExpenseClaim) {
  const total = num(c.total_amount) ?? 0, vat = num(c.vat_amount) ?? 0
  m.total = r2(m.total + total); m.vat = r2(m.vat + vat)
  m.net = r2(m.net + (num(c.amount_before_vat) ?? Math.max(0, total - vat))); m.count += 1
}

export type GroupKey = "month" | "category" | "department" | "submitter" | "supplier" | "status"

export function groupValue(c: ExpenseClaim, by: GroupKey): string {
  switch (by) {
    case "month": return claimDate(c).slice(0, 7)
    case "category": return c.category ?? ""
    case "department": return c.department?.trim() || ""
    case "submitter": return c.submitter_id
    case "supplier": return c.supplier_name?.trim() || ""
    case "status": return c.status
  }
}

export interface GroupRow { key: string; currency: string; money: Money }

/** Per (group, currency) totals, sorted by currency then total desc (month: chronological). */
export function breakdown(claims: ExpenseClaim[], by: GroupKey): GroupRow[] {
  const map = new Map<string, GroupRow>()
  for (const c of claims) {
    const key = groupValue(c, by)
    const id = `${c.currency}\u0000${by === "supplier" ? key.toLowerCase() : key}`
    let row = map.get(id)
    if (!row) { row = { key, currency: c.currency, money: zero() }; map.set(id, row) }
    add(row.money, c)
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency) || (by === "month" ? a.key.localeCompare(b.key) : b.money.total - a.money.total || a.key.localeCompare(b.key)))
}

export interface CurrencyKpi {
  currency: string
  approved: Money      // approved + exported + reimbursed
  pending: Money       // submitted + needs_info
  reimbursed: Money
  awaitingReimbursement: Money // approved + exported
  vatShownReviewed: number    // VAT shown on approved receipts (reviewed, still not a tax determination)
  vatShownUnverified: number  // VAT shown on pending receipts
}

export interface DashboardAlerts {
  missingDocuments: string[]   // submitted/needs_info/approved claims with no attachment
  possibleDuplicates: string[]
  needsInfo: string[]
  unverifiedFields: string[]   // pending claims still carrying OCR/Telegram suggestions
  amountsMismatch: string[]    // before VAT + VAT ≠ total (beyond 0.05)
}

export interface Dashboard {
  counts: Record<ClaimStatus, number>
  byCurrency: CurrencyKpi[]
  alerts: DashboardAlerts
}

export function amountsMismatch(c: Pick<ExpenseClaim, "amount_before_vat" | "vat_amount" | "total_amount">): boolean {
  const n = num(c.amount_before_vat), v = num(c.vat_amount), t = num(c.total_amount)
  return n !== null && v !== null && t !== null && Math.abs(n + v - t) > 0.05
}

export function buildDashboard(claims: ExpenseClaim[], attachmentCounts: Record<string, number>): Dashboard {
  const counts = { draft: 0, submitted: 0, needs_info: 0, approved: 0, rejected: 0, exported: 0, reimbursed: 0 } as Record<ClaimStatus, number>
  const cur = new Map<string, CurrencyKpi>()
  const alerts: DashboardAlerts = { missingDocuments: [], possibleDuplicates: [], needsInfo: [], unverifiedFields: [], amountsMismatch: [] }
  for (const c of claims) {
    counts[c.status] += 1
    let k = cur.get(c.currency)
    if (!k) { k = { currency: c.currency, approved: zero(), pending: zero(), reimbursed: zero(), awaitingReimbursement: zero(), vatShownReviewed: 0, vatShownUnverified: 0 }; cur.set(c.currency, k) }
    const vat = num(c.vat_amount) ?? 0
    if (COUNTED_STATUSES.includes(c.status)) { add(k.approved, c); k.vatShownReviewed = r2(k.vatShownReviewed + vat) }
    if (PENDING_STATUSES.includes(c.status)) { add(k.pending, c); k.vatShownUnverified = r2(k.vatShownUnverified + vat) }
    if (c.status === "reimbursed") add(k.reimbursed, c)
    if (c.status === "approved" || c.status === "exported") add(k.awaitingReimbursement, c)
    const live = c.status !== "draft" && c.status !== "rejected"
    if (live && !(attachmentCounts[c.id] > 0)) alerts.missingDocuments.push(c.id)
    if (c.duplicate_status === "possible" && c.status !== "rejected") alerts.possibleDuplicates.push(c.id)
    if (c.status === "needs_info") alerts.needsInfo.push(c.id)
    if (PENDING_STATUSES.includes(c.status) && c.unverified_fields?.length) alerts.unverifiedFields.push(c.id)
    if (live && amountsMismatch(c)) alerts.amountsMismatch.push(c.id)
  }
  return { counts, byCurrency: [...cur.values()].sort((a, b) => a.currency.localeCompare(b.currency)), alerts }
}

export function formatMoney(amount: number | null | undefined, currency: string, locale: "en-US" | "ar-SA" = "en-US"): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—"
  try {
    return new Intl.NumberFormat(locale === "ar-SA" ? "ar-SA-u-nu-arab" : "en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
  } catch { return `${amount.toFixed(2)} ${currency}` }
}
