"use server"

// Accounting Module — Phase 10: Payments Engine.
//
// Actions:
// - recordPayment       accounting:create → finance_payments + allocations
//                       + PaymentAllocatedEvent (auto-dispatched → journal
//                       Dr Bank/Cr AR or Dr AP/Cr Bank + AR/AP paid_amount)
// - voidPayment         accounting:approve → status 'void' + PaymentVoidedEvent
//                       (auto-dispatched → reversal journal + restore)
// - createBankAccount   accounting:create → bank account mapped to a CoA
//                       account (default 1100 Bank; cash posts to 1000)
//
// All money is validated here (fast-fail) AND at the DB (PMT001/PMT002/
// PMT003 triggers in migration 048) — the DB is the source of truth.
// Effects (journal + AR/AP + invoice status) are materialised idempotently
// by the Phase 10 dispatcher consumers.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError } from "@/lib/accounting/csv-utils"
import { createClient } from "@/lib/supabase/server"
import { sumMoney } from "@/lib/accounting/decimal"
import { runEventDispatcher } from "@/lib/accounting/dispatcher"
import { round2 } from "@/lib/accounting/invoice-math"

type ActionResult = { success: boolean; error?: string; id?: string; postingStatus?: "posted" | "pending" }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

/** Map a DB/app error code to its bilingual message (PAY* is payroll's prefix). */
function pmt(code: string): string {
  return mapFinancialError(`${code}: `)
}

export type PaymentDirection = "in" | "out"
export type PaymentMethod = "cash" | "transfer" | "cheque" | "wps" | "card"

export type PaymentAllocationInput = {
  receivable_id?: string | null
  payable_id?: string | null
  amount: number
}

export type RecordPaymentInput = {
  request_id: string
  direction: PaymentDirection
  payment_date: string
  amount: number
  method: PaymentMethod
  bank_account_id?: string | null
  customer_id?: string | null
  supplier_id?: string | null
  reference?: string | null
  allocations: PaymentAllocationInput[]
}

export async function recordPayment(input: RecordPaymentInput): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    if (!(await getCurrentUser())) return { success: false, error: "Not authenticated." }
    const amount = round2(input.amount)
    const allocations = (input.allocations ?? []).map((a) => ({
      receivable_id: a.receivable_id || null, payable_id: a.payable_id || null, amount: round2(a.amount),
    }))
    if (!input.request_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.request_id)
      || !["in", "out"].includes(input.direction) || !["cash", "transfer", "cheque", "wps", "card"].includes(input.method)
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.payment_date)
      || amount <= 0 || amount > 9_999_999_999.99 || allocations.length === 0 || allocations.length > 1000
      || (input.direction === "in" ? !input.customer_id || !!input.supplier_id : !input.supplier_id || !!input.customer_id)
      || (input.method !== "cash" && !input.bank_account_id)
      || allocations.some((a) => a.amount <= 0 || a.amount > 9_999_999_999.99
        || Number(!!a.receivable_id) + Number(!!a.payable_id) !== 1
        || (input.direction === "in" ? !a.receivable_id : !a.payable_id))) {
      return { success: false, error: pmt("PMT004") }
    }
    if (sumMoney(...allocations.map((a) => a.amount)) !== amount) {
      return { success: false, error: pmt("PMT003") }
    }
    const client = await createClient()
    const { data, error } = await client.rpc("record_finance_payment_atomic", {
      p_request_id: input.request_id,
      p_payment: { direction: input.direction, payment_date: input.payment_date, amount, method: input.method,
        bank_account_id: input.method === "cash" ? null : input.bank_account_id,
        customer_id: input.direction === "in" ? input.customer_id : null,
        supplier_id: input.direction === "out" ? input.supplier_id : null, reference: input.reference?.trim() || null },
      p_allocations: allocations,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    if (!data?.id) return { success: false, error: "Payment save did not return a committed identifier." }
    if (data.status === "void") {
      return { success: false, id: data.id, error: "This payment was voided. Start a new payment to record another receipt. / تم إلغاء هذه الدفعة. ابدأ دفعة جديدة لتسجيل عملية أخرى." }
    }
    // Posting needs accounting:approve. A create-only caller gets a durable,
    // pending payment, never a false "posted" result.
    await runEventDispatcher()
    const { data: saved, error: readError } = await client.from("finance_payments")
      .select("status").eq("id", data.id).maybeSingle()
    const postingStatus = !readError && saved?.status === "allocated" ? "posted" : "pending"
    revalidatePath("/accounting")
    revalidatePath("/payments")
    return { success: true, id: data.id, postingStatus }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function voidPayment(input: { id: string }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "approve")
    if (!(await getCurrentUser())) return { success: false, error: "Not authenticated." }
    const client = await createClient()
    const { data, error } = await client.rpc("void_finance_payment_atomic", { p_id: input.id })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    if (!data?.id || data.status !== "void") return { success: false, error: "Payment reversal was not confirmed." }
    revalidatePath("/accounting")
    revalidatePath("/payments")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export type CreateBankAccountInput = {
  bank_name: string
  account_name: string
  iban: string
  account_number?: string | null
  currency?: string
  opening_balance?: number
  coa_account_code?: string
}

export async function createBankAccount(input: CreateBankAccountInput): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    if (input.currency != null && input.currency !== "SAR") {
      return { success: false, error: "Accounting supports SAR only. / المحاسبة تدعم الريال السعودي فقط." }
    }

    if (!input.bank_name.trim() || !input.account_name.trim() || !input.iban.trim()) {
      return { success: false, error: pmt("PMT004") }
    }

    const admin = createAdminClient()
    const { data: row, error } = await admin
      .from("bank_accounts")
      .insert({
        tenant_id: currentUser.tenantId,
        bank_name: input.bank_name.trim(),
        account_name: input.account_name.trim(),
        iban: input.iban.trim(),
        account_number: input.account_number ?? null,
        currency: input.currency ?? "SAR",
        opening_balance: round2(input.opening_balance ?? 0) || 0,
        is_active: true,
        coa_account_code: input.coa_account_code?.trim() || "1100",
        created_by: currentUser.authUserId,
      })
      .select("id")
      .single()
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "bank_account_created",
      entityType: "bank_accounts",
      entityId: row.id,
      newValues: { bank_name: input.bank_name, iban: input.iban },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
