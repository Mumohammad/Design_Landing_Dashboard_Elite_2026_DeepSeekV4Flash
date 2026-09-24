// Pure helpers for the Audit-Trail module (read-only surface over audit_log).
//
// No Supabase / React imports — unit-testable per the drivers/users-module
// precedent (vitest, node environment).
//
// PDPL note: audit rows may embed personal data in their JSONB payloads
// (e.g. drivers.created carries primary_mobile, iqama_number; users.created
// carries the invited email). maskAuditMetadata() mirrors the drivers/users
// masking gate: when the ACTOR's PDPL consent is absent, sensitive keys are
// masked in-place before rendering or export.

/** Module keys written by writeAuditLog() across the app (see 007 comment). */
export const AUDIT_MODULES = [
  "drivers",
  "vehicles",
  "attendance",
  "payroll",
  "violations",
  "expenses",
  "orders",
  "accounting",
  "invoices",
  "platforms",
  "applications",
  "webhooks",
  "reports",
  "templates",
  "users",
  "roles",
  "settings",
  "security",
  "audit_log",
] as const

export type AuditModule = (typeof AUDIT_MODULES)[number]

/** Bilingual module labels for the badge column + facet. */
export const MODULE_META: Record<string, { ar: string; en: string; color: string }> = {
  drivers: { ar: "السائقون", en: "Drivers", color: "#1E5A99" },
  vehicles: { ar: "المركبات", en: "Vehicles", color: "#0EA5E9" },
  attendance: { ar: "الحضور", en: "Attendance", color: "#10B981" },
  payroll: { ar: "الرواتب", en: "Payroll", color: "#F59E0B" },
  violations: { ar: "المخالفات", en: "Violations", color: "#EF4444" },
  expenses: { ar: "المصروفات", en: "Expenses", color: "#E87D3E" },
  orders: { ar: "الطلبات", en: "Orders", color: "#6366F1" },
  accounting: { ar: "المحاسبة", en: "Accounting", color: "#8B5CF6" },
  invoices: { ar: "الفواتير", en: "Invoices", color: "#8B5CF6" },
  platforms: { ar: "المنصات", en: "Platforms", color: "#14B8A6" },
  applications: { ar: "الطلبات الواردة", en: "Applications", color: "#0EA5E9" },
  webhooks: { ar: "الويب هوكس", en: "Webhooks", color: "#64748B" },
  reports: { ar: "التقارير", en: "Reports", color: "#10B981" },
  templates: { ar: "القوالب", en: "Templates", color: "#64748B" },
  users: { ar: "المستخدمون", en: "Users", color: "#1E5A99" },
  roles: { ar: "الأدوار", en: "Roles", color: "#8B5CF6" },
  settings: { ar: "الإعدادات", en: "Settings", color: "#64748B" },
  security: { ar: "الأمان", en: "Security", color: "#EF4444" },
  audit_log: { ar: "سجل التدقيق", en: "Audit log", color: "#64748B" },
}

/** Actions observed in writeAuditLog() call sites across the app. */
export const AUDIT_ACTIONS = [
  "created",
  "updated",
  "status_changed",
  "archived",
  "deleted",
  "role_assigned",
  "employee_code_assigned",
  "mfa_enrolled",
  "mfa_challenge_failed",
  "exported",
  "login_failed",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Bilingual action labels for the action facet + row rendering. */
export const ACTION_META: Record<string, { ar: string; en: string }> = {
  created: { ar: "إنشاء", en: "Created" },
  updated: { ar: "تحديث", en: "Updated" },
  status_changed: { ar: "تغيير حالة", en: "Status changed" },
  archived: { ar: "أرشفة", en: "Archived" },
  deleted: { ar: "حذف", en: "Deleted" },
  role_assigned: { ar: "إسناد دور", en: "Role assigned" },
  employee_code_assigned: { ar: "إسناد رمز وظيفي", en: "Employee code assigned" },
  mfa_enrolled: { ar: "تفعيل التحقق الثنائي", en: "MFA enrolled" },
  mfa_challenge_failed: { ar: "فشل تحقق ثنائي", en: "MFA challenge failed" },
  exported: { ar: "تصدير", en: "Exported" },
  login_failed: { ar: "فشل تسجيل دخول", en: "Login failed" },
}

/** Hard pagination caps (repo convention — users/drivers list surfaces). */
export const AUDIT_PAGE_SIZE_MAX = 100
export const AUDIT_PAGE_SIZE_DEFAULT = 50

/**
 * Entity types for the type facet + drill-down. Keys match the
 * `entityType` values used by writeAuditLog() call sites.
 */
export const AUDIT_ENTITY_TYPES = [
  "driver",
  "user",
  "invoice",
  "journal_entry",
  "payment",
  "order",
  "vehicle",
  "leave_request",
  "expense",
  "setting",
  "role",
] as const

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]

/**
 * JSON keys considered sensitive inside audit payloads (old_values /
 * new_values). Matched case-insensitively as a SUBSTRING of the key name so
 * real-world prefixed fields (primary_mobile, iqama_number, passport_number,
 * work_email) are covered — payload VALUES are not inspected, so structured
 * nesting is safe to walk.
 */
const SENSITIVE_KEY_PATTERN =
  /(iqama|passport|license|iban|salary|mobile|phone|email|national_id|password|secret|otp|token|two_factor|national_address|date_of_birth)/

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.toLowerCase())
}

const MASK = "••••••"
const MAX_MASK_DEPTH = 8

/**
 * PDPL masking for audit metadata: returns a deep copy of the payload where
 * every value under a sensitive key is replaced with the mask when `consent`
 * is absent. Non-sensitive scalars, arrays, and nested objects pass through
 * (bounded by MAX_MASK_DEPTH). Null payloads return null.
 */
export function maskAuditMetadata(
  payload: Record<string, unknown> | null | undefined,
  consent: boolean
): Record<string, unknown> | null {
  if (!payload) return null
  return maskValue(payload, consent, 0) as Record<string, unknown>
}

function maskValue(value: unknown, consent: boolean, depth: number): unknown {
  if (depth > MAX_MASK_DEPTH) return null
  if (Array.isArray(value)) {
    return value.map((v) => maskValue(v, consent, depth + 1))
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) && !consent ? MASK : maskValue(v, consent, depth + 1)
    }
    return out
  }
  return value
}

/**
 * Recursively collect every string value reachable under a sensitive key —
 * the mirror of maskAuditMetadata, used to keep audit row TEXT (search,
 * drill-down labels) out of CSV exports when consent is absent.
 */
export function collectSensitiveStrings(
  payload: Record<string, unknown> | null | undefined,
  consent: boolean
): string[] {
  if (!payload) return []
  const out: string[] = []
  walk(payload, consent, 0, out)
  return out
}

function walk(value: unknown, consent: boolean, depth: number, out: string[]): void {
  if (depth > MAX_MASK_DEPTH) return
  if (typeof value === "string") {
    if (value.trim()) out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, consent, depth + 1, out)
    return
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k) && !consent) continue
      walk(v, consent, depth + 1, out)
    }
  }
}

/**
 * Pretty-render an audit payload for the collapsed-by-default metadata cell.
 * Masking is applied BEFORE serialization so sensitive values never reach
 * the DOM unmasked.
 */
export function prettyMetadata(
  payload: Record<string, unknown> | null | undefined,
  consent: boolean
): string | null {
  const masked = maskAuditMetadata(payload, consent)
  if (!masked || Object.keys(masked).length === 0) return null
  try {
    return JSON.stringify(masked, null, 2)
  } catch {
    return null
  }
}

export type CsvCell = string | number | boolean | null | undefined

/** RFC-4180-safe CSV line builder with a UTF-8 BOM (Excel + Arabic safe). */
export function auditToCsv(header: string[], rows: CsvCell[][]): string {
  const escape = (v: CsvCell) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "\uFEFF" + [header, ...rows].map((r) => r.map(escape).join(",")).join("\n")
}

export type AuditFilterState = {
  from: string
  to: string
  actor: string // users.id | "all"
  action: string // AuditAction | "all"
  module: string // AuditModule | "all"
  entityType: string // AuditEntityType | "all"
  entityId: string
}

export const EMPTY_FILTERS: AuditFilterState = {
  from: "",
  to: "",
  actor: "all",
  action: "all",
  module: "all",
  entityType: "all",
  entityId: "",
}

/**
 * Drill-down link for one entity's full history. Used by the per-row action
 * and the entity-type facet; the target is this same list pre-filtered.
 */
export function entityDrillHref(entityType: string, entityId: string): string {
  const params = new URLSearchParams()
  params.set("entityType", entityType)
  if (entityId) params.set("entityId", entityId)
  return `/audit-log?${params.toString()}`
}

/** ISO date (yyyy-mm-dd) -> inclusive local ISO range bounds for the RPC. */
export function dateRangeBounds(from: string, to: string): { fromIso: string | null; toIso: string | null } {
  const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00` : null
  const toIso = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999` : null
  return { fromIso, toIso }
}
