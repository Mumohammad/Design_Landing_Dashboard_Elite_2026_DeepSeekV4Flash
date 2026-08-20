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

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError, toCsv } from "@/lib/accounting/csv-utils"
import { netNature } from "@/lib/accounting/vat-math"
import { buildVatReconciliationHtml, type VatReportRow } from "@/lib/accounting/vat-report-html"
import { buildVatReturnHtml, type VatReturnFieldRow } from "@/lib/accounting/vat-return-html"

type ActionResult = { success: boolean; error?: string }

type ReconRow = {
  period_id: string | null
  period_year: number
  period_month: number
  period_status: string | null
  output_vat: number
  recoverable_input_vat: number
  non_recoverable_vat: number
  pending_review_vat: number
  adjustments_output: number
  adjustments_input: number
  pending_review_rows: number
  net_position: number
}

type VatReviewItem = {
  id: string
  invoice_ref: string
  invoice_date: string
  vat_base_amount: number
  vat_rate: number
  vat_amount: number
  supplier_id: string | null
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

/**
 * Read the per-period reconciliation rows for the current tenant
 * (newest month first). Used by the accounting VAT tab.
 */
export async function getVatReconciliation(): Promise<{ success: boolean; rows?: ReconRow[]; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("vat_reconciliation")
      .select("*")
      .eq("tenant_id", currentUser.tenantId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
    if (error) return { success: false, error: error.message }

    return { success: true, rows: (data ?? []) as unknown as ReconRow[] }
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
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()

    // Cursor-based pagination: fetch all pending_review rows in batches
    // to handle tenants with large volumes of unrecoverable VAT.
    const allRows: VatReviewItem[] = []
    let cursor: string | null = null
    const PAGE_SIZE = 200
    const MAX_ROWS = 5000

    while (allRows.length < MAX_ROWS) {
      let query = admin
        .from("vat_input_ledger")
        .select("id,invoice_ref,invoice_date,vat_base_amount,vat_rate,vat_amount,supplier_id")
        .eq("tenant_id", currentUser.tenantId)
        .eq("vat_recoverability", "pending_review")
        .order("invoice_date", { ascending: true })
        .order("id", { ascending: true })
        .limit(PAGE_SIZE + 1)

      if (cursor) query = query.gt("id", cursor)

      const { data, error } = await query
      if (error) return { success: false, error: error.message }
      if (!data || data.length === 0) break

      const hasMore = data.length > PAGE_SIZE
      const batch = hasMore ? data.slice(0, PAGE_SIZE) : data
      cursor = String(batch[batch.length - 1].id)
      allRows.push(...(batch as unknown as VatReviewItem[]))

      if (!hasMore) break
    }

    return { success: true, rows: allRows }
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

    const admin = createAdminClient()
    const { data: row, error: selErr } = await admin
      .from("vat_input_ledger")
      .select("id,invoice_ref,vat_recoverability,vat_amount")
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .maybeSingle<{ id: string; invoice_ref: string; vat_recoverability: string; vat_amount: number }>()
    if (selErr) return { success: false, error: selErr.message }
    if (!row) return { success: false, error: mapFinancialError("VAT005: no reconciliation data for this period") }
    if (row.vat_recoverability !== "pending_review") {
      return { success: false, error: mapFinancialError("VAT004: review item is not pending review; reclassification is locked") }
    }

    const { error: updErr } = await admin
      .from("vat_input_ledger")
      .update({ vat_recoverability: input.recoverability })
      .eq("id", input.id)
    if (updErr) return { success: false, error: updErr.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "vat_review_item_resolved",
      entityType: "vat_input_ledger",
      entityId: input.id,
      newValues: {
        invoice_ref: row.invoice_ref,
        vat_amount: Number(row.vat_amount),
        from: "pending_review",
        to: input.recoverability,
      },
    })

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

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("vat_reconciliation")
      .select("*")
      .eq("tenant_id", currentUser.tenantId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
    if (error) return { success: false, error: error.message }

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

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("vat_reconciliation")
      .select("*")
      .eq("tenant_id", currentUser.tenantId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
    if (error) return { success: false, error: error.message }

    const { data: tenant } = await admin
      .from("tenants")
      .select("name_ar,name_en,vat_number")
      .eq("id", currentUser.tenantId)
      .maybeSingle<{ name_ar: string | null; name_en: string | null; vat_number: string | null }>()

    const rows = (data ?? []) as unknown as ReconRow[]
    if (rows.length === 0) {
      return { success: false, error: mapFinancialError("VAT005: no reconciliation data for this period") }
    }

    const reportRows: VatReportRow[] = rows.map((r) => ({
      period: `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
      status: r.period_status ?? "—",
      outputVat: Number(r.output_vat),
      recoverableInput: Number(r.recoverable_input_vat),
      nonRecoverable: Number(r.non_recoverable_vat),
      pendingReview: Number(r.pending_review_vat),
      adjustmentsOutput: Number(r.adjustments_output),
      adjustmentsInput: Number(r.adjustments_input),
      netPosition: Number(r.net_position),
      pendingReviewRows: Number(r.pending_review_rows),
    }))

    const html = buildVatReconciliationHtml({
      companyNameAr: tenant?.name_ar ?? "نخبة التطوير",
      companyNameEn: tenant?.name_en ?? "Elite Development",
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
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("vat_reconciliation")
      .select("*")
      .eq("tenant_id", currentUser.tenantId)
      .eq("period_year", input.period_year)
      .eq("period_month", input.period_month)
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: mapFinancialError("VAT006: no VAT return data for this period") }

    const row = data as unknown as ReconRow
    return {
      success: true,
      data: {
        period_year: row.period_year,
        period_month: row.period_month,
        period_status: row.period_status,
        output_vat: Number(row.output_vat),
        recoverable_input_vat: Number(row.recoverable_input_vat),
        non_recoverable_vat: Number(row.non_recoverable_vat),
        pending_review_vat: Number(row.pending_review_vat),
        pending_review_rows: Number(row.pending_review_rows),
        adjustments_output: Number(row.adjustments_output),
        adjustments_input: Number(row.adjustments_input),
        net_position: Number(row.net_position),
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

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("vat_reconciliation")
      .select("*")
      .eq("tenant_id", currentUser.tenantId)
      .eq("period_year", input.period_year)
      .eq("period_month", input.period_month)
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: mapFinancialError("VAT006: no VAT return data for this period") }

    const row = data as unknown as ReconRow
    const nature = netNature(Number(row.net_position))
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

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("vat_reconciliation")
      .select("*")
      .eq("tenant_id", currentUser.tenantId)
      .eq("period_year", input.period_year)
      .eq("period_month", input.period_month)
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: mapFinancialError("VAT006: no VAT return data for this period") }

    const row = data as unknown as ReconRow
    const { data: tenant } = await admin
      .from("tenants")
      .select("name_ar,name_en,vat_number")
      .eq("id", currentUser.tenantId)
      .maybeSingle<{ name_ar: string | null; name_en: string | null; vat_number: string | null }>()

    const net = Number(row.net_position)
    const nature = netNature(net)
    const period = `${row.period_year}-${String(row.period_month).padStart(2, "0")}`

    const rows: VatReturnFieldRow[] = [
      {
        labelAr: "ضريبة المخرجات (المبيعات)",
        labelEn: "Output VAT (sales)",
        value: Number(row.output_vat),
      },
      {
        labelAr: "ضريبة المدخلات القابلة للاسترداد (المشتريات)",
        labelEn: "Recoverable input VAT (purchases)",
        value: Number(row.recoverable_input_vat),
        negative: true,
      },
      {
        labelAr: "ضريبة المدخلات غير القابلة للاسترداد (مصروف)",
        labelEn: "Non-recoverable input VAT (expensed)",
        value: Number(row.non_recoverable_vat),
        noteAr: "تُصرف ولا تدخل في صافي المركز",
        noteEn: "Expensed; excluded from the net position",
      },
      {
        labelAr: "قيد المراجعة (تنتظر التصنيف)",
        labelEn: "Pending review (awaiting classification)",
        value: Number(row.pending_review_vat),
        noteAr: `${row.pending_review_rows} عنصر مستبعد من صافي المركز`, 
        noteEn: `${row.pending_review_rows} row(s) excluded from the net position`,
      },
      {
        labelAr: "تسويات المخرجات",
        labelEn: "Output adjustments",
        value: Number(row.adjustments_output),
      },
      {
        labelAr: "تسويات المدخلات",
        labelEn: "Input adjustments",
        value: Number(row.adjustments_input),
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
      companyNameAr: tenant?.name_ar ?? "نخبة التطوير",
      companyNameEn: tenant?.name_en ?? "Elite Development",
      companyVatNumber: tenant?.vat_number ?? "—",
      generatedAt: new Date().toISOString(),
      period,
      periodStatus: row.period_status,
      rows,
    })

    // Record in generated_documents so the return is re-openable + verifiable.
    const docNumber = `VAT-RET-${period}`
    const verifyUrl = `/verify-document/${docNumber}`
    const generatedData = {
      kind: "vat_return",
      period_year: row.period_year,
      period_month: row.period_month,
      period_status: row.period_status,
      output_vat: Number(row.output_vat),
      recoverable_input_vat: Number(row.recoverable_input_vat),
      non_recoverable_vat: Number(row.non_recoverable_vat),
      pending_review_vat: Number(row.pending_review_vat),
      adjustments_output: Number(row.adjustments_output),
      adjustments_input: Number(row.adjustments_input),
      net_position: Number(row.net_position),
      net_nature: nature,
      company: {
        name_ar: tenant?.name_ar ?? null,
        name_en: tenant?.name_en ?? null,
        vat_number: tenant?.vat_number ?? null,
      },
    }

    const { data: existing } = await admin
      .from("generated_documents")
      .select("id,deleted_at")
      .eq("doc_number", docNumber)
      .maybeSingle<{ id: string; deleted_at: string | null }>()
    if (existing?.deleted_at) {
      await admin
        .from("generated_documents")
        .update({ deleted_at: null, updated_by: currentUser.authUserId })
        .eq("id", existing.id)
    }

    let docId: string
    if (existing) {
      const { data: updated, error: updErr } = await admin
        .from("generated_documents")
        .update({
          generated_data: generatedData,
          verify_url: verifyUrl,
          status: "generated",
          printed_at: new Date().toISOString(),
          updated_by: currentUser.authUserId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id")
        .single()
      if (updErr) return { success: false, error: updErr.message }
      docId = updated.id
    } else {
      const { data: created, error: insErr } = await admin
        .from("generated_documents")
        .insert({
          tenant_id: currentUser.tenantId,
          doc_number: docNumber,
          template_id: null,
          invoice_id: null,
          generated_data: generatedData,
          file_url: null,
          qr_code_url: null,
          verify_url: verifyUrl,
          status: "generated",
          generated_by: currentUser.authUserId,
          generated_at: new Date().toISOString(),
          created_by: currentUser.authUserId,
        })
        .select("id")
        .single()
      if (insErr) return { success: false, error: insErr.message }
      docId = created.id
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "vat_return_report_generated",
      entityType: "generated_documents",
      entityId: docId,
      newValues: { period_year: input.period_year, period_month: input.period_month, doc_number: docNumber },
    })

    return { success: true, html, docNumber, verifyUrl }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
