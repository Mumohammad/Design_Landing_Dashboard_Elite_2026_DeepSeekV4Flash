import "server-only"

// Scheduled management digest: for each active tenant whose settings say a
// digest is due today (Asia/Riyadh), build the tenant's alert feed with the
// service-role client (tenant-pinned queries) and email it to the managers.
// Idempotent per tenant per business day via notification_digest_log.

import { createAdminClient } from "@/lib/supabase/admin"
import { createHash } from "node:crypto"
import { z } from "zod"
import { collectRows } from "@/lib/reports/collect-rows"
import { businessDateKey } from "@/lib/formatting/business-date"
import { sendEmail } from "@/lib/email/send"
import { loadTenantFeed } from "./feed-loader"
import { buildDigestEmail } from "./digest-email"
import { digestDueOn, settingsFromRow, type DigestSettings } from "./digest-schema"

type Admin = ReturnType<typeof createAdminClient>

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
    const data = await collectRows(() => admin
      .from("users")
      .select("id,email", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .is("deleted_at", null)
      .in("role", settings.recipient_roles)
      .order("id", { ascending: true }))
    for (const u of data) {
      const e = typeof u.email === "string" ? u.email.trim().toLowerCase() : ""
      if (e.includes("@")) emails.add(e)
    }
  }
  return [...emails]
}

export async function buildTenantDigest(admin: Admin, tenantId: string, settings: DigestSettings, todayIso: string, test = false) {
  const [tenantResult, feed] = await Promise.all([
    admin.from("tenants").select("name_ar, name_en").eq("id", tenantId).maybeSingle(),
    loadTenantFeed(admin, tenantId, todayIso, {
      mode: "service",
      horizonDays: settings.horizon_days,
      categories: settings.categories,
      limit: 200,
    }),
  ])
  if (tenantResult.error || !tenantResult.data) throw new Error("Company data unavailable")
  const tenant = tenantResult.data
  const companyName = (tenant?.name_ar as string | undefined) || (tenant?.name_en as string | undefined) || "EliteDev"
  const email = buildDigestEmail({ companyName, feed, todayIso, appUrl: appBaseUrl(), frequency: settings.frequency, test })
  return { feed, email }
}

async function finish(admin: Admin, logId: string, claimToken: string, patch: Record<string, unknown>) {
  const { data, error } = await admin.rpc("finish_notification_digest", { p_id: logId, p_claim_token: claimToken, p_patch: patch })
  if (error || data !== true) throw new Error("Digest completion could not be confirmed")
}

const payloadSchema = z.object({ to: z.array(z.string().email()).min(1), subject: z.string(), html: z.string(), text: z.string(), settingsHash: z.string(), items: z.number().int().nonnegative(), critical: z.number().int().nonnegative() })

export async function runDigestForTenant(admin: Admin, tenantId: string, todayIso: string): Promise<"sent" | "skipped" | "failed" | "not_due"> {
  const { data: row, error: settingsError } = await admin.from("notification_settings").select("*").eq("tenant_id", tenantId).maybeSingle()
  if (settingsError) return "failed"
  let settings: DigestSettings
  try { settings = settingsFromRow(row as Record<string, unknown> | null) } catch { return "failed" }
  if (!digestDueOn(settings, todayIso)) return "not_due"

  // Claim today's slot first; a concurrent or retried run hits the unique key.
  const { data: claim, error: claimError } = await admin.rpc("claim_notification_digest", { p_tenant: tenantId, p_date: todayIso })
  if (claimError) return "failed"
  if (claim === null) return "not_due"
  const parsedClaim = z.object({ id: z.string().uuid(), claim_token: z.string().uuid(), payload: z.unknown() }).safeParse(claim)
  if (!parsedClaim.success) return "failed"
  const { id: logId, claim_token: token } = parsedClaim.data

  try {
    const recipients = (await resolveRecipients(admin, tenantId, settings)).sort()
    if (recipients.length === 0) {
      await finish(admin, logId, token, { status: "skipped", detail: "No active recipients" })
      return "skipped"
    }
    const settingsHash = createHash("sha256").update(JSON.stringify({ settings, sender: process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev", appUrl: appBaseUrl() })).digest("hex")
    let payload: z.infer<typeof payloadSchema>
    if (parsedClaim.data.payload) {
      payload = payloadSchema.parse(parsedClaim.data.payload)
      if (payload.settingsHash !== settingsHash || JSON.stringify(payload.to) !== JSON.stringify(recipients)) throw Error("Delivery authorization changed")
    } else {
      const { feed, email } = await buildTenantDigest(admin, tenantId, settings, todayIso)
      if (feed.total === 0 && settings.only_when_alerts) {
        await finish(admin, logId, token, { status: "skipped", recipients: recipients.length, detail: "No alerts" })
        return "skipped"
      }
      payload = { to: recipients, subject: email.subject, html: email.html, text: email.text, settingsHash, items: feed.total, critical: feed.items.filter(i => i.severity === "critical").length }
    }
    const prepared = await admin.rpc("prepare_notification_digest", { p_id: logId, p_claim_token: token, p_payload: payload })
    if (prepared.error || JSON.stringify(prepared.data) === undefined) throw Error("Delivery preparation unavailable")
    const confirmed = payloadSchema.parse(prepared.data)
    if (confirmed.settingsHash !== settingsHash || JSON.stringify(confirmed) !== JSON.stringify(payload)) throw Error("Delivery payload changed")
    const res = await sendEmail({ to: payload.to, subject: payload.subject, html: payload.html, text: payload.text, idempotencyKey: `digest:${tenantId}:${todayIso}` })
    if (!res.ok) {
      await finish(admin, logId, token, { status: "failed", recipients: recipients.length, items: payload.items, critical: payload.critical, detail: "Email delivery could not be confirmed" })
      return "failed"
    }
    await finish(admin, logId, token, { status: "sent", recipients: recipients.length, items: payload.items, critical: payload.critical })
    return "sent"
  } catch {
    await finish(admin, logId, token, { status: "failed", detail: "Digest delivery could not be confirmed" }).catch(() => undefined)
    return "failed"
  }
}

export async function runScheduledDigests(now = new Date()): Promise<DigestRunSummary> {
  const admin = createAdminClient()
  const todayIso = businessDateKey(now)
  const data = await collectRows(() => admin
    .from("tenants")
    .select("id", { count: "exact" })
    .eq("status", "active")
    .is("deleted_at", null)
    .order("id", { ascending: true }))
  const summary: DigestRunSummary = { date: todayIso, tenants: 0, sent: 0, skipped: 0, failed: 0 }
  for (const t of data ?? []) {
    const r = await runDigestForTenant(admin, t.id as string, todayIso)
    if (r === "not_due") continue
    summary.tenants++
    summary[r]++
  }
  return summary
}
