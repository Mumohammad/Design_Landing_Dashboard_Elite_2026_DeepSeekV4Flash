"use server"

// Financial Phase 7 — Expense approval.
//
// approveExpense() approves a pending expense: captures input VAT
// (vat_rate / vat_amount / vat_recoverability), resolves the CoA expense
// account from `expense_category_mappings` (snapshot to coa_account_code),
// creates the Accounts Payable row (source_entity_type = 'expense'), and
// emits the ExpenseApprovedEvent for the Phase 9 journal/VAT consumers.
//
// Canonical math (same rules as the invoice engine):
//   vat_amount = round2(amount × vat_rate / 100)   — `amount` is the NET base
//   payable total = round2(amount + vat_amount)
//
// Error codes (error-codes.ts): EXP001 not found · EXP002 already approved
// · EXP003 invalid VAT/recoverability · EXP004 approval guard (DB trigger)
// · EXP005 no CoA mapping for the category.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError } from "@/lib/accounting/csv-utils"
import { idempotencyKey } from "@/lib/accounting/financial-events"
import { runEventDispatcher } from "@/lib/accounting/dispatcher"
import { round2 } from "@/lib/accounting/invoice-math"

type ActionResult = { success: boolean; error?: string }

export type ExpenseVatRecoverability = "recoverable" | "non_recoverable" | "pending_review"

export type ExpenseType = "fuel" | "advance" | "operational" | "platform_commission" | "maintenance" | "other"

export const EXPENSE_TYPES: ExpenseType[] = ["fuel", "advance", "operational", "platform_commission", "maintenance", "other"]

const RECOVERABILITY: ExpenseVatRecoverability[] = ["recoverable", "non_recoverable", "pending_review"]

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

type ExpenseRow = {
  id: string
  expense_code: string | null
  expense_type: string
  category: string | null
  amount: number
  expense_date: string
  description: string | null
  vendor: string | null
  driver_id: string | null
  vehicle_id: string | null
  is_approved: boolean
}

type MappingRow = {
  coa_account_code: string
  vat_recoverability: ExpenseVatRecoverability
}

/**
 * Approve a pending expense → payable + ExpenseApprovedEvent.
 * Permission: expenses:approve.
 */
export async function approveExpense(input: {
  id: string
  vat_rate?: number
  vat_recoverability?: ExpenseVatRecoverability
}): Promise<ActionResult> {
  try {
    await requirePermission("expenses", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const vatRate = Number(input.vat_rate ?? 15)
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return { success: false, error: mapFinancialError("EXP003: invalid VAT rate") }
    }
    const recoverability = input.vat_recoverability ?? "recoverable"
    if (!RECOVERABILITY.includes(recoverability)) {
      return { success: false, error: mapFinancialError("EXP003: invalid recoverability") }
    }

    const admin = createAdminClient()

    const { data: expense, error: fetchErr } = await admin
      .from("expenses")
      .select("id,expense_code,expense_type,category,amount,expense_date,description,vendor,driver_id,vehicle_id,is_approved")
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle<ExpenseRow>()
    if (fetchErr || !expense) return { success: false, error: mapFinancialError("EXP001: expense not found") }
    if (expense.is_approved) return { success: false, error: mapFinancialError("EXP002: already approved") }

    // Resolve the CoA expense account for this category (Phase 7 mapping).
    const { data: mapping } = await admin
      .from("expense_category_mappings")
      .select("coa_account_code,vat_recoverability")
      .eq("tenant_id", currentUser.tenantId)
      .eq("expense_type", expense.expense_type)
      .maybeSingle<MappingRow>()
    if (!mapping?.coa_account_code) {
      return { success: false, error: mapFinancialError("EXP005: no CoA mapping for category") }
    }
    const finalRecoverability: ExpenseVatRecoverability =
      input.vat_recoverability ?? mapping.vat_recoverability ?? "recoverable"

    const amount = Number(expense.amount)
    const vatAmount = round2((amount * vatRate) / 100)
    const total = round2(amount + vatAmount)
    const invoiceRef = expense.expense_code ?? `EXP-${expense.id.slice(0, 8).toUpperCase()}`

    // Payable FIRST (mirrors finalizeInvoice): a failed AP insert aborts the
    // approval so the expense is never left approved without its AP row.
    const { error: payErr } = await admin.from("payables").insert({
      tenant_id: currentUser.tenantId,
      supplier_id: null,
      invoice_ref: invoiceRef,
      invoice_date: expense.expense_date,
      due_date: expense.expense_date,
      amount,
      vat_amount: vatAmount,
      total_amount: total,
      paid_amount: 0,
      status: "open",
      source_entity_type: "expense",
      source_entity_id: expense.id,
      notes: `${expense.category ?? expense.expense_type}${expense.vendor ? ` — ${expense.vendor}` : ""}`,
      created_by: currentUser.authUserId,
    })
    if (payErr) return { success: false, error: mapFinancialError(payErr.message) }

    const { error: updErr } = await admin
      .from("expenses")
      .update({
        is_approved: true,
        approved_by: currentUser.authUserId,
        approved_at: new Date().toISOString(),
        vat_rate: vatRate,
        vat_amount: vatAmount,
        vat_recoverability: finalRecoverability,
        coa_account_code: mapping.coa_account_code,
        updated_by: currentUser.authUserId,
      })
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
    if (updErr) {
      // Roll the AP row back if the approval write failed.
      await admin
        .from("payables")
        .update({ deleted_at: new Date().toISOString() })
        .eq("source_entity_type", "expense")
        .eq("source_entity_id", expense.id)
      return { success: false, error: mapFinancialError(updErr.message) }
    }

    // ExpenseApprovedEvent — consumers post Dr Expense / Dr VAT Input / Cr AP.
    // Persistence failures are logged, not thrown (same contract as emitEvent).
    const { error: evtErr } = await admin.from("financial_events").insert({
      tenant_id: currentUser.tenantId,
      event_id: crypto.randomUUID(),
      idempotency_key: idempotencyKey("expense", expense.id, "approved"),
      source_type: "expense",
      source_id: expense.id,
      event_type: "ExpenseApprovedEvent",
      event_date: expense.expense_date,
      payload: {
        expense_id: expense.id,
        expense_code: expense.expense_code,
        expense_type: expense.expense_type,
        category: expense.category,
        amount,
        vat_amount: vatAmount,
        vat_rate: vatRate,
        vat_recoverability: finalRecoverability,
        coa_account_code: mapping.coa_account_code,
        driver_id: expense.driver_id,
        vehicle_id: expense.vehicle_id,
      },
    })
    if (evtErr && process.env.NODE_ENV !== "production") {
      console.error("[financial_events] ExpenseApprovedEvent insert failed:", evtErr.message)
    }

    // Phase 9 — dispatch now: Dr Expense (+ Dr VAT In when recoverable) /
    // Cr AP journal + classified input-VAT ledger row.
    await runEventDispatcher()

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "expenses",
      action: "expense_approved",
      entityType: "expenses",
      entityId: expense.id,
      newValues: {
        expense_code: expense.expense_code,
        expense_type: expense.expense_type,
        amount,
        vat_amount: vatAmount,
        total,
        coa_account_code: mapping.coa_account_code,
        vat_recoverability: finalRecoverability,
      },
    })

    revalidatePath("/expenses")
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Create a pending expense (entered from the UI, approved later).
 * Permission: expenses:create. The DB assigns the EXP-YYYY-000xxx code.
 */
export async function createExpense(input: {
  expense_type: ExpenseType
  category?: string
  amount: number
  expense_date: string
  vendor?: string | null
  description?: string | null
  vat_rate?: number
}): Promise<ActionResult & { id?: string }> {
  try {
    await requirePermission("expenses", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const amount = Number(input.amount)
    const vatRate = Number(input.vat_rate ?? 15)
    const type = input.expense_type
    if (!EXPENSE_TYPES.includes(type)) {
      return { success: false, error: mapFinancialError("EXP006: invalid expense type") }
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: mapFinancialError("EXP006: amount must be positive") }
    }
    if (!input.expense_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.expense_date)) {
      return { success: false, error: mapFinancialError("EXP006: expense date required") }
    }
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return { success: false, error: mapFinancialError("EXP003: invalid VAT rate") }
    }

    const admin = createAdminClient()
    const { data: row, error } = await admin
      .from("expenses")
      .insert({
        tenant_id: currentUser.tenantId,
        expense_type: type,
        category: input.category?.trim() || null,
        amount,
        currency: "SAR",
        expense_date: input.expense_date,
        description: input.description?.trim() || null,
        vendor: input.vendor?.trim() || null,
        vat_rate: vatRate,
        is_approved: false,
        created_by: currentUser.authUserId,
      })
      .select("id,expense_code")
      .single()
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "expenses",
      action: "expense_created",
      entityType: "expenses",
      entityId: row.id,
      newValues: { expense_code: row.expense_code, expense_type: type, amount, expense_date: input.expense_date },
    })

    revalidatePath("/expenses")
    return { success: true, id: row.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
