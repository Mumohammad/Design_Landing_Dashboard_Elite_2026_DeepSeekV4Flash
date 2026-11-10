"use server"

// Accounting Module 9 — Phase 11 (IMPLEMENTATION-PLAN Phase 10): VAT reconciliation.
//
// - getVatReconciliation()            read the per-period reconciliation view
// - resolveVatReviewItem()            classify a pending_review input row
// - exportVatReconciliationCsv()      BOM CSV of per-period reconciliation
// - generateVatReconciliationReport() printable bilingual A4 reconciliation report
//
// The `vat_reconciliation` VIEW (migration 051) computes, per (tenant, year,
// month), output VAT − recoverable input ± adjustments = net position, live
// from the ledgers + finalized adjustments. security_invoker means the
// caller's RLS applies, so a browser client can also query the view directly
// (PostgREST exposes it); these server actions cover the guarded mutation
// (review-item resolution) and the exports.
//
// Review-item guard: vat_input_ledger.vat_recoverability may only change
// while the row is `pending_review` (DB trigger VAT004, migration 051).

import { decimalRound, type DecimalInput } from "@/lib/accounting/decimal"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError, toCsv } from "@/lib/accounting/csv-utils"
import { netNature } from "@/lib/accounting/vat-math"
import { buildVatReconciliationHtml, type VatReportRow } from "@/lib/accounting/vat-report-html"
import { buildVatReturnHtml, type VatReturnFieldRow } from "@/lib/accounting/vat-return-html"

type ActionResult = { success: boolean; error?: string; errorAr?: string }

type ReconRow = {
  period_id: string | null
  period_year: number
  period_month: number
  period_status: string | null
  output_vat: DecimalInput
  recoverable_input_vat: DecimalInput
  non_recoverable_vat: DecimalInput
  pending_review_vat: DecimalInput
  adjustments_output: DecimalInput
  adjustments_input: DecimalInput
  pending_review_rows: number
  net_position: DecimalInput
}

type VatReviewItem = {
  id: string
  invoice_ref: string
  invoice_date: string
  vat_base_amount: DecimalInput
  vat_rate: DecimalInput
  vat_amount: DecimalInput
  supplier_id: string | null
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && e.code === "AUTH007") return "You do not have permission to perform this accounting action."
  return "The accounting operation could not be completed. Reload and try again."
}

/**
 * Read the per-period reconciliation rows for the current tenant
 * (newest month first). Used by the accounting VAT tab.
 */
export async function getVatReconciliation(): Promise<{ success: boolean; rows?: ReconRow[]; error?: string }> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const caller = await createClient()
    const { data, error } = await caller.rpc("read_my_financial_report", { p_kind: "vat" })
    if (error || !Array.isArray(data)) return { success: false, error: "VAT reconciliation could not be loaded completely. Please retry." }
    return { success: true, rows: data as ReconRow[] }

  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * List vat_input_ledger rows still awaiting review (pending_review).
 * These rows are excluded from the net position until a human classifies
 * them via resolveVatReviewItem.
 */
export async function listVatReviewItems(): Promise<{ success: boolean; rows?: VatReviewItem[]; error?: string }> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const caller = await createClient()
    const { data, error } = await caller.rpc("read_my_financial_report", { p_kind: "vat_review" })
    if (error || !Array.isArray(data)) return { success: false, error: "VAT review items could not be loaded completely. Please retry." }
    return { success: true, rows: data as VatReviewItem[] }

  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Resolve a pending_review input-VAT row to a final classification.
 * Only `recoverable` or `non_recoverable` is accepted; the DB trigger
 * (VAT004) rejects any attempt to reclassify a row that is not pending.
 * Permission: accounting:approve.
 */
export async function resolveVatReviewItem(
  input: { id: string; recoverability: "recoverable" | "non_recoverable" }
): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const caller = await createClient()
    const { error } = await caller.rpc("resolve_my_vat_review", { p_id: input.id, p_recoverability: input.recoverability })
    if (error) {
      if(error.message?.startsWith("VAT007:"))return {success:false,error:"The source posting needs finance review before VAT can be classified. No tax claim or journal was changed.",errorAr:"يلزم تدقيق الترحيل الأصلي مالياً قبل تصنيف الضريبة. لم تتغير المطالبة الضريبية أو القيود."}
      if(error.message?.startsWith("VAT001:")||error.message?.startsWith("ACC001:"))return {success:false,error:"The source accounting or VAT period is closed. Finance must review the period before classification.",errorAr:"الفترة المحاسبية أو الضريبية الأصلية مغلقة. يلزم تدقيقها من الإدارة المالية قبل التصنيف."}
      if (error.message?.startsWith("VAT004:")) return { success: false, error: mapFinancialError("VAT004: classification is already final") }
      return { success: false, error: "VAT classification could not be saved. Reload and retry.",errorAr:"تعذر حفظ تصنيف الضريبة. أعد التحميل وحاول مجدداً." }
    }
    return { success: true }

  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/** Build the per-period reconciliation table for CSV export. */
export async function exportVatReconciliationCsv(): Promise<{ success: boolean; csv?: string; error?: string }> {
  try {
    await requirePermission("accounting", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const reconciliation = await getVatReconciliation()
    if (!reconciliation.success) return { success: false, error: reconciliation.error }
    const data = reconciliation.rows ?? []

    const rows = (data ?? []).map((r) => {
      const row = r as unknown as ReconRow
      return [
        `${row.period_year}-${String(row.period_month).padStart(2, "0")}`,
        row.period_status ?? "",
        row.output_vat,
        row.recoverable_input_vat,
        row.non_recoverable_vat,
        row.pending_review_vat,
        row.adjustments_output,
        row.adjustments_input,
        row.net_position,
        row.pending_review_rows,
      ]
    })

    const csv = "\uFEFF" + toCsv(
      ["period", "status", "output_vat", "recoverable_input_vat", "non_recoverable_vat", "pending_review_vat", "adjustments_output", "adjustments_input", "net_position", "pending_review_rows"],
      rows
    )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "vat_reconciliation_exported",
      entityType: "vat_reconciliation",
      newValues: { rows: (data ?? []).length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Printable bilingual A4 reconciliation report (all periods). Returns the
 * full HTML for a window.print() flow, mirroring the invoice/template docs.
 */
export async function generateVatReconciliationReport(): Promise<{ success: boolean; html?: string; error?: string }> {
  try {
    await requirePermission("accounting", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const reconciliation = await getVatReconciliation()
    if (!reconciliation.success) return { success: false, error: reconciliation.error }
    const data = reconciliation.rows ?? []

    const { data: tenant, error: tenantError } = await createAdminClient()
      .from("tenants")
      .select("name_ar,name_en,vat_number")
      .eq("id", currentUser.tenantId)
      .maybeSingle<{ name_ar: string | null; name_en: string | null; vat_number: string | null }>()
    if (tenantError || !tenant) return { success: false, error: "Company details could not be loaded for this report." }

    const rows = (data ?? []) as unknown as ReconRow[]
    if (rows.length === 0) {
      return { success: false, error: mapFinancialError("VAT005: no reconciliation data for this period") }
    }

    const reportRows: VatReportRow[] = rows.map((r) => ({
      period: `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
      status: r.period_status ?? "—",
      outputVat: decimalRound(r.output_vat),
      recoverableInput: decimalRound(r.recoverable_input_vat),
      nonRecoverable: decimalRound(r.non_recoverable_vat),
      pendingReview: decimalRound(r.pending_review_vat),
      adjustmentsOutput: decimalRound(r.adjustments_output),
      adjustmentsInput: decimalRound(r.adjustments_input),
      netPosition: decimalRound(r.net_position),
      pendingReviewRows: Number(r.pending_review_rows),
    }))

    const html = buildVatReconciliationHtml({
      companyNameAr: tenant?.name_ar || tenant?.name_en || "",
      companyNameEn: tenant?.name_en ?? "",
      companyVatNumber: tenant?.vat_number ?? "—",
      generatedAt: new Date().toISOString(),
      rows: reportRows,
    })

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "vat_reconciliation_report_generated",
      entityType: "vat_reconciliation",
      newValues: { periods: rows.length },
    })

    return { success: true, html }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Phase 12 (IMPLEMENTATION-PLAN Phase 11): VAT return preparation ────────
//
// Per-period VAT return summary, bilingual, export CSV + printable A4.
// NO submission API — submission stays out of scope until the ZATCA adapter.
// The return derives from the same `vat_reconciliation` view as the
// reconciliation report, so numbers round-trip exactly (NUMERIC).

export type VatReturnData = {
  period_year: number
  period_month: number
  period_status: string | null
  output_vat: number
  recoverable_input_vat: number
  non_recoverable_vat: number
  pending_review_vat: number
  pending_review_rows: number
  adjustments_output: number
  adjustments_input: number
  net_position: number
}

/** Read the VAT return summary for one period (newest data from the view). */
export async function getVatReturn(
  input: { period_year: number; period_month: number }
): Promise<{ success: boolean; data?: VatReturnData; error?: string }> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const caller = await createClient()
    const { data, error } = await caller.rpc("read_my_financial_report", { p_kind: "vat_return", p_year: input.period_year, p_month: input.period_month })
    if (error) return { success: false, error: "VAT return could not be loaded. Please retry." }
    if (!data) return { success: false, error: mapFinancialError("VAT006: no VAT return data for this period") }

    const row = data as unknown as ReconRow
    return {
      success: true,
      data: {
        period_year: row.period_year,
        period_month: row.period_month,
        period_status: row.period_status,
        output_vat: decimalRound(row.output_vat),
        recoverable_input_vat: decimalRound(row.recoverable_input_vat),
        non_recoverable_vat: decimalRound(row.non_recoverable_vat),
        pending_review_vat: decimalRound(row.pending_review_vat),
        pending_review_rows: Number(row.pending_review_rows),
        adjustments_output: decimalRound(row.adjustments_output),
        adjustments_input: decimalRound(row.adjustments_input),
        net_position: decimalRound(row.net_position),
      },
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/** Build the per-period VAT return table for CSV export. */
export async function exportVatReturnCsv(
  input: { period_year: number; period_month: number }
): Promise<{ success: boolean; csv?: string; error?: string }> {
  try {
    await requirePermission("accounting", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const result = await getVatReturn(input)
    if (!result.success || !result.data) return { success: false, error: result.error }
    const row = result.data

    const nature = netNature(decimalRound(row.net_position))
    const csv = "\uFEFF" + toCsv(
      ["period", "status", "output_vat", "recoverable_input_vat", "non_recoverable_vat", "pending_review_vat", "pending_review_rows", "adjustments_output", "adjustments_input", "net_position", "net_nature"],
      [[
        `${row.period_year}-${String(row.period_month).padStart(2, "0")}`,
        row.period_status ?? "",
        row.output_vat,
        row.recoverable_input_vat,
        row.non_recoverable_vat,
        row.pending_review_vat,
        row.pending_review_rows,
        row.adjustments_output,
        row.adjustments_input,
        row.net_position,
        nature,
      ]]
    )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "vat_return_exported",
      entityType: "vat_reconciliation",
      newValues: { period_year: input.period_year, period_month: input.period_month },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Printable bilingual A4 VAT return for a single period. Returns the full
 * HTML for a window.print() flow, and records the document in
 * `generated_documents` (doc_number VAT-RET-{period}, verify_url →
 * /verify-document/...) so it can be re-opened and verified. No submission
 * API — document only.
 */
export async function generateVatReturnReport(
  input: { period_year: number; period_month: number }
): Promise<{ success: boolean; html?: string; docNumber?: string; verifyUrl?: string; error?: string }> {
  try {
    await requirePermission("accounting", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const caller = await createClient()
    const { data: document, error } = await caller.rpc("create_my_vat_return_document", { p_year: input.period_year, p_month: input.period_month })
    if (error || !document?.data || !document?.company || !document?.doc_number || !document?.verify_url) {
      return { success: false, error: "VAT return report could not be created. Please retry." }
    }
    const row = document.data as ReconRow
    const tenant = document.company as { name_ar: string; name_en: string; vat_number: string | null }
    const net = decimalRound(row.net_position)
    const nature = netNature(net)
    const period = `${row.period_year}-${String(row.period_month).padStart(2, "0")}`

    const rows: VatReturnFieldRow[] = [
      {
        labelAr: "ضريبة المخرجات (المبيعات)",
        labelEn: "Output VAT (sales)",
        value: decimalRound(row.output_vat),
      },
      {
        labelAr: "ضريبة المدخلات القابلة للاسترداد (المشتريات)",
        labelEn: "Recoverable input VAT (purchases)",
        value: decimalRound(row.recoverable_input_vat),
        negative: true,
      },
      {
        labelAr: "ضريبة المدخلات غير القابلة للاسترداد (مصروف)",
        labelEn: "Non-recoverable input VAT (expensed)",
        value: decimalRound(row.non_recoverable_vat),
        noteAr: "تُصرف ولا تدخل في صافي المركز",
        noteEn: "Expensed; excluded from the net position",
      },
      {
        labelAr: "قيد المراجعة (تنتظر التصنيف)",
        labelEn: "Pending review (awaiting classification)",
        value: decimalRound(row.pending_review_vat),
        noteAr: `${row.pending_review_rows} عنصر مستبعد من صافي المركز`, 
        noteEn: `${row.pending_review_rows} row(s) excluded from the net position`,
      },
      {
        labelAr: "تسويات المخرجات",
        labelEn: "Output adjustments",
        value: decimalRound(row.adjustments_output),
      },
      {
        labelAr: "تسويات المدخلات",
        labelEn: "Input adjustments",
        value: decimalRound(row.adjustments_input),
        negative: true,
      },
      {
        labelAr: nature === "payable" ? "صافي الضريبة المستحقة الدفع" : nature === "receivable" ? "صافي الضريبة المستحقة الاسترداد" : "صافي المركز الضريبي",
        labelEn: nature === "payable" ? "Net VAT payable" : nature === "receivable" ? "Net VAT receivable" : "Net VAT position",
        value: Math.abs(net),
        negative: nature === "payable",
        positive: nature === "receivable",
        bold: true,
      },
    ]

    const html = buildVatReturnHtml({
      companyNameAr: tenant?.name_ar || tenant?.name_en || "",
      companyNameEn: tenant?.name_en ?? "",
      companyVatNumber: tenant?.vat_number ?? "—",
      generatedAt: document.generated_at,
      period,
      periodStatus: row.period_status,
      rows,
    })

    return { success: true, html, docNumber: document.doc_number, verifyUrl: document.verify_url }

  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
