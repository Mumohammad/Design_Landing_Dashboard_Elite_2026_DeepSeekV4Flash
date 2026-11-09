import "server-only"

// Daily driver-facing expiry reminders (30/14/7/1 days before) for iqama,
// licence, passport and every expiring driver document. Sent only to drivers
// with an email on file; Resend idempotency keys make retries safe.

import { createAdminClient } from "@/lib/supabase/admin"
import { businessDateKey } from "@/lib/formatting/business-date"
import { emailConfigured, sendEmail } from "@/lib/email/send"
import { docTypeMeta } from "@/lib/drivers/documents"
import { collectRows } from "@/lib/reports/collect-rows"
import { z } from "zod"
import { buildDriverReminderEmail, reminderDates, type DriverReminderItem } from "./driver-reminder-email"

export interface DriverReminderSummary { drivers: number; sent: number; failed: number; skipped: boolean }
const driverSchema = z.object({ id: z.uuid(), tenant_id: z.uuid(), full_name_ar: z.string(), full_name_en: z.string().nullable(),
  personal_email: z.string().nullable(), work_email: z.string().nullable(), iqama_expiry_date: z.string().nullable(),
  license_expiry_date: z.string().nullable(), passport_expiry_date: z.string().nullable() })
const documentSchema = z.object({ id: z.uuid(), driver_id: z.uuid(), tenant_id: z.uuid(), doc_type: z.string(), expiry_date: z.string() })
const tenantSchema = z.object({ id: z.uuid(), name_ar: z.string().nullable(), name_en: z.string().nullable() })
const driverFields = "id,tenant_id,full_name_ar,full_name_en,personal_email,work_email,iqama_expiry_date,license_expiry_date,passport_expiry_date"

export async function runDriverExpiryReminders(now = new Date()): Promise<DriverReminderSummary> {
  if (!emailConfigured()) return { drivers: 0, sent: 0, failed: 0, skipped: true }
  const admin = createAdminClient()
  const today = businessDateKey(now)
  const dates = reminderDates(today)
  const list = [...dates.keys()]
  const inList = `(${list.join(",")})`

  // Finish all source and recipient reads before sending any external message.
  const [driverRows, documentRows, tenantRows] = await Promise.all([
    collectRows(() => admin.from("drivers")
      .select(driverFields, { count: "exact" })
      .is("deleted_at", null).not("status", "in", "(terminated,blacklisted)")
      .or(`iqama_expiry_date.in.${inList},license_expiry_date.in.${inList},passport_expiry_date.in.${inList}`).order("id")),
    collectRows(() => admin.from("driver_documents")
      .select("id,driver_id,tenant_id,doc_type,expiry_date", { count: "exact" })
      .eq("is_active", true).is("deleted_at", null).in("expiry_date", list).order("id")),
    collectRows(() => admin.from("tenants").select("id,name_ar,name_en", { count: "exact" }).eq("status", "active").is("deleted_at", null).order("id")),
  ])
  const drivers = z.array(driverSchema).parse(driverRows)
  const docs = z.array(documentSchema).parse(documentRows)
  const tenants = z.array(tenantSchema).parse(tenantRows)

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
    const meta = docTypeMeta(doc.doc_type)
    push(doc.driver_id, meta?.ar ?? "وثيقة", meta?.en ?? "Document", doc.expiry_date)
    docDrivers.add(doc.driver_id as string)
  }
  // Load contact details for drivers that only appear via documents.
  const known = new Map((drivers ?? []).map((d) => [d.id as string, d]))
  const missing = [...docDrivers].filter((id) => !known.has(id))
  for (let offset = 0; offset < missing.length; offset += 200) {
    const data = z.array(driverSchema).parse(await collectRows(() => admin.from("drivers")
      .select(driverFields, { count: "exact" })
      .in("id", missing.slice(offset, offset + 200)).is("deleted_at", null).not("status", "in", "(terminated,blacklisted)").order("id")))
    for (const d of data) known.set(d.id, d)
  }
  for (const doc of docs) {
    const driver = known.get(doc.driver_id)
    if (driver && driver.tenant_id !== doc.tenant_id) throw Error("Driver reminder scope is invalid")
  }
  for (const d of known.values()) {
    const email = (d.personal_email || d.work_email || "").trim().toLowerCase()
    if (email && tenantName.has(d.tenant_id) && !z.email().safeParse(email).success) throw Error("Driver reminder recipient is invalid")
  }

  const summary: DriverReminderSummary = { drivers: 0, sent: 0, failed: 0, skipped: false }
  for (const [driverId, list] of items) {
    const d = known.get(driverId)
    const email = (d?.personal_email || d?.work_email || "").trim().toLowerCase()
    if (!d || !email || !tenantName.has(d.tenant_id as string)) continue
    summary.drivers++
    const mail = buildDriverReminderEmail({ name: d.full_name_ar || d.full_name_en || "", company: tenantName.get(d.tenant_id as string) || "EliteDev", items: list.sort((a, b) => a.days - b.days) })
    const r = await sendEmail({ to: [email], ...mail, idempotencyKey: `driver-expiry:${driverId}:${today}` })
    if (r.ok) summary.sent++
    else summary.failed++
  }
  return summary
}
