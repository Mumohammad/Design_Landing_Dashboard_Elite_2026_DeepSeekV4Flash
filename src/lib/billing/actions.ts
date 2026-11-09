"use server"

// Settings → Billing: the company's Elite subscription invoices and online
// card payment (Moyasar). settings:read to view, settings:update to pay.

import { z } from "zod"
import { can, getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimit } from "@/lib/auth/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { readCompleteRows } from "@/lib/analytics/complete-read"
import { moyasarConfigured, moyasarMode } from "./moyasar"
import { reconcileAttempt, startCardCheckout, type SettleOutcome } from "./card-payments"

export interface BillingInvoice {
  id: string
  invoice_number: string
  period_label: string | null
  amount: number
  currency: string
  status: "pending" | "paid" | "overdue" | "void"
  due_date: string | null
  paid_at: string | null
  payment_method: "manual" | "card" | null
  created_at: string
}

export interface BillingOverview {
  companyName: string
  billingStatus: string | null
  trialEndsAt: string | null
  invoices: BillingInvoice[]
  canPay: boolean
  cardEnabled: boolean
  cardMode: "test" | "live" | null
}

type Result<T = undefined> = ({ success: true } & (T extends undefined ? object : { data: T })) | { success: false; error: string; errorAr: string }

const idSchema = z.string().uuid()

export async function getBillingOverview(): Promise<BillingOverview | null> {
  await requirePermission("settings", "read")
  const user = await getCurrentUser()
  if (!user) return null
  const admin = createAdminClient()
  const [tenantRead, invoiceRead, manage] = await Promise.all([
    admin.from("tenants").select("name_ar, name_en, billing_status, trial_ends_at").eq("id", user.tenantId).maybeSingle(),
    readCompleteRows(() => admin
      .from("platform_invoices")
      .select("id, invoice_number, period_label, amount, currency, status, due_date, paid_at, payment_method, created_at", { count: "exact" })
      .eq("tenant_id", user.tenantId)
      .neq("status", "void")
      .order("created_at", { ascending: false }).order("id", { ascending: true })),
    can("settings", "update").then((r) => r.allowed, () => false),
  ])
  if (tenantRead.error || !tenantRead.data || invoiceRead.error || !invoiceRead.data) throw new Error("Billing data unavailable")
  const tenant = tenantRead.data, invoices = invoiceRead.data
  return {
    companyName: (tenant?.name_en || tenant?.name_ar || "") as string,
    billingStatus: (tenant?.billing_status as string | null) ?? null,
    trialEndsAt: (tenant?.trial_ends_at as string | null) ?? null,
    invoices: ((invoices ?? []) as BillingInvoice[]).map((i) => ({ ...i, amount: Number(i.amount) })),
    canPay: manage,
    cardEnabled: moyasarConfigured(),
    cardMode: moyasarMode(),
  }
}

export async function payInvoiceByCard(invoiceId: string): Promise<Result<{ url: string }>> {
  await requirePermission("settings", "update")
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "Not signed in.", errorAr: "يجب تسجيل الدخول." }
  if (!idSchema.safeParse(invoiceId).success) return { success: false, error: "Invalid invoice.", errorAr: "فاتورة غير صالحة." }
  if (!moyasarConfigured()) return { success: false, error: "Online card payment isn't enabled yet.", errorAr: "الدفع الإلكتروني غير مفعّل بعد." }
  const rl = await rateLimit(`card-pay:${user.id}`, 6, "minute")
  if (!rl.success) return { success: false, error: "Too many attempts. Try again in a minute.", errorAr: "محاولات كثيرة. حاول بعد دقيقة." }
  const admin = createAdminClient()
  const { data: tenant } = await admin.from("tenants").select("name_en, name_ar").eq("id", user.tenantId).maybeSingle()
  const res = await startCardCheckout({ platformInvoiceId: invoiceId, tenantId: user.tenantId, userId: user.authUserId, companyName: (tenant?.name_en || tenant?.name_ar || "") as string })
  if ("error" in res) return { success: false, error: res.error, errorAr: res.errorAr }
  return { success: true, data: { url: res.url } }
}

/** Called when the payer returns from checkout; settles from Moyasar's API, not the URL. */
export async function confirmCardReturn(attemptId: string): Promise<Result<{ outcome: SettleOutcome }>> {
  await requirePermission("settings", "read")
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "Not signed in.", errorAr: "يجب تسجيل الدخول." }
  if (!idSchema.safeParse(attemptId).success || !moyasarConfigured()) return { success: true, data: { outcome: "unknown" } }
  const rl = await rateLimit(`card-confirm:${user.id}`, 20, "minute")
  if (!rl.success) return { success: true, data: { outcome: "pending" } }
  try {
    return { success: true, data: { outcome: await reconcileAttempt({ attemptId, tenantId: user.tenantId }) } }
  } catch {
    return { success: true, data: { outcome: "pending" } }
  }
}
