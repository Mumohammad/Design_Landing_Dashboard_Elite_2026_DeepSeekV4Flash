import "server-only"

// Card settlement for platform subscription invoices. Every state change is
// derived from Moyasar's API (secret key) — never from redirect params or a
// webhook body — and applied through settle_platform_card_payment, which is
// idempotent and refuses amount/tenant mismatches.

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { moyasarConfigured } from "./moyasar"
import { z } from "zod"
import { logger } from "@/lib/logger"
import { createMoyasarInvoice, fetchMoyasarInvoice, type MoyasarInvoice } from "./moyasar"

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
  failure_reason?: string | null
}

/** Pure check used by settlement and tests. */
export function verifyMoyasarInvoice(remote: MoyasarInvoice, attempt: Pick<AttemptRow, "id" | "platform_invoice_id" | "tenant_id" | "amount_halalas">): { ok: true; paymentId: string } | { ok: false; reason: string } {
  if (remote.currency !== "SAR") return { ok: false, reason: "currency" }
  if (remote.amount !== attempt.amount_halalas) return { ok: false, reason: "amount" }
  const m = remote.metadata ?? {}
  if (m.attempt_id !== attempt.id || m.platform_invoice_id !== attempt.platform_invoice_id || m.tenant_id !== attempt.tenant_id) return { ok: false, reason: "metadata" }
  if (remote.status !== "paid") return { ok: false, reason: `status:${remote.status}` }
  const paid = remote.payments?.find((p) => p.status === "paid" && p.amount === attempt.amount_halalas)
  return { ok: true, paymentId: paid?.id ?? remote.id }
}

export async function startCardCheckout(params: { platformInvoiceId: string; tenantId: string; userId: string; companyName: string }): Promise<{ url: string } | { error: string; errorAr: string }> {
  const unavailable = { error: "Payment setup could not be confirmed. Reload before trying again.", errorAr: "تعذر تأكيد إعداد الدفع. أعد تحميل الصفحة قبل المحاولة مجدداً." }
  if (!moyasarConfigured()) return unavailable
  const base = appBaseUrl()
  if (!base.startsWith("https://")) return unavailable
  const caller = await createClient()
  const schema = z.object({ is_new: z.boolean(), attempt: z.object({
    id: z.string().uuid(), platform_invoice_id: z.literal(params.platformInvoiceId), tenant_id: z.literal(params.tenantId),
    amount_halalas: z.number().int().positive(), created_by: z.string().uuid(),
    status: z.enum(["creating", "initiated"]), checkout_url: z.string().url().nullable(),
    provider_invoice_id: z.string().nullable(),
  }), invoice: z.object({ invoice_number: z.string(), period_label: z.string().nullable() }) })
  const admin = createAdminClient()
  // One replacement claim is allowed only after a verified terminal provider
  // result was durably observed. Unknown creation never releases a reservation.
  for (let claimRound = 0; claimRound < 2; claimRound++) {
    const { data, error } = await caller.rpc("claim_my_platform_checkout", { p_invoice_id: params.platformInvoiceId })
    const parsed = schema.safeParse(data)
    if (error || !parsed.success) return unavailable
    const { attempt, invoice: inv, is_new: isNew } = parsed.data
    if (isNew && attempt.created_by !== params.userId) return unavailable
    if (!isNew) {
      if (attempt.status !== "initiated" || !attempt.provider_invoice_id || !attempt.checkout_url?.startsWith("https://")) return unavailable
      try {
        const checked = await inspectAttempt({ attemptId: attempt.id, tenantId: params.tenantId })
        if (checked.checkoutUrl) return { url: checked.checkoutUrl }
        if (["settled", "already_settled", "duplicate_payment"].includes(checked.outcome)) return { url: base + "/settings/billing?attempt=" + attempt.id }
        if (["expired", "failed", "canceled"].includes(checked.outcome) && claimRound === 0) continue
      } catch {
        // A provider read outage cannot justify another live checkout.
      }
      return unavailable
    }
    try {
      const remote = await createMoyasarInvoice({
        amountHalalas: attempt.amount_halalas,
        description: `Elite subscription ${inv.invoice_number}${inv.period_label ? " — " + inv.period_label : ""} — ${params.companyName}`,
        successUrl: base + "/settings/billing?attempt=" + attempt.id,
        backUrl: base + "/settings/billing?attempt=" + attempt.id + "&cancelled=1",
        callbackUrl: base + "/api/billing/moyasar/callback",
        metadata: { attempt_id: attempt.id, platform_invoice_id: params.platformInvoiceId, tenant_id: params.tenantId, invoice_number: inv.invoice_number },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      if (remote.amount !== attempt.amount_halalas || remote.currency !== "SAR" || remote.metadata?.attempt_id !== attempt.id || remote.metadata?.tenant_id !== params.tenantId || remote.metadata?.platform_invoice_id !== params.platformInvoiceId) throw Error("Provider mapping mismatch")
      const confirmed = await admin.rpc("confirm_platform_checkout", { p_attempt_id: attempt.id, p_provider_id: remote.id, p_url: remote.url, p_amount_halalas: remote.amount })
      const mapped = z.object({ id: z.literal(attempt.id), provider_invoice_id: z.literal(remote.id), checkout_url: z.literal(remote.url), amount_halalas: z.literal(attempt.amount_halalas), status: z.literal("initiated") }).safeParse(confirmed.data)
      if (confirmed.error || !mapped.success) return unavailable
      return { url: mapped.data.checkout_url }
    } catch {
      // Creation/mapping may have committed despite a timeout. Keep the reserved
      // attempt; a blind failure transition would allow another live checkout.
      logger.error({ attempt: attempt.id }, "checkout confirmation unavailable")
      return unavailable
    }
  }
  return unavailable
}

const attemptColumns = "id, platform_invoice_id, tenant_id, provider_invoice_id, checkout_url, amount_halalas, status, created_at, failure_reason"
type AttemptWhere = { attemptId?: string; providerInvoiceId?: string; tenantId?: string }
type Inspection = { outcome: SettleOutcome; checkoutUrl?: string }
type Admin = ReturnType<typeof createAdminClient>

async function readAttempt(admin: Admin, where: AttemptWhere): Promise<AttemptRow | null> {
  let q = admin.from("platform_payment_attempts").select(attemptColumns)
  if (where.attemptId) q = q.eq("id", where.attemptId)
  else if (where.providerInvoiceId) q = q.eq("provider_invoice_id", where.providerInvoiceId)
  else return null
  if (where.tenantId) q = q.eq("tenant_id", where.tenantId)
  const { data, error } = await q.maybeSingle<AttemptRow>()
  return error ? null : data
}

function knownOutcome(attempt: AttemptRow): SettleOutcome {
  if (attempt.failure_reason?.startsWith("Captured after")) return "duplicate_payment"
  if (attempt.status === "paid") return "already_settled"
  if (attempt.status === "expired" || attempt.status === "failed" || attempt.status === "canceled") return attempt.status
  return attempt.status === "creating" || attempt.status === "initiated" ? "pending" : "unknown"
}

function sameAttempt(current: AttemptRow, expected: AttemptRow): boolean {
  return current.id === expected.id && current.tenant_id === expected.tenant_id && current.platform_invoice_id === expected.platform_invoice_id
    && current.provider_invoice_id === expected.provider_invoice_id && current.amount_halalas === expected.amount_halalas
}

async function inspectAttempt(where: AttemptWhere): Promise<Inspection> {
  if (!moyasarConfigured()) return { outcome: "unknown" }
  const admin = createAdminClient()
  const attempt = await readAttempt(admin, where)
  if (!attempt || !attempt.provider_invoice_id) return { outcome: "unknown" }
  const known = knownOutcome(attempt)
  if (known === "duplicate_payment" || known === "already_settled") return { outcome: known }

  const remote = await fetchMoyasarInvoice(attempt.provider_invoice_id)
  if (remote.id !== attempt.provider_invoice_id) return { outcome: "mismatch" }
  const check = verifyMoyasarInvoice(remote, attempt)
  if (!check.ok) {
    if (check.reason.startsWith("status:")) {
      const s = remote.status
      const next = s === "expired" ? "expired" : s === "canceled" || s === "voided" ? "canceled" : s === "failed" ? "failed" : null
      if (next && ["creating", "initiated"].includes(attempt.status)) {
        const transition = await admin.from("platform_payment_attempts")
          .update({ status: next, updated_at: new Date().toISOString() })
          .eq("id", attempt.id).eq("tenant_id", attempt.tenant_id).eq("provider_invoice_id", attempt.provider_invoice_id)
          .eq("status", attempt.status).in("status", ["creating", "initiated"])
          .select(attemptColumns).maybeSingle<AttemptRow>()
        if (transition.error) return { outcome: "unknown" }
        if (transition.data) return { outcome: sameAttempt(transition.data, attempt) && transition.data.status === next ? next : "unknown" }
      }
      // A paid callback may have won while the provider request was in flight.
      // Re-read its durable result instead of returning our stale observation.
      const current = await readAttempt(admin, { attemptId: attempt.id, tenantId: attempt.tenant_id })
      if (!current || !sameAttempt(current, attempt)) return { outcome: "unknown" }
      const outcome = knownOutcome(current)
      return {
        outcome,
        ...(outcome === "pending" && remote.status === "initiated" && current.status === "initiated"
          && current.checkout_url === remote.url && current.checkout_url?.startsWith("https://") ? { checkoutUrl: current.checkout_url } : {}),
      }
    }
    logger.error({ attempt: attempt.id, reason: check.reason }, "moyasar invoice mismatch")
    return { outcome: "mismatch" }
  }
  const { data, error } = await admin.rpc("settle_platform_card_payment", { p_attempt_id: attempt.id, p_provider_payment_id: check.paymentId, p_amount_halalas: remote.amount })
  if (error) {
    logger.error({ attempt: attempt.id, code: error.code }, "card settlement failed")
    return { outcome: "unknown" }
  }
  return { outcome: ["settled", "already_settled", "duplicate_payment"].includes(data) ? data as SettleOutcome : "unknown" }
}

/** Re-read the attempt from Moyasar and settle if paid. Safe to call repeatedly. */
export async function reconcileAttempt(where: AttemptWhere): Promise<SettleOutcome> {
  return (await inspectAttempt(where)).outcome
}
