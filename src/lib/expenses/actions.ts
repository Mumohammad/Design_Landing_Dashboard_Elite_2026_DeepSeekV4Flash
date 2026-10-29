"use server"

// Financial Phase 7 — Expense approval.
//
// approveExpense() approves a pending expense: captures input VAT
// (vat_rate / vat_amount / vat_recoverability), resolves the CoA expense
// account from `expense_category_mappings` (snapshot to coa_account_code),
// creates the Accounts Payable row (source_entity_type = 'expense'), and
// emits the ExpenseApprovedEvent for the Phase 9 journal/VAT consumers.
//
// Canonical math lives in the DB (migration 063, approve_expense_atomic RPC):
//   vat_amount = round(amount × vat_rate / 100, 2) — `amount` is the NET base
//   payable total = amount + vat_amount
//
// FX-06: the approval is ONE atomic RPC (claim expense via conditional UPDATE
// → payable with ON CONFLICT DO NOTHING + exactly-one assert →
// ExpenseApprovedEvent). The old client-side check-then-insert had a
// double-payable race under two concurrent approvals.
//
// Error codes (error-codes.ts): EXP001 not found · EXP002 already approved
// · EXP003 invalid VAT/recoverability · EXP004 approval guard (DB trigger)
// · EXP005 no CoA mapping for the category. FX06 = RPC exactly-one assert
// (raw passthrough — not in the taxonomy).

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { mapFinancialError } from "@/lib/accounting/csv-utils"
import { runEventDispatcher } from "@/lib/accounting/dispatcher"
import { rateLimitExpenses } from "@/lib/auth/rate-limit"
import { emit } from "@/lib/webhooks/events"
import { round2 } from "@/lib/accounting/invoice-math"

type ActionResult = { success: boolean; error?: string; errorAr?: string }

// Domain constants live in @/lib/expenses/constants (a regular module) so
// client components can import them without hitting the server-action proxy.
import { EXPENSE_TYPES, RECOVERABILITY, type ExpenseVatRecoverability, type ExpenseType } from "@/lib/expenses/constants"

/**
 * Approve a pending expense → payable + ExpenseApprovedEvent.
 * Permission: expenses:approve.
 */
export async function approveExpense(input: {
  id: string
  expectedVersion: number
  vat_rate?: number
  vat_recoverability?: ExpenseVatRecoverability
  approvalReason?: string
  surface?: "expenses" | "approvals_inbox"
}): Promise<ActionResult & { alreadyApproved?: boolean; alreadyDecided?: boolean; postingPending?: boolean }> {
  try {
    await requirePermission("expenses", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated.", errorAr: "يلزم تسجيل الدخول." }
    const rl = await rateLimitExpenses(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later.", errorAr: "تجاوزت عدد المحاولات المسموح. حاول لاحقاً." }

    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) return { success:false,error:"Reload the expense before approval.",errorAr:"أعد تحميل المصروف قبل اعتماده." }
    const surface = input.surface ?? "expenses"
    // The inbox has no VAT editor. Preserve the locked expense's stored rate
    // in the transaction instead of silently replacing exempt/reduced VAT by 15%.
    const vatRate = input.vat_rate ?? (surface === "approvals_inbox" ? null : 15)
    if (vatRate !== null && (typeof vatRate !== "number" || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100)) {
      return { success: false, error: mapFinancialError("EXP003: invalid VAT rate"), errorAr: "أدخل نسبة ضريبة من 0 إلى 100 وتصنيفاً صحيحاً للاسترداد." }
    }
    const recoverability = input.vat_recoverability ?? "recoverable"
    if (!RECOVERABILITY.includes(recoverability)) {
      return { success: false, error: mapFinancialError("EXP003: invalid recoverability"), errorAr: "اختر تصنيف استرداد ضريبة صحيحاً." }
    }
    const reason = input.approvalReason?.trim() || null
    if (!["expenses", "approvals_inbox"].includes(surface) || (reason && reason.length > 500)
      || (surface === "approvals_inbox" && (!reason || reason.length < 5))) return {
      success: false, error: "Enter an approval reason between 5 and 500 characters.", errorAr: "أدخل سبب اعتماد من 5 إلى 500 حرف.",
    }

    // Lock the current expense, claim it once and commit the matching
    // payable, accounting event and approval audit in one transaction.
    const admin = createAdminClient()
    const caller = await createClient()
    const { data: rpcData, error: rpcErr } = await caller.rpc("decide_expense_reviewed_atomic", {
      p_id: input.id, p_expected_version: input.expectedVersion, p_decision: "approved",
      p_vat_rate: vatRate === null ? null : round2(vatRate),
      p_recoverability: input.vat_recoverability ?? null, p_reason: reason, p_surface: surface,
    })
    if (rpcErr) {
      if (rpcErr.message.startsWith("EXP_EDIT_STALE")) return {success:false,error:"This expense changed. Reload and review its latest amounts before approval.",errorAr:"تغير المصروف. أعد تحميل أحدث المبالغ وراجعها قبل الاعتماد."}
      if (rpcErr.message.startsWith("EXP_CANCELLED")) return {success:false,alreadyDecided:true,error:"This expense was cancelled. Review its current status.",errorAr:"أُلغي هذا المصروف. راجع حالته الحالية."}
      if (rpcErr.message.startsWith("EXP_REJECTED:")) return {
        success: false, alreadyDecided: true, error: "This expense was rejected. Review the refreshed decision.",
        errorAr: "رُفض هذا المصروف مسبقاً. راجع القرار بعد تحديث القائمة.",
      }
      if (rpcErr.message.startsWith("EXP002:")) return {
        success: false, alreadyApproved: true, error: mapFinancialError(rpcErr.message),
        errorAr: "تم اعتماد المصروف مسبقاً. راجع بياناته بعد تحديث القائمة.",
      }
      const known = /^(EXP001|EXP003|EXP004|EXP005):/.exec(rpcErr.message)?.[1]
      if (known) return { success: false, error: mapFinancialError(known + ":"), errorAr: known === "EXP005"
        ? "لا يوجد ربط بحساب محاسبي لهذه الفئة." : known === "EXP001" ? "المصروف غير موجود. أعد تحميل القائمة." : "تحقق من نسبة الضريبة وتصنيف الاسترداد وبيانات الاعتماد." }
      return { success: false, error: rpcErr.message.startsWith("FX06:") ? "FX06: Expense payable requires review." : "Expense approval requires review. Reload the expense and Accounting events.",
        errorAr: "يلزم مراجعة الاعتماد. أعد تحميل المصروف وأحداث المحاسبة." }
    }

    const rpc = rpcData as {
      expense_id: string
      expense_ref: string
      amount: number
      vat_amount: number
      total: number
      coa_account_code: string
      vat_recoverability: ExpenseVatRecoverability
      event_id: string
    } | null
    if (!rpc || rpc.expense_id !== input.id || typeof rpc.event_id !== "string") return {
      success: false, error: "Unable to confirm expense approval. Reload and review before retrying.",
      errorAr: "تعذر تأكيد اعتماد المصروف. أعد تحميله وراجعه قبل المحاولة مجدداً.",
    }

    // Phase 9 — dispatch now: Dr Expense (+ Dr VAT In when recoverable) /
    // Cr AP journal + classified input-VAT ledger row.
    // Approval and its audit are already committed. A posting/cache/network
    // failure cannot honestly be reported as a failed approval. Check this
    // specific event rather than interpreting an unrelated batch's totals.
    let postingPending = true
    try {
      await runEventDispatcher()
      const posting = await admin.from("financial_events").select("processing_status")
        .eq("tenant_id", currentUser.tenantId).eq("event_id", rpc.event_id)
        .eq("source_type", "expense").eq("source_id", input.id).maybeSingle()
      postingPending = !!posting.error || !["processed", "skipped_duplicate"].includes(posting.data?.processing_status ?? "")
    } catch { /* Retain the confirmed approval and disclose unverified posting. */ }

    try { emit("expense.approved", currentUser.tenantId, {
      id: rpc.expense_id,
      amount: rpc.total,
      approvedBy: currentUser.id,
    }) } catch { /* The retained accounting event is independent of webhook delivery. */ }

    try { revalidatePath("/expenses"); revalidatePath("/accounting") } catch { /* Client refresh still reads committed data. */ }
    return { success: true, postingPending }
  } catch (e) {
    void e
    return { success: false, error: "Unable to confirm expense approval. Reload and review before retrying.", errorAr: "تعذر تأكيد اعتماد المصروف. أعد تحميله وراجعه قبل المحاولة مجدداً." }
  }
}

/**
 * Create a pending expense (entered from the UI, approved later).
 * Permission: expenses:create. The DB assigns the EXP-YYYY-000xxx code.
 */
export async function createExpense(input: {
  request_id: string
  expense_type: ExpenseType
  category?: string
  amount: number
  expense_date: string
  vendor?: string | null
  description?: string | null
  vat_rate?: number
}): Promise<ActionResult & { errorAr?: string; id?: string; replayed?: boolean }> {
  try {
    await requirePermission("expenses", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated.", errorAr: "يلزم تسجيل الدخول." }
    const rl = await rateLimitExpenses(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later.", errorAr: "تجاوزت عدد المحاولات المسموح. حاول لاحقاً." }

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(input.request_id ?? "")) return { success: false, error: "Reopen the form to start a new expense.", errorAr: "أعد فتح النموذج لبدء مصروف جديد." }
    const amount = input.amount
    const vatRate = input.vat_rate ?? 15
    const type = input.expense_type
    if (!EXPENSE_TYPES.includes(type)) {
      return { success: false, error: "Select a valid expense type.", errorAr: "اختر نوع مصروف صحيحاً." }
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 99_999_999.99 || round2(amount) <= 0) {
      return { success: false, error: "Enter an amount from 0.01 to 99,999,999.99 SAR.", errorAr: "أدخل مبلغاً من 0.01 إلى 99,999,999.99 ر.س." }
    }
    const date = new Date(input.expense_date)
    if (typeof input.expense_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.expense_date)
      || input.expense_date < "0001-01-01" || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.expense_date) {
      return { success: false, error: "Enter a valid expense date.", errorAr: "أدخل تاريخ مصروف صحيحاً." }
    }
    if (typeof vatRate !== "number" || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return { success: false, error: "Enter a VAT rate from 0 to 100.", errorAr: "أدخل نسبة ضريبة من 0 إلى 100." }
    }

    for (const [value, max] of [[input.category, 200], [input.vendor, 200], [input.description, 2000]] as const) {
      if (value != null && (typeof value !== "string" || value.trim().length > max)) return {
        success: false, error: "Check the category, vendor and description lengths.", errorAr: "تحقق من طول الفئة والمورد والوصف.",
      }
    }
    // Preserve JWT/MFA context. The database owns tenant/actor derivation,
    // request arbitration and the single expense/audit commit.
    const supabase = await createClient()
    const { data: row, error } = await supabase.rpc("create_expense_atomic", {
      p_request_id: input.request_id,
      p_expense: {
        expense_type: type,
        category: input.category?.trim() || null,
        amount: round2(amount),
        expense_date: input.expense_date,
        description: input.description?.trim() || null,
        vendor: input.vendor?.trim() || null,
        vat_rate: round2(vatRate),
      },
    })
    if (error?.message?.startsWith("EXP_RETRY_UNAVAILABLE:")) return { success: false,
      error: "The original expense changed or was removed. Reload and review it before creating another.",
      errorAr: "تغير المصروف الأصلي أو حُذف. أعد تحميله وراجعه قبل إنشاء مصروف آخر." }
    if (error?.message?.startsWith("EXP_RETRY:")) return { success: false,
      error: "This request already saved different details. Reload and review the original expense before starting a new one.",
      errorAr: "حُفظ هذا الطلب بتفاصيل مختلفة. أعد تحميل المصروف الأصلي وراجعه قبل بدء طلب جديد." }
    if (error || !row || !uuid.test(row.id ?? "") || typeof row.replayed !== "boolean") return { success: false,
      error: "Unable to confirm this expense. Retry with unchanged details.",
      errorAr: "تعذر تأكيد حفظ المصروف. أعد المحاولة بالتفاصيل نفسها." }

    revalidatePath("/expenses")
    return { success: true, id: row.id, replayed: row.replayed }
  } catch (e) {
    void e
    return { success: false, error: "Unable to confirm this expense. Retry with unchanged details.", errorAr: "تعذر تأكيد حفظ المصروف. أعد المحاولة بالتفاصيل نفسها." }
  }
}
