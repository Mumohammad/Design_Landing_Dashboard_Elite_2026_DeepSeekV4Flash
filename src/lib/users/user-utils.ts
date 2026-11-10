// Pure helpers for the Users module (Module 14).
//
// No Supabase / React imports — unit-testable per the drivers-module
// precedent (vitest, node environment).

/** user_status enum values (migration 002) the UI can transition between. */
export type UserStatus = "active" | "inactive" | "locked" | "pending_invite" | "terminated"

/** user_role enum values (migration 002). */
export const USER_ROLES = [
  "general_manager",
  "admin",
  "accountant",
  "supervisor",
  "hr_officer",
  "operations_officer",
  "payroll_officer",
  "platform_coordinator",
  "readonly_auditor",
] as const

export type UserRole = (typeof USER_ROLES)[number]

export const STATUS_META: Record<UserStatus, { ar: string; en: string; className: string }> = {
  active: {
    ar: "نشط",
    en: "Active",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
  },
  inactive: {
    ar: "غير نشط",
    en: "Inactive",
    className: "bg-gray-500/15 text-gray-700 dark:text-gray-300 border border-gray-500/20",
  },
  locked: {
    ar: "مقفل",
    en: "Locked",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
  pending_invite: {
    ar: "دعوة معلقة",
    en: "Pending invite",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20",
  },
  terminated: {
    ar: "منهى",
    en: "Terminated",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
}

export const ROLE_META: Record<string, { ar: string; en: string }> = {
  general_manager: { ar: "مدير عام", en: "General Manager" },
  admin: { ar: "مدير نظام", en: "Administrator" },
  accountant: { ar: "محاسب", en: "Accountant" },
  supervisor: { ar: "مشرف", en: "Supervisor" },
  hr_officer: { ar: "مسؤول موارد بشرية", en: "HR Officer" },
  operations_officer: { ar: "مسؤول عمليات", en: "Operations Officer" },
  payroll_officer: { ar: "مسؤول رواتب", en: "Payroll Officer" },
  platform_coordinator: { ar: "منسق منصات", en: "Platform Coordinator" },
  readonly_auditor: { ar: "مدقق", en: "Read-only Auditor" },
}

/**
 * Statuses an operator may transition a user to (users module status
 * lifecycle). Terminal `terminated` is reachable but not an origin —
 * matches the CRUD-parity guard in update-status.ts.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  active: ["inactive", "locked", "terminated"],
  inactive: ["active", "terminated"],
  locked: ["active", "inactive", "terminated"],
  pending_invite: ["active", "inactive", "terminated"],
  terminated: [],
}

/** True when `from → to` is an allowed status transition. */
export function isStatusTransitionAllowed(from: UserStatus, to: UserStatus): boolean {
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to)
}

/**
 * PDPL masking for sensitive profile fields (phone, national ID digits).
 * Shows the last 2 characters only when consent is granted; otherwise a
 * full mask. Mirrors the drivers-module masking gate shape.
 */
export function maskSensitiveValue(raw: string | null | undefined, consent: boolean): string {
  if (!raw || !raw.trim()) return "—"
  const v = raw.trim()
  if (!consent) return "••••••"
  if (v.length <= 2) return v
  return `${"•".repeat(Math.max(v.length - 2, 2))}${v.slice(-2)}`
}

/** First grapheme of a display name for the gradient avatar fallback. */
export function userInitial(name: string | null | undefined): string {
  const n = name?.trim()
  if (!n) return "?"
  return Array.from(n)[0] ?? "?"
}

export type CsvCell = string | number | boolean | null | undefined

/** RFC-4180-safe CSV line builder with a UTF-8 BOM (Excel + Arabic safe). */
export function usersToCsv(header: string[], rows: CsvCell[][]): string {
  const escape = (v: CsvCell) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "\uFEFF" + [header, ...rows].map((r) => r.map(escape).join(",")).join("\n")
}
