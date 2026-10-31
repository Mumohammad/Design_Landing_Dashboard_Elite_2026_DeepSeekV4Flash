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
  | "driver_document"
  | "vehicle_document"
  | "vehicle_inspection"
  | "maintenance_due"
  | "invoice_overdue"
  | "payable_due"
  | "approvals_pending"
  | "violations_open"

export type NotificationCategory = "drivers" | "vehicles" | "maintenance" | "finance" | "approvals" | "violations"

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = ["drivers", "vehicles", "maintenance", "finance", "approvals", "violations"]

export const KIND_CATEGORY: Record<NotificationKind, NotificationCategory> = {
  driver_iqama: "drivers",
  driver_license: "drivers",
  driver_passport: "drivers",
  driver_contract: "drivers",
  driver_document: "drivers",
  vehicle_insurance: "vehicles",
  vehicle_registration: "vehicles",
  vehicle_operating_card: "vehicles",
  vehicle_rental: "vehicles",
  vehicle_document: "vehicles",
  vehicle_inspection: "vehicles",
  maintenance_due: "maintenance",
  invoice_overdue: "finance",
  payable_due: "finance",
  approvals_pending: "approvals",
  violations_open: "violations",
}

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
  /** Document type label key for driver/vehicle document rows. */
  docType?: string
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

export interface VehicleInspectionRow {
  id: string
  plate_number: string | null
  inspection_expiry: string | null
}

export interface EntityDocumentRow {
  id: string
  owner_id: string
  owner_label: string | null
  document_type: string | null
  expiry_date: string | null
}

export interface MaintenanceDueRow {
  vehicle_id: string
  plate_number: string | null
  next_service_date: string | null
}

export interface PayableDueRow {
  id: string
  invoice_ref: string | null
  due_date: string | null
  total_amount: number | string | null
  paid_amount: number | string | null
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
  vehicleInspections?: VehicleInspectionRow[]
  driverDocuments?: EntityDocumentRow[]
  vehicleDocuments?: EntityDocumentRow[]
  maintenance?: MaintenanceDueRow[]
  payables?: PayableDueRow[]
  openViolations?: number
  categories?: NotificationCategory[]
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

  for (const v of input.vehicleInspections ?? []) {
    push(expiryItem("vehicle_inspection", v.id, v.plate_number || v.id.slice(0, 8), v.inspection_expiry, today, `/vehicles/${v.id}`, horizon))
  }

  const docItem = (kind: "driver_document" | "vehicle_document", d: EntityDocumentRow, base: string) => {
    const item = expiryItem(kind, d.id, d.owner_label || d.owner_id.slice(0, 8), d.expiry_date, today, `${base}/${d.owner_id}`, horizon)
    if (item) item.docType = d.document_type ?? "other"
    push(item)
  }
  for (const d of input.driverDocuments ?? []) docItem("driver_document", d, "/drivers")
  for (const d of input.vehicleDocuments ?? []) docItem("vehicle_document", d, "/vehicles")

  // Latest planned service per vehicle only.
  const nextService = new Map<string, MaintenanceDueRow>()
  for (const m of input.maintenance ?? []) {
    if (!m.next_service_date) continue
    const prev = nextService.get(m.vehicle_id)
    if (!prev || (prev.next_service_date ?? "") < m.next_service_date) nextService.set(m.vehicle_id, m)
  }
  for (const m of nextService.values()) {
    const item = expiryItem("maintenance_due", m.vehicle_id, m.plate_number || m.vehicle_id.slice(0, 8), m.next_service_date, today, "/maintenance", horizon)
    if (item && item.days !== null && item.days >= 0) item.severity = item.days <= 3 ? "warning" : "info"
    push(item)
  }

  for (const p of input.payables ?? []) {
    if (!p.due_date) continue
    const open = Math.round((Number(p.total_amount ?? 0) - Number(p.paid_amount ?? 0)) * 100) / 100
    const days = daysBetween(today, p.due_date)
    if (!(open > 0) || days === null || days > 7) continue
    items.push({
      id: `payable_due:${p.id}:${p.due_date.slice(0, 10)}`,
      kind: "payable_due",
      severity: days < 0 ? "critical" : "warning",
      subject: p.invoice_ref || p.id.slice(0, 8),
      date: p.due_date.slice(0, 10),
      days,
      amount: open,
      href: "/accounting?tab=payables",
    })
  }

  if ((input.openViolations ?? 0) > 0) {
    items.push({
      id: `violations_open:${today}:${input.openViolations}`,
      kind: "violations_open",
      severity: "warning",
      subject: "",
      date: null,
      days: null,
      count: input.openViolations,
      href: "/violations",
    })
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

  const allowed = input.categories && input.categories.length > 0 ? new Set(input.categories) : null
  if (allowed) {
    const kept = items.filter((i) => allowed.has(KIND_CATEGORY[i.kind]))
    items.length = 0
    items.push(...kept)
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
  driver_document: { ar: "وثيقة سائق", en: "Driver document" },
  vehicle_document: { ar: "وثيقة مركبة", en: "Vehicle document" },
  vehicle_inspection: { ar: "الفحص الدوري", en: "Periodic inspection" },
  maintenance_due: { ar: "صيانة مجدولة", en: "Scheduled service" },
  invoice_overdue: { ar: "فاتورة متأخرة السداد", en: "Overdue invoice" },
  payable_due: { ar: "مستحق للمورد", en: "Supplier bill due" },
  approvals_pending: { ar: "طلبات بانتظار الموافقة", en: "Pending approvals" },
  violations_open: { ar: "مخالفات مفتوحة", en: "Open violations" },
}

const DOC_TYPE_COPY: Record<string, { ar: string; en: string }> = {
  iqama: { ar: "الإقامة", en: "Iqama" },
  passport: { ar: "جواز السفر", en: "Passport" },
  driving_license: { ar: "رخصة القيادة", en: "Driving license" },
  vehicle_license: { ar: "رخصة المركبة", en: "Vehicle license" },
  medical_certificate: { ar: "الشهادة الصحية", en: "Health certificate" },
  police_clearance: { ar: "خلو السوابق", en: "Police clearance" },
  employment_contract: { ar: "عقد العمل", en: "Employment contract" },
  bank_letter: { ar: "خطاب البنك", en: "Bank letter" },
  registration: { ar: "الاستمارة", en: "Registration" },
  insurance: { ar: "التأمين", en: "Insurance" },
  inspection: { ar: "الفحص الدوري", en: "Inspection" },
  operating_card: { ar: "بطاقة التشغيل", en: "Operating card" },
  ownership: { ar: "وثيقة الملكية", en: "Ownership" },
  modification_permit: { ar: "تصريح تعديل", en: "Modification permit" },
  other: { ar: "وثيقة أخرى", en: "Other document" },
}

export const CATEGORY_COPY: Record<NotificationCategory, { ar: string; en: string }> = {
  drivers: { ar: "السائقون", en: "Drivers" },
  vehicles: { ar: "المركبات", en: "Vehicles" },
  maintenance: { ar: "الصيانة", en: "Maintenance" },
  finance: { ar: "المالية", en: "Finance" },
  approvals: { ar: "الموافقات", en: "Approvals" },
  violations: { ar: "المخالفات", en: "Violations" },
}

export function notificationTitle(kind: NotificationKind, locale: "ar" | "en", docType?: string): string {
  if ((kind === "driver_document" || kind === "vehicle_document") && docType) {
    const doc = DOC_TYPE_COPY[docType] ?? DOC_TYPE_COPY.other
    return doc[locale]
  }
  return KIND_COPY[kind][locale]
}

/** Human status line, e.g. "انتهت منذ 3 أيام" / "Expires in 5 days". */
export function notificationStatus(item: NotificationItem, locale: "ar" | "en"): string {
  const ar = locale === "ar"
  if (item.kind === "approvals_pending") {
    const n = item.count ?? 0
    return ar ? `${n} طلب بانتظار قرارك` : `${n} request${n === 1 ? "" : "s"} awaiting a decision`
  }
  if (item.kind === "violations_open") {
    const n = item.count ?? 0
    return ar ? `${n} مخالفة بحاجة لمعالجة` : `${n} violation${n === 1 ? "" : "s"} need action`
  }
  const d = item.days ?? 0
  if (item.kind === "invoice_overdue" || (item.kind === "payable_due" && d < 0)) {
    const late = Math.abs(d)
    return ar ? `متأخرة ${late} يوم` : `${late} day${late === 1 ? "" : "s"} overdue`
  }
  if (item.kind === "payable_due") return ar ? (d === 0 ? "تستحق اليوم" : `تستحق خلال ${d} يوم`) : d === 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}`
  if (item.kind === "maintenance_due") {
    if (d < 0) return ar ? `متأخرة ${Math.abs(d)} يوم` : `${Math.abs(d)} day${d === -1 ? "" : "s"} overdue`
    return ar ? (d === 0 ? "مستحقة اليوم" : `مستحقة خلال ${d} يوم`) : d === 0 ? "Due today" : `Due in ${d} day${d === 1 ? "" : "s"}`
  }
  if (d < 0) {
    const n = Math.abs(d)
    return ar ? `انتهت منذ ${n} يوم` : `Expired ${n} day${n === 1 ? "" : "s"} ago`
  }
  if (d === 0) return ar ? "تنتهي اليوم" : "Expires today"
  return ar ? `تنتهي خلال ${d} يوم` : `Expires in ${d} day${d === 1 ? "" : "s"}`
}
