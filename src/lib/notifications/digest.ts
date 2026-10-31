import "server-only"

// Scheduled management digest: for each active tenant whose settings say a
// digest is due today (Asia/Riyadh), build the tenant's alert feed with the
// service-role client (tenant-pinned queries) and email it to the managers.
// Idempotent per tenant per business day via notification_digest_log.

import { createAdminClient } from "@/lib/supabase/admin"
import { businessDateKey } from "@/lib/formatting/business-date"
import { sendEmail } from "@/lib/email/send"
import { loadTenantFeed } from "./feed-loader"
import { buildDigestEmail } from "./digest-email"
import { digestDueOn, settingsFromRow, type DigestSettings } from "./digest-schema"

type Admin = ReturnType<typeof createAdminClient>

const MAX_TENANTS = 500

export interface DigestRunSummary {
  date: string
  tenants: number
  sent: number
  skipped: number
  failed: number
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
}

export async function resolveRecipients(admin: Admin, tenantId: string, settings: DigestSettings): Promise<string[]> {
  const emails = new Set<string>(settings.extra_recipients)
  if (settings.recipient_roles.length > 0) {
    const { data } = await admin
      .from("users")
      .select("email")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .is("deleted_at", null)
      .in("role", settings.recipient_roles)
      .limit(100)
    for (const u of data ?? []) {
      const e = typeof u.email === "string" ? u.email.trim().toLowerCase() : ""
      if (e.includes("@")) emails.add(e)
    }
  }
  return [...emails]
}

export async function buildTenantDigest(admin: Admin, tenantId: string, settings: DigestSettings, todayIso: string, test = false) {
  const [{ data: tenant }, feed] = await Promise.all([
    admin.from("tenants").select("name_ar, name_en").eq("id", tenantId).maybeSingle(),
    loadTenantFeed(admin, tenantId, todayIso, {
      mode: "service",
      horizonDays: settings.horizon_days,
      categories: settings.categories,
      limit: 200,
    }),
  ])
  const companyName = (tenant?.name_ar as string | undefined) || (tenant?.name_en as string | undefined) || "EliteDev"
  const email = buildDigestEmail({ companyName, feed, todayIso, appUrl: appBaseUrl(), frequency: settings.frequency, test })
  return { feed, email }
}

async function finish(admin: Admin, logId: string, patch: Record<string, unknown>) {
  await admin.from("notification_digest_log").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", logId)
}

export async function runDigestForTenant(admin: Admin, tenantId: string, todayIso: string): Promise<"sent" | "skipped" | "failed" | "not_due"> {
  const { data: row } = await admin.from("notification_settings").select("*").eq("tenant_id", tenantId).maybeSingle()
  const settings = settingsFromRow(row as Record<string, unknown> | null)
  if (!digestDueOn(settings, todayIso)) return "not_due"

  // Claim today's slot first; a concurrent or retried run hits the unique key.
  const { data: claim, error: claimError } = await admin
    .from("notification_digest_log")
    .insert({ tenant_id: tenantId, run_date: todayIso, kind: "scheduled", status: "pending" })
    .select("id")
    .single()
  if (claimError || !claim) return "not_due"
  const logId = claim.id as string

  try {
    const recipients = await resolveRecipients(admin, tenantId, settings)
    if (recipients.length === 0) {
      await finish(admin, logId, { status: "skipped", detail: "No active recipients" })
      return "skipped"
    }
    const { feed, email } = await buildTenantDigest(admin, tenantId, settings, todayIso)
    if (feed.total === 0 && settings.only_when_alerts) {
      await finish(admin, logId, { status: "skipped", recipients: recipients.length, detail: "No alerts" })
      return "skipped"
    }
    const res = await sendEmail({ to: recipients, subject: email.subject, html: email.html, text: email.text, idempotencyKey: `digest:${tenantId}:${todayIso}` })
    const critical = feed.items.filter((i) => i.severity === "critical").length
    if (!res.ok) {
      await finish(admin, logId, { status: "failed", recipients: recipients.length, items: feed.total, critical, detail: res.error.slice(0, 500) })
      return "failed"
    }
    await finish(admin, logId, { status: "sent", recipients: recipients.length, items: feed.total, critical })
    await admin.from("notification_settings").upsert({ tenant_id: tenantId, last_sent_at: new Date().toISOString() }, { onConflict: "tenant_id", ignoreDuplicates: false })
    return "sent"
  } catch (err) {
    await finish(admin, logId, { status: "failed", detail: (err instanceof Error ? err.message : "Digest failed").slice(0, 500) })
    return "failed"
  }
}

export async function runScheduledDigests(now = new Date()): Promise<DigestRunSummary> {
  const admin = createAdminClient()
  const todayIso = businessDateKey(now)
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(MAX_TENANTS)
  if (error) throw new Error("Unable to load tenants")
  const summary: DigestRunSummary = { date: todayIso, tenants: 0, sent: 0, skipped: 0, failed: 0 }
  for (const t of data ?? []) {
    const r = await runDigestForTenant(admin, t.id as string, todayIso)
    if (r === "not_due") continue
    summary.tenants++
    summary[r]++
  }
  return summary
}
