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
import { idempotencyKey } from "@/lib/accounting/financial-events"
import { runEventDispatcher } from "@/lib/accounting/dispatcher"
import { round2 } from "@/lib/accounting/invoice-math"

type ActionResult = { success: boolean; error?: string }

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
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const direction = input.direction
    const amount = round2(input.amount)
    const allocations = (input.allocations ?? []).map((a) => ({
      receivable_id: a.receivable_id || null,
      payable_id: a.payable_id || null,
      allocated_amount: round2(a.amount),
    }))

    // ── Validation (fast-fail; the DB enforces the same rules) ──────────
    if (direction !== "in" && direction !== "out") {
      return { success: false, error: pmt("PMT004") }
    }
    if (!Number.isFinite(amount) || amount <= 0 || !input.payment_date) {
      return { success: false, error: pmt("PMT004") }
    }
    if (direction === "in" && !input.customer_id) {
      return { success: false, error: pmt("PMT004") }
    }
    if (direction === "out" && !input.supplier_id) {
      return { success: false, error: pmt("PMT004") }
    }
    if (input.method !== "cash" && !input.bank_account_id) {
      return { success: false, error: pmt("PMT004") }
    }

    let sum = 0
    for (const a of allocations) {
      const targets = (a.receivable_id ? 1 : 0) + (a.payable_id ? 1 : 0)
      if (targets !== 1 || !Number.isFinite(a.allocated_amount) || a.allocated_amount <= 0) {
        return { success: false, error: pmt("PMT004") }
      }
      if (direction === "in" && !a.receivable_id) return { success: false, error: pmt("PMT004") }
      if (direction === "out" && !a.payable_id) return { success: false, error: pmt("PMT004") }
      sum += a.allocated_amount
    }
    if (allocations.length === 0) {
      return { success: false, error: pmt("PMT004") }
    }
    if (Math.abs(sum - amount) > 0.01) {
      return { success: false, error: pmt("PMT003") }
    }

    const admin = createAdminClient()

    // ── Party + bank belong to the tenant ────────────────────────────────
    if (input.customer_id) {
      const { data: c } = await admin
        .from("customers").select("id").eq("id", input.customer_id)
        .is("deleted_at", null).maybeSingle()
      if (!c) return { success: false, error: pmt("CUS001") }
    }
    if (input.supplier_id) {
      const { data: s } = await admin
        .from("suppliers").select("id").eq("id", input.supplier_id)
        .is("deleted_at", null).maybeSingle()
      if (!s) return { success: false, error: pmt("SUP001") }
    }
    if (input.bank_account_id) {
      const { data: b } = await admin
        .from("bank_accounts").select("id").eq("id", input.bank_account_id)
        .is("deleted_at", null).maybeSingle()
      if (!b) return { success: false, error: pmt("PMT006") }
    }

    // ── Insert payment + allocations ─────────────────────────────────────
    const { data: pay, error: payErr } = await admin
      .from("finance_payments")
      .insert({
        tenant_id: currentUser.tenantId,
        direction,
        customer_id: direction === "in" ? input.customer_id : null,
        supplier_id: direction === "out" ? input.supplier_id : null,
        payment_date: input.payment_date,
        amount,
        method: input.method,
        bank_account_id: input.method === "cash" ? null : input.bank_account_id,
        reference: input.reference ?? null,
        status: "pending",
        created_by: currentUser.authUserId,
      })
      .select("id,payment_ref")
      .single()
    if (payErr) return { success: false, error: mapFinancialError(payErr.message) }

    const { error: allocErr } = await admin.from("payment_allocations").insert(
      allocations.map((a) => ({
        tenant_id: currentUser.tenantId,
        finance_payment_id: pay.id,
        receivable_id: a.receivable_id,
        payable_id: a.payable_id,
        allocated_amount: a.allocated_amount,
        allocated_by: currentUser.authUserId,
      }))
    )
    if (allocErr) return { success: false, error: mapFinancialError(allocErr.message) }

    // ── Event + auto-dispatch (same pattern as the invoice producers) ────
    const { error: evtErr } = await admin.from("financial_events").insert({
      tenant_id: currentUser.tenantId,
      event_id: crypto.randomUUID(),
      idempotency_key: idempotencyKey("payment", pay.id, "allocated"),
      source_type: "payment",
      source_id: pay.id,
      event_type: "PaymentAllocatedEvent",
      event_date: input.payment_date,
      payload: {
        payment_ref: pay.payment_ref,
        direction,
        amount,
        method: input.method,
        allocations: allocations.map((a) => ({
          receivable_id: a.receivable_id,
          payable_id: a.payable_id,
          amount: a.allocated_amount,
        })),
      },
    })
    if (evtErr && process.env.NODE_ENV !== "production") {
      console.error("[financial_events] PaymentAllocatedEvent insert failed:", evtErr.message)
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "payment_recorded",
      entityType: "finance_payments",
      entityId: pay.id,
      newValues: {
        payment_ref: pay.payment_ref,
        direction,
        amount,
        method: input.method,
        allocations: allocations.length,
      },
    })

    // runEventDispatcher never throws (returns a summary), so a permission
    // gap on approve leaves the event pending for a later run.
    await runEventDispatcher()

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function voidPayment(input: { id: string }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data: pay } = await admin
      .from("finance_payments")
      .select("id,payment_ref,status,payment_date,amount")
      .eq("id", input.id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!pay) return { success: false, error: pmt("PMT005") }
    if (pay.status === "void") return { success: false, error: pmt("PMT002") }

    // Allocated payments have journal + AR/AP effects that must be reversed
    // by the dispatcher; pending ones can be voided directly.
    const hadEffects = pay.status === "allocated" || pay.status === "partially_allocated"

    const { error: updErr } = await admin
      .from("finance_payments")
      .update({ status: "void", updated_by: currentUser.authUserId })
      .eq("id", pay.id)
    if (updErr) return { success: false, error: mapFinancialError(updErr.message) }

    if (hadEffects) {
      const { error: evtErr } = await admin.from("financial_events").insert({
        tenant_id: currentUser.tenantId,
        event_id: crypto.randomUUID(),
        idempotency_key: idempotencyKey("payment", pay.id, "voided"),
        source_type: "payment",
        source_id: pay.id,
        event_type: "PaymentVoidedEvent",
        event_date: pay.payment_date,
        payload: { payment_ref: pay.payment_ref },
      })
      if (evtErr && process.env.NODE_ENV !== "production") {
        console.error("[financial_events] PaymentVoidedEvent insert failed:", evtErr.message)
      }
      await runEventDispatcher()
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "payment_voided",
      entityType: "finance_payments",
      entityId: pay.id,
      newValues: { payment_ref: pay.payment_ref, status: "void" },
    })

    revalidatePath("/accounting")
    return { success: true }
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
