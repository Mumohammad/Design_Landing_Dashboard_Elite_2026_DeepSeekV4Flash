// Pure builders for the in-app notification center. Client-safe: no server
// imports. Every item is derived from real tenant rows (no fabricated alerts).

export type NotificationSeverity = "critical" | "warning" | "info"

export type NotificationKind =
  | "driver_iqama"
  | "driver_license"
  | "driver_passport"
  | "driver_contract"
  | "vehicle_insurance"
  | "vehicle_registration"
  | "vehicle_operating_card"
  | "vehicle_rental"
  | "invoice_overdue"
  | "approvals_pending"

export interface NotificationItem {
  /** Stable id: kind + entity + date, so a "read" mark survives refreshes but
   *  a renewed document (new date) raises a fresh notification. */
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  subject: string
  /** ISO date the alert refers to (expiry / due date), when applicable. */
  date: string | null
  /** Days until `date` (negative = past). */
  days: number | null
  amount?: number
  count?: number
  href: string
}

export interface NotificationFeed {
  generatedAt: string
  items: NotificationItem[]
  total: number
  critical: number
}

export interface DriverExpiryRow {
  id: string
  full_name_ar: string | null
  full_name_en: string | null
  iqama_expiry_date: string | null
  license_expiry_date: string | null
  passport_expiry_date: string | null
  contract_end: string | null
}

export interface VehicleExpiryRow {
  id: string
  plate_number: string | null
  insurance_expiry: string | null
  registration_expiry: string | null
  operating_card_expiry: string | null
  rental_contract_end: string | null
}

export interface OverdueReceivableRow {
  id: string
  invoice_ref: string | null
  due_date: string | null
  total_amount: number | string | null
  paid_amount: number | string | null
}

export const NOTIFICATION_HORIZON_DAYS = 30
export const NOTIFICATION_LIMIT = 60

const ISO = /^\d{4}-\d{2}-\d{2}/

export function daysBetween(todayIso: string, dateIso: string): number | null {
  if (!ISO.test(todayIso) || !ISO.test(dateIso)) return null
  const a = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** Expired → critical, within 7 days → warning, within horizon → info. */
export function expirySeverity(days: number): NotificationSeverity {
  if (days < 0) return "critical"
  if (days <= 7) return "warning"
  return "info"
}

function expiryItem(
  kind: NotificationKind,
  entityId: string,
  subject: string,
  date: string | null,
  todayIso: string,
  href: string,
  horizon: number,
): NotificationItem | null {
  if (!date) return null
  const days = daysBetween(todayIso, date)
  if (days === null || days > horizon) return null
  return {
    id: `${kind}:${entityId}:${date.slice(0, 10)}`,
    kind,
    severity: expirySeverity(days),
    subject,
    date: date.slice(0, 10),
    days,
    href,
  }
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = { critical: 0, warning: 1, info: 2 }

export function buildNotificationFeed(input: {
  todayIso: string
  drivers?: DriverExpiryRow[]
  vehicles?: VehicleExpiryRow[]
  receivables?: OverdueReceivableRow[]
  pendingApprovals?: number
  horizonDays?: number
  limit?: number
  generatedAt?: string
}): NotificationFeed {
  const horizon = input.horizonDays ?? NOTIFICATION_HORIZON_DAYS
  const today = input.todayIso
  const items: NotificationItem[] = []
  const push = (item: NotificationItem | null) => {
    if (item) items.push(item)
  }

  for (const d of input.drivers ?? []) {
    const name = d.full_name_ar || d.full_name_en || d.id.slice(0, 8)
    const href = `/drivers/${d.id}`
    push(expiryItem("driver_iqama", d.id, name, d.iqama_expiry_date, today, href, horizon))
    push(expiryItem("driver_license", d.id, name, d.license_expiry_date, today, href, horizon))
    push(expiryItem("driver_passport", d.id, name, d.passport_expiry_date, today, href, horizon))
    push(expiryItem("driver_contract", d.id, name, d.contract_end, today, href, horizon))
  }

  for (const v of input.vehicles ?? []) {
    const plate = v.plate_number || v.id.slice(0, 8)
    const href = `/vehicles/${v.id}`
    push(expiryItem("vehicle_insurance", v.id, plate, v.insurance_expiry, today, href, horizon))
    push(expiryItem("vehicle_registration", v.id, plate, v.registration_expiry, today, href, horizon))
    push(expiryItem("vehicle_operating_card", v.id, plate, v.operating_card_expiry, today, href, horizon))
    push(expiryItem("vehicle_rental", v.id, plate, v.rental_contract_end, today, href, horizon))
  }

  for (const r of input.receivables ?? []) {
    if (!r.due_date) continue
    const open = Math.round((Number(r.total_amount ?? 0) - Number(r.paid_amount ?? 0)) * 100) / 100
    const days = daysBetween(today, r.due_date)
    if (!(open > 0) || days === null || days >= 0) continue
    items.push({
      id: `invoice_overdue:${r.id}:${r.due_date.slice(0, 10)}`,
      kind: "invoice_overdue",
      severity: days < -30 ? "critical" : "warning",
      subject: r.invoice_ref || r.id.slice(0, 8),
      date: r.due_date.slice(0, 10),
      days,
      amount: open,
      href: "/invoices",
    })
  }

  if ((input.pendingApprovals ?? 0) > 0) {
    items.push({
      id: `approvals_pending:${today}:${input.pendingApprovals}`,
      kind: "approvals_pending",
      severity: "info",
      subject: "",
      date: null,
      days: null,
      count: input.pendingApprovals,
      href: "/approvals",
    })
  }

  items.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (s !== 0) return s
    return (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER)
  })

  const limit = input.limit ?? NOTIFICATION_LIMIT
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    items: items.slice(0, limit),
    total: items.length,
    critical: items.filter((i) => i.severity === "critical").length,
  }
}

const KIND_COPY: Record<NotificationKind, { ar: string; en: string }> = {
  driver_iqama: { ar: "الإقامة / الهوية", en: "Iqama / ID" },
  driver_license: { ar: "رخصة القيادة", en: "Driving license" },
  driver_passport: { ar: "جواز السفر", en: "Passport" },
  driver_contract: { ar: "عقد العمل", en: "Employment contract" },
  vehicle_insurance: { ar: "تأمين المركبة", en: "Vehicle insurance" },
  vehicle_registration: { ar: "الاستمارة", en: "Vehicle registration" },
  vehicle_operating_card: { ar: "بطاقة التشغيل", en: "Operating card" },
  vehicle_rental: { ar: "عقد الإيجار", en: "Rental contract" },
  invoice_overdue: { ar: "فاتورة متأخرة السداد", en: "Overdue invoice" },
  approvals_pending: { ar: "طلبات بانتظار الموافقة", en: "Pending approvals" },
}

export function notificationTitle(kind: NotificationKind, locale: "ar" | "en"): string {
  return KIND_COPY[kind][locale]
}

/** Human status line, e.g. "انتهت منذ 3 أيام" / "Expires in 5 days". */
export function notificationStatus(item: NotificationItem, locale: "ar" | "en"): string {
  const ar = locale === "ar"
  if (item.kind === "approvals_pending") {
    const n = item.count ?? 0
    return ar ? `${n} طلب بانتظار قرارك` : `${n} request${n === 1 ? "" : "s"} awaiting a decision`
  }
  const d = item.days ?? 0
  if (item.kind === "invoice_overdue") {
    const late = Math.abs(d)
    return ar ? `متأخرة ${late} يوم` : `${late} day${late === 1 ? "" : "s"} overdue`
  }
  if (d < 0) {
    const n = Math.abs(d)
    return ar ? `انتهت منذ ${n} يوم` : `Expired ${n} day${n === 1 ? "" : "s"} ago`
  }
  if (d === 0) return ar ? "تنتهي اليوم" : "Expires today"
  return ar ? `تنتهي خلال ${d} يوم` : `Expires in ${d} day${d === 1 ? "" : "s"}`
}
