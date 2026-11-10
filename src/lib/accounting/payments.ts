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
import { rateLimitAccounting } from "@/lib/auth/rate-limit"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
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

async function saveBankAccount(input: CreateBankAccountInput, id?: string, expectedUpdatedAt?: string): Promise<ActionResult> {
  try {
    await requirePermission("accounting", id ? "update" : "create")
    if ((input.currency ?? "SAR") !== "SAR") return { success: false, error: "Accounting supports SAR only; existing foreign-currency records require review." }
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const limit = await rateLimitAccounting(currentUser.id)
    if (!limit.success) return { success: false, error: "Rate limit exceeded. Try again later." }
    const client = await createClient()
    const { error } = await client.rpc("save_bank_account", {
      p_input: input, p_bank_id: id ?? null, p_expected_updated_at: expectedUpdatedAt ?? null,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    revalidatePath("/accounting")
    return { success: true }
  } catch (error) { return { success: false, error: mapFinancialError(errorMessage(error)) } }
}

export async function createBankAccount(input: CreateBankAccountInput): Promise<ActionResult> {
  return saveBankAccount(input)
}

export async function updateBankAccount(input: CreateBankAccountInput & { id: string; expected_updated_at: string }): Promise<ActionResult> {
  const { id, expected_updated_at, ...details } = input
  return saveBankAccount(details, id, expected_updated_at)
}

export async function changeBankAccountState(input: { id: string; expected_updated_at: string; action: "activate" | "deactivate" | "delete" }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", input.action === "delete" ? "delete" : "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const limit = await rateLimitAccounting(currentUser.id)
    if (!limit.success) return { success: false, error: "Rate limit exceeded. Try again later." }
    const client = await createClient()
    const { error } = await client.rpc("change_bank_account_state", {
      p_bank_id: input.id, p_expected_updated_at: input.expected_updated_at, p_action: input.action,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    revalidatePath("/accounting")
    return { success: true }
  } catch (error) { return { success: false, error: mapFinancialError(errorMessage(error)) } }
}
