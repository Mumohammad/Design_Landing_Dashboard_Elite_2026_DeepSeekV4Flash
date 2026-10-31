"use server"

// Settings → Notifications: management digest configuration, test send and
// delivery history. settings:read to view, settings:update to change/send.

import { can, getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitSettings } from "@/lib/auth/rate-limit"
import { writeAuditLog } from "@/lib/auth/sessions"
import { createAdminClient } from "@/lib/supabase/admin"
import { businessDateKey } from "@/lib/formatting/business-date"
import { emailConfigured, sendEmail } from "@/lib/email/send"
import { buildTenantDigest } from "./digest"
import { digestSettingsSchema, settingsFromRow, type DigestSettings } from "./digest-schema"

export interface DigestLogEntry {
  id: string
  run_date: string
  kind: "scheduled" | "test"
  status: "pending" | "sent" | "skipped" | "failed"
  recipients: number
  items: number
  critical: number
  detail: string | null
  created_at: string
}

export interface DigestSettingsView {
  settings: DigestSettings
  canManage: boolean
  emailConfigured: boolean
  lastSentAt: string | null
  history: DigestLogEntry[]
}

type Result = { success: true; message?: string } | { success: false; error: string; errorAr: string }

export async function getDigestSettings(): Promise<DigestSettingsView | null> {
  await requirePermission("settings", "read")
  const user = await getCurrentUser()
  if (!user) return null
  const admin = createAdminClient()
  const [{ data: row }, { data: history }, manage] = await Promise.all([
    admin.from("notification_settings").select("*").eq("tenant_id", user.tenantId).maybeSingle(),
    admin
      .from("notification_digest_log")
      .select("id, run_date, kind, status, recipients, items, critical, detail, created_at")
      .eq("tenant_id", user.tenantId)
      .order("created_at", { ascending: false })
      .limit(15),
    can("settings", "update").then((r) => r.allowed, () => false),
  ])
  return {
    settings: settingsFromRow(row as Record<string, unknown> | null),
    canManage: manage,
    emailConfigured: emailConfigured(),
    lastSentAt: (row?.last_sent_at as string | null | undefined) ?? null,
    history: (history ?? []) as DigestLogEntry[],
  }
}

export async function saveDigestSettings(input: DigestSettings): Promise<Result> {
  await requirePermission("settings", "update")
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "Not signed in.", errorAr: "يجب تسجيل الدخول." }
  const rl = await rateLimitSettings(user.id)
  if (!rl.success) return { success: false, error: "Too many changes. Try again shortly.", errorAr: "تغييرات كثيرة. حاول بعد قليل." }
  const parsed = digestSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: "Check the settings: add at least one recipient and valid emails.", errorAr: "تحقق من الإعدادات: أضف مستلماً واحداً على الأقل وبريداً صحيحاً." }
  }
  const admin = createAdminClient()
  const { data: before } = await admin.from("notification_settings").select("*").eq("tenant_id", user.tenantId).maybeSingle()
  const { error } = await admin.from("notification_settings").upsert({
    tenant_id: user.tenantId,
    ...parsed.data,
    updated_at: new Date().toISOString(),
    updated_by: user.authUserId,
  }, { onConflict: "tenant_id" })
  if (error) return { success: false, error: "Unable to save notification settings.", errorAr: "تعذر حفظ إعدادات الإشعارات." }
  await writeAuditLog({
    tenantId: user.tenantId,
    actorId: user.authUserId,
    module: "settings",
    action: "notification_settings_updated",
    entityType: "notification_settings",
    entityId: user.tenantId,
    oldValues: before ? settingsFromRow(before as Record<string, unknown>) : null,
    newValues: parsed.data,
  }).catch(() => undefined)
  return { success: true }
}

/** Sends the digest as it would go out today, to the signed-in user only. */
export async function sendTestDigest(): Promise<Result> {
  await requirePermission("settings", "update")
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "Not signed in.", errorAr: "يجب تسجيل الدخول." }
  const rl = await rateLimitSettings(user.id)
  if (!rl.success) return { success: false, error: "Too many requests. Try again shortly.", errorAr: "طلبات كثيرة. حاول بعد قليل." }
  if (!emailConfigured()) {
    return { success: false, error: "Email sending is not configured yet (RESEND_API_KEY).", errorAr: "لم يتم إعداد خدمة البريد بعد (RESEND_API_KEY)." }
  }
  const admin = createAdminClient()
  const { data: me } = await admin.from("users").select("email").eq("id", user.id).maybeSingle()
  const to = typeof me?.email === "string" ? me.email : ""
  if (!to.includes("@")) return { success: false, error: "Your account has no email address.", errorAr: "لا يوجد بريد إلكتروني لحسابك." }

  const { data: row } = await admin.from("notification_settings").select("*").eq("tenant_id", user.tenantId).maybeSingle()
  const settings = settingsFromRow(row as Record<string, unknown> | null)
  const todayIso = businessDateKey(new Date())
  const { data: log } = await admin
    .from("notification_digest_log")
    .insert({ tenant_id: user.tenantId, run_date: todayIso, kind: "test", status: "pending", recipients: 1 })
    .select("id")
    .single()
  const { feed, email } = await buildTenantDigest(admin, user.tenantId, settings, todayIso, true)
  const res = await sendEmail({ to: [to], subject: email.subject, html: email.html, text: email.text })
  if (log?.id) {
    await admin.from("notification_digest_log").update({
      status: res.ok ? "sent" : "failed",
      items: feed.total,
      critical: feed.items.filter((i) => i.severity === "critical").length,
      detail: res.ok ? null : res.error.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq("id", log.id)
  }
  if (!res.ok) return { success: false, error: res.error, errorAr: "تعذر إرسال رسالة التجربة." }
  return { success: true, message: to }
}
