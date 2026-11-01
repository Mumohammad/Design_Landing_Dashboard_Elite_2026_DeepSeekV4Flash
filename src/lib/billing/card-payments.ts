import "server-only"

// Card settlement for platform subscription invoices. Every state change is
// derived from Moyasar's API (secret key) — never from redirect params or a
// webhook body — and applied through settle_platform_card_payment, which is
// idempotent and refuses amount/tenant mismatches.

import { createAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { createMoyasarInvoice, fetchMoyasarInvoice, type MoyasarInvoice } from "./moyasar"

export const ATTEMPT_REUSE_MS = 50 * 60 * 1000 // hosted checkout stays valid ~1h

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
}

export function toHalalas(amount: number | string): number {
  const n = typeof amount === "string" ? Number(amount) : amount
  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid amount")
  return Math.round(n * 100)
}

export type SettleOutcome = "settled" | "already_settled" | "duplicate_payment" | "pending" | "failed" | "expired" | "canceled" | "mismatch" | "unknown"

type AttemptRow = {
  id: string
  platform_invoice_id: string
  tenant_id: string
  provider_invoice_id: string | null
  checkout_url: string | null
  amount_halalas: number
  status: string
  created_at: string
}

/** Pure check used by settlement and tests. */
export function verifyMoyasarInvoice(remote: MoyasarInvoice, attempt: Pick<AttemptRow, "id" | "platform_invoice_id" | "tenant_id" | "amount_halalas">): { ok: true; paymentId: string } | { ok: false; reason: string } {
  if (remote.status !== "paid") return { ok: false, reason: `status:${remote.status}` }
  if (remote.currency !== "SAR") return { ok: false, reason: "currency" }
  if (remote.amount !== attempt.amount_halalas) return { ok: false, reason: "amount" }
  const m = remote.metadata ?? {}
  if (m.attempt_id !== attempt.id || m.platform_invoice_id !== attempt.platform_invoice_id || m.tenant_id !== attempt.tenant_id) return { ok: false, reason: "metadata" }
  const paid = remote.payments?.find((p) => p.status === "paid" && p.amount === attempt.amount_halalas)
  return { ok: true, paymentId: paid?.id ?? remote.id }
}

export async function startCardCheckout(params: { platformInvoiceId: string; tenantId: string; userId: string; companyName: string }): Promise<{ url: string } | { error: string; errorAr: string }> {
  const admin = createAdminClient()
  const { data: inv } = await admin
    .from("platform_invoices")
    .select("id, tenant_id, invoice_number, period_label, amount, currency, status")
    .eq("id", params.platformInvoiceId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle()
  if (!inv) return { error: "Invoice not found.", errorAr: "الفاتورة غير موجودة." }
  if (inv.status !== "pending" && inv.status !== "overdue") return { error: "This invoice is not payable.", errorAr: "هذه الفاتورة غير قابلة للدفع." }
  if (inv.currency !== "SAR") return { error: "Only SAR invoices can be paid by card.", errorAr: "يمكن دفع الفواتير بالريال فقط." }
  const amountHalalas = toHalalas(inv.amount)
  const base = appBaseUrl()
  if (!/^https:\/\//.test(base)) return { error: "Card payments need NEXT_PUBLIC_APP_URL (https).", errorAr: "الدفع الإلكتروني يتطلب ضبط رابط التطبيق." }

  // Reuse a recent open checkout instead of creating parallel ones.
  const { data: recent } = await admin
    .from("platform_payment_attempts")
    .select("id, checkout_url, amount_halalas, status, created_at")
    .eq("platform_invoice_id", inv.id)
    .eq("status", "initiated")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (recent?.checkout_url && recent.amount_halalas === amountHalalas && Date.now() - Date.parse(recent.created_at) < ATTEMPT_REUSE_MS) {
    return { url: recent.checkout_url }
  }

  const { data: attempt, error } = await admin
    .from("platform_payment_attempts")
    .insert({ platform_invoice_id: inv.id, tenant_id: inv.tenant_id, amount_halalas: amountHalalas, created_by: params.userId })
    .select("id")
    .single()
  if (error || !attempt) return { error: "Couldn't start the payment.", errorAr: "تعذر بدء عملية الدفع." }

  try {
    const remote = await createMoyasarInvoice({
      amountHalalas,
      description: `Elite subscription ${inv.invoice_number}${inv.period_label ? ` — ${inv.period_label}` : ""} — ${params.companyName}`,
      successUrl: `${base}/settings/billing?attempt=${attempt.id}`,
      backUrl: `${base}/settings/billing?attempt=${attempt.id}&cancelled=1`,
      callbackUrl: `${base}/api/billing/moyasar/callback`,
      metadata: { attempt_id: attempt.id, platform_invoice_id: inv.id, tenant_id: inv.tenant_id, invoice_number: inv.invoice_number },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    if (remote.amount !== amountHalalas || remote.currency !== "SAR") throw new Error("Moyasar echoed a different amount")
    await admin
      .from("platform_payment_attempts")
      .update({ provider_invoice_id: remote.id, checkout_url: remote.url, status: "initiated", updated_at: new Date().toISOString() })
      .eq("id", attempt.id)
    return { url: remote.url }
  } catch (e) {
    logger.error({ attempt: attempt.id, error: e instanceof Error ? e.message : String(e) }, "moyasar checkout failed")
    await admin.from("platform_payment_attempts").update({ status: "failed", failure_reason: "checkout_create_failed", updated_at: new Date().toISOString() }).eq("id", attempt.id)
    return { error: "The payment provider is unavailable. Try again shortly.", errorAr: "مزود الدفع غير متاح حالياً. حاول بعد قليل." }
  }
}

/** Re-read the attempt from Moyasar and settle if paid. Safe to call repeatedly. */
export async function reconcileAttempt(where: { attemptId?: string; providerInvoiceId?: string; tenantId?: string }): Promise<SettleOutcome> {
  const admin = createAdminClient()
  let q = admin.from("platform_payment_attempts").select("id, platform_invoice_id, tenant_id, provider_invoice_id, checkout_url, amount_halalas, status, created_at")
  if (where.attemptId) q = q.eq("id", where.attemptId)
  else if (where.providerInvoiceId) q = q.eq("provider_invoice_id", where.providerInvoiceId)
  else return "unknown"
  if (where.tenantId) q = q.eq("tenant_id", where.tenantId)
  const { data: attempt } = await q.maybeSingle<AttemptRow>()
  if (!attempt || !attempt.provider_invoice_id) return "unknown"
  if (attempt.status === "paid") return "already_settled"

  const remote = await fetchMoyasarInvoice(attempt.provider_invoice_id)
  const check = verifyMoyasarInvoice(remote, attempt)
  if (!check.ok) {
    if (check.reason.startsWith("status:")) {
      const s = remote.status
      const next = s === "expired" ? "expired" : s === "canceled" || s === "voided" ? "canceled" : s === "failed" ? "failed" : null
      if (next && attempt.status !== next) await admin.from("platform_payment_attempts").update({ status: next, updated_at: new Date().toISOString() }).eq("id", attempt.id)
      return next ?? "pending"
    }
    logger.error({ attempt: attempt.id, reason: check.reason }, "moyasar invoice mismatch")
    return "mismatch"
  }
  const { data, error } = await admin.rpc("settle_platform_card_payment", { p_attempt_id: attempt.id, p_provider_payment_id: check.paymentId, p_amount_halalas: remote.amount })
  if (error) {
    logger.error({ attempt: attempt.id, code: error.code, message: error.message }, "card settlement failed")
    return "mismatch"
  }
  return (data as SettleOutcome) ?? "settled"
}
