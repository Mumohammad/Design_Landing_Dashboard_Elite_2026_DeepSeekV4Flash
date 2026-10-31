// Client-safe model for the management notification digest settings.
import { z } from "zod"
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "./feed-utils"

export const DIGEST_ROLES = [
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
export type DigestRole = (typeof DIGEST_ROLES)[number]

export const DIGEST_ROLE_COPY: Record<DigestRole, { ar: string; en: string }> = {
  general_manager: { ar: "المدير العام", en: "General manager" },
  admin: { ar: "مدير النظام", en: "Administrator" },
  accountant: { ar: "المحاسب", en: "Accountant" },
  supervisor: { ar: "المشرف", en: "Supervisor" },
  hr_officer: { ar: "الموارد البشرية", en: "HR officer" },
  operations_officer: { ar: "العمليات", en: "Operations officer" },
  payroll_officer: { ar: "الرواتب", en: "Payroll officer" },
  platform_coordinator: { ar: "منسق المنصات", en: "Platform coordinator" },
  readonly_auditor: { ar: "مدقق (قراءة فقط)", en: "Read-only auditor" },
}

export const WEEKDAY_COPY = [
  { ar: "الأحد", en: "Sunday" },
  { ar: "الاثنين", en: "Monday" },
  { ar: "الثلاثاء", en: "Tuesday" },
  { ar: "الأربعاء", en: "Wednesday" },
  { ar: "الخميس", en: "Thursday" },
  { ar: "الجمعة", en: "Friday" },
  { ar: "السبت", en: "Saturday" },
]

export const digestSettingsSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly"]),
  weekly_day: z.number().int().min(0).max(6),
  horizon_days: z.number().int().min(7).max(90),
  recipient_roles: z.array(z.enum(DIGEST_ROLES)).max(DIGEST_ROLES.length),
  extra_recipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(20),
  categories: z.array(z.enum(NOTIFICATION_CATEGORIES as [NotificationCategory, ...NotificationCategory[]])).min(1),
  only_when_alerts: z.boolean(),
}).refine((s) => s.recipient_roles.length > 0 || s.extra_recipients.length > 0, {
  message: "At least one recipient role or email is required",
  path: ["recipient_roles"],
})

export type DigestSettings = z.infer<typeof digestSettingsSchema>

export const DEFAULT_DIGEST_SETTINGS: DigestSettings = {
  enabled: true,
  frequency: "daily",
  weekly_day: 0,
  horizon_days: 30,
  recipient_roles: ["general_manager", "admin"],
  extra_recipients: [],
  categories: [...NOTIFICATION_CATEGORIES],
  only_when_alerts: true,
}

/** Normalizes a DB row (or null) into settings, falling back to defaults. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): DigestSettings {
  if (!row) return { ...DEFAULT_DIGEST_SETTINGS }
  const parsed = digestSettingsSchema.safeParse({
    enabled: row.enabled,
    frequency: row.frequency,
    weekly_day: row.weekly_day,
    horizon_days: row.horizon_days,
    recipient_roles: row.recipient_roles,
    extra_recipients: row.extra_recipients,
    categories: row.categories,
    only_when_alerts: row.only_when_alerts,
  })
  return parsed.success ? parsed.data : { ...DEFAULT_DIGEST_SETTINGS }
}

/** Riyadh weekday (0 = Sunday) for an ISO business date. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay()
}

export function digestDueOn(settings: DigestSettings, todayIso: string): boolean {
  if (!settings.enabled) return false
  return settings.frequency === "daily" || weekdayOf(todayIso) === settings.weekly_day
}
