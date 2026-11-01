import "server-only"

// Daily driver-facing expiry reminders (30/14/7/1 days before) for iqama,
// licence, passport and every expiring driver document. Sent only to drivers
// with an email on file; Resend idempotency keys make retries safe.

import { createAdminClient } from "@/lib/supabase/admin"
import { businessDateKey } from "@/lib/formatting/business-date"
import { emailConfigured, sendEmail } from "@/lib/email/send"
import { docTypeMeta } from "@/lib/drivers/documents"
import { buildDriverReminderEmail, reminderDates, type DriverReminderItem } from "./driver-reminder-email"

export interface DriverReminderSummary { drivers: number; sent: number; failed: number; skipped: boolean }

export async function runDriverExpiryReminders(now = new Date()): Promise<DriverReminderSummary> {
  if (!emailConfigured()) return { drivers: 0, sent: 0, failed: 0, skipped: true }
  const admin = createAdminClient()
  const today = businessDateKey(now)
  const dates = reminderDates(today)
  const list = [...dates.keys()]
  const inList = `(${list.join(",")})`

  const [{ data: drivers }, { data: docs }, { data: tenants }] = await Promise.all([
    admin.from("drivers")
      .select("id, tenant_id, full_name_ar, full_name_en, personal_email, work_email, iqama_expiry_date, license_expiry_date, passport_expiry_date")
      .is("deleted_at", null).not("status", "in", "(terminated,blacklisted)")
      .or(`iqama_expiry_date.in.${inList},license_expiry_date.in.${inList},passport_expiry_date.in.${inList}`).limit(2000),
    admin.from("driver_documents")
      .select("driver_id, tenant_id, document_type, expiry_date")
      .is("deleted_at", null).in("expiry_date", list).limit(5000),
    admin.from("tenants").select("id, name_ar, name_en").eq("status", "active").is("deleted_at", null).limit(500),
  ])

  const tenantName = new Map((tenants ?? []).map((t) => [t.id as string, String(t.name_ar || t.name_en || "")]))
  const items = new Map<string, DriverReminderItem[]>()
  const push = (driverId: string, labelAr: string, labelEn: string, date: string | null) => {
    if (!date) return
    const days = dates.get(date.slice(0, 10))
    if (days === undefined) return
    const arr = items.get(driverId) ?? []
    if (!arr.some((x) => x.labelEn === labelEn && x.date === date)) arr.push({ labelAr, labelEn, date: date.slice(0, 10), days })
    items.set(driverId, arr)
  }
  for (const d of drivers ?? []) {
    push(d.id, "الإقامة", "Iqama", d.iqama_expiry_date)
    push(d.id, "رخصة القيادة", "Driving licence", d.license_expiry_date)
    push(d.id, "جواز السفر", "Passport", d.passport_expiry_date)
  }
  const docDrivers = new Set<string>()
  for (const doc of docs ?? []) {
    const meta = docTypeMeta(String(doc.document_type))
    push(doc.driver_id as string, meta?.ar ?? "وثيقة", meta?.en ?? "Document", doc.expiry_date as string)
    docDrivers.add(doc.driver_id as string)
  }
  // Load contact details for drivers that only appear via documents.
  const known = new Map((drivers ?? []).map((d) => [d.id as string, d]))
  const missing = [...docDrivers].filter((id) => !known.has(id))
  if (missing.length) {
    const { data } = await admin.from("drivers")
      .select("id, tenant_id, full_name_ar, full_name_en, personal_email, work_email, iqama_expiry_date, license_expiry_date, passport_expiry_date")
      .in("id", missing.slice(0, 1000)).is("deleted_at", null).not("status", "in", "(terminated,blacklisted)")
    for (const d of data ?? []) known.set(d.id as string, d)
  }

  const summary: DriverReminderSummary = { drivers: 0, sent: 0, failed: 0, skipped: false }
  for (const [driverId, list] of items) {
    const d = known.get(driverId)
    const email = (d?.personal_email || d?.work_email || "").trim()
    if (!d || !email || !tenantName.has(d.tenant_id as string)) continue
    summary.drivers++
    const mail = buildDriverReminderEmail({ name: d.full_name_ar || d.full_name_en || "", company: tenantName.get(d.tenant_id as string) || "EliteDev", items: list.sort((a, b) => a.days - b.days) })
    const r = await sendEmail({ to: [email], ...mail, idempotencyKey: `driver-expiry:${driverId}:${today}` })
    if (r.ok) summary.sent++
    else summary.failed++
  }
  return summary
}
