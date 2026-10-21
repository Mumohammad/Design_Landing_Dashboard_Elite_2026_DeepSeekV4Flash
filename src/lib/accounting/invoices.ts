"use server"

// Accounting Module — Phase 5: Invoice Engine.
//
// Lifecycle: draft → issued → finalized (immutable) → paid / partially_paid /
// overdue / credited (full credit note issued); unposted documents may be cancelled.
//
// Actions:
// - createInvoiceDraft      invoices:create  → header + lines, totals computed
// - updateInvoiceDraft      invoices:update  → edit draft (lines replaced)
// - issueInvoice            invoices:update  → draft → issued
// - finalizeInvoice         invoices:approve → issued → finalized + event
// - cancelInvoice           invoices:update  → unposted only → atomic cancellation/audit
// - issueCreditNote         invoices:create  → reversal vs finalized invoice
// - issueDebitNote          invoices:create  → additional charge note
// - exportInvoicesCsv       invoices:export  → BOM CSV of the invoice list
//
// Canonical math (migration 038, single source of truth):
//   line_amount = round2(quantity × unit_price) − discount   (line net)
//   line_vat    = round2(line_amount × vat_rate / 100)      (per line)
//   subtotal    = Σ line_amount   ·   vat_amount = Σ line_vat
//   total       = round2(subtotal + vat_amount)
// All money passes through 2dp integer-minor arithmetic — no float drift.
//
// Events (EVENT-MODEL.md): finalized/cancelled/credit/debit flows insert rows
// into `financial_events` with stable idempotency keys so the Accounting/VAT
// engines (Phase 9) can consume them exactly once.

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError, toCsv } from "@/lib/accounting/csv-utils"
import { computeInvoiceTotals, type InvoiceLineInput } from "@/lib/accounting/invoice-math"
import { runEventDispatcher } from "@/lib/accounting/dispatcher"
import { runZatcaAdapter } from "@/lib/accounting/zatca"
import { rateLimitAccounting } from "@/lib/auth/rate-limit"
import { getErrorDefinition } from "@/lib/errors/error-codes"

export type { InvoiceLineInput } from "@/lib/accounting/invoice-math"

type ActionResult = { success: boolean; error?: string }

export type InvoiceType = "sales" | "purchase"

export type InvoiceDraftInput = {
  invoice_type: InvoiceType
  customer_id?: string | null
  supplier_id?: string | null
  issue_date: string
  due_date: string
  currency?: string
  /** Default VAT % applied to lines that don't set their own. */
  vat_rate?: number
  notes?: string | null
  lines: InvoiceLineInput[]
}

// ── Decimal-safe helpers (2dp integer-minor arithmetic) ───────────────────

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

// Draft writes use the caller's authenticated session. The database validates
// tenant, permission, version, party and money, then commits header/lines/audit
// together. A failed edit leaves the previous draft intact.
async function saveDraft(input: InvoiceDraftInput, id?: string, expectedUpdatedAt?: string)
  : Promise<ActionResult & { id?: string }> {
  try {
    await requirePermission("invoices", id ? "update" : "create")
    if ((input.currency ?? "SAR") !== "SAR") return { success: false, error: "Accounting supports SAR only; existing foreign-currency invoices require review." }
    computeInvoiceTotals(input.lines, input.vat_rate ?? 15)
    const client = await createClient()
    const { data, error } = await client.rpc("save_invoice_draft", {
      p_input: input,
      p_invoice_id: id ?? null,
      p_expected_updated_at: expectedUpdatedAt ?? null,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: mapFinancialError(errorMessage(e)) }
  }
}

export async function createInvoiceDraft(input: InvoiceDraftInput): Promise<ActionResult & { id?: string }> {
  return saveDraft(input)
}

export async function updateInvoiceDraft(
  input: InvoiceDraftInput & { id: string; expected_updated_at: string }
): Promise<ActionResult> {
  const { id, expected_updated_at, ...draft } = input
  return saveDraft(draft, id, expected_updated_at)
}

export async function deleteInvoiceDraft(input: { id: string; expected_updated_at: string }): Promise<ActionResult> {
  try {
    await requirePermission("invoices", "delete")
    const client = await createClient()
    const { error } = await client.rpc("delete_invoice_draft", {
      p_invoice_id: input.id,
      p_expected_updated_at: input.expected_updated_at,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    revalidatePath("/invoices")
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: mapFinancialError(errorMessage(e)) }
  }
}

// Issuance/approval use caller-bound transactions; a receipt makes retries of
// the same reviewed version safe without adopting older partial effects.
export type InvoiceTransitionInput = { id: string; expected_updated_at: string }
type TransitionResult = ActionResult & { errorAr?: string; postingPending?: boolean; replayed?: boolean }

async function transitionInvoice(operation: "issue" | "finalize", input: InvoiceTransitionInput): Promise<TransitionResult> {
  const uncertain = {
    success: false,
    error: "Unable to confirm the invoice decision. Reload and review its status before retrying.",
    errorAr: "تعذر تأكيد إجراء الفاتورة. أعد تحميلها وراجع حالتها قبل المحاولة مجدداً.",
  }
  try {
    await requirePermission("invoices", operation === "issue" ? "update" : "approve")
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated.", errorAr: "يلزم تسجيل الدخول." }
    const limit = await rateLimitAccounting(user.id)
    if (!limit.success) return { success: false, error: "Too many requests. Try again shortly.", errorAr: "طلبات كثيرة. حاول مجدداً بعد قليل." }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(input.id ?? "") || typeof input.expected_updated_at !== "string"
      || !input.expected_updated_at || !Number.isFinite(Date.parse(input.expected_updated_at))) return {
      success: false, error: "Reload the invoice before confirming this action.", errorAr: "أعد تحميل الفاتورة قبل تأكيد الإجراء.",
    }
    const client = await createClient()
    const { data, error } = await client.rpc("transition_my_invoice", {
      p_invoice_id: input.id, p_operation: operation, p_expected_updated_at: input.expected_updated_at,
    })
    if (error) {
      // Only public taxonomy messages may leave this boundary; SQL/provider
      // diagnostics can contain private invoice, account or infrastructure data.
      const code = /^(INV00[1-6]|INV01[235]|AUTH007):/.exec(error.message)?.[1]
      if (code) {
        const def = getErrorDefinition(code)
        return { success: false, error: def.messageEn, errorAr: def.messageAr }
      }
      return uncertain
    }
    if (!data || data.id !== input.id || data.operation !== operation
      || !["sales", "purchase"].includes(data.invoice_type) || typeof data.replayed !== "boolean"
      || (operation === "finalize" ? !uuid.test(data.event_id ?? "") : data.event_id !== null)) return uncertain

    // The decision is committed. A later dispatcher, adapter or cache failure
    // cannot turn it into a failed approval or provoke a duplicate payable.
    let postingPending = operation === "finalize"
    if (operation === "finalize") {
      try {
        await runEventDispatcher()
        const posting = await createAdminClient().from("financial_events").select("processing_status")
          .eq("tenant_id", user.tenantId).eq("event_id", data.event_id)
          .eq("source_type", data.invoice_type === "purchase" ? "purchase_invoice" : "invoice")
          .eq("source_id", input.id).maybeSingle()
        postingPending = !!posting.error || !["processed", "skipped_duplicate"].includes(posting.data?.processing_status ?? "")
      } catch { /* Preserve the committed result and disclose pending posting. */ }
      if (data.invoice_type === "sales") {
        try { await runZatcaAdapter() } catch { /* Separate, production-gated transmission workflow. */ }
      }
    }
    try { revalidatePath("/invoices"); revalidatePath("/accounting") } catch { /* Refresh reads the committed state. */ }
    return { success: true, replayed: data.replayed, ...(operation === "finalize" ? { postingPending } : {}) }
  } catch { return uncertain }
}

export async function issueInvoice(input: InvoiceTransitionInput): Promise<TransitionResult> {
  return transitionInvoice("issue", input)
}

export async function finalizeInvoice(input: InvoiceTransitionInput): Promise<TransitionResult> {
  return transitionInvoice("finalize", input)
}

// Only unposted documents may be cancelled directly. Posted sales corrections
// use the full-credit transaction; purchase reversals need their own workflow.
export async function cancelInvoice(input: InvoiceTransitionInput & { reason: string }): Promise<TransitionResult> {
  const uncertain: TransitionResult = { success: false,
    error: "Unable to confirm cancellation. Reload the invoice and review its status before retrying.",
    errorAr: "تعذر تأكيد الإلغاء. أعد تحميل الفاتورة وراجع حالتها قبل المحاولة مجدداً.",
  }
  try {
    await requirePermission("invoices", "update")
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated.", errorAr: "يلزم تسجيل الدخول." }
    const limit = await rateLimitAccounting(user.id)
    if (!limit.success) return { success: false, error: "Too many requests. Try again shortly.", errorAr: "طلبات كثيرة. حاول مجدداً بعد قليل." }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(input.id ?? "") || typeof input.expected_updated_at !== "string" || !input.expected_updated_at
      || !Number.isFinite(Date.parse(input.expected_updated_at)) || typeof input.reason !== "string"
      || input.reason.trim().length < 5 || input.reason.trim().length > 500) return { success: false,
        error: "Reload the invoice and enter a cancellation reason of 5 to 500 characters.",
        errorAr: "أعد تحميل الفاتورة وأدخل سبب إلغاء من 5 إلى 500 حرف.",
      }
    const client = await createClient()
    const { data, error } = await client.rpc("cancel_unposted_invoice_atomic", {
      p_invoice_id: input.id, p_expected_updated_at: input.expected_updated_at, p_reason: input.reason.trim(),
    })
    if (error) {
      const code = error.message?.split(":", 1)[0]
      if (code === "INV_CANCEL_POSTED") return { success: false,
        error: "Finalized invoices require a credit note or a reviewed purchase reversal. Direct cancellation is unavailable.",
        errorAr: "الفاتورة المعتمدة تتطلب إشعاراً دائناً أو إجراء عكس مشتريات مراجعاً. الإلغاء المباشر غير متاح.",
      }
      if (code === "INV_CANCEL_REVIEW") return { success: false,
        error: "Existing accounting evidence requires review before this invoice can be cancelled.",
        errorAr: "تحتاج البيانات المحاسبية الموجودة إلى مراجعة قبل إلغاء الفاتورة.",
      }
      if (/^(INV001|INV002|INV006|INV015|AUTH007)$/.test(code)) {
        const def = getErrorDefinition(code)
        return { success: false, error: def.messageEn, errorAr: def.messageAr }
      }
      return uncertain
    }
    if (!data || data.id !== input.id || data.operation !== "cancel" || typeof data.replayed !== "boolean") return uncertain
    try { revalidatePath("/invoices"); revalidatePath("/accounting") } catch { /* The cancellation and audit are committed. */ }
    return { success: true, replayed: data.replayed }
  } catch { return uncertain }
}

// Notes use an explicit request identity and Saudi issue date. The database
// posts the note, ledger effects, event, audit and receipt in one transaction.
export type CreditNoteInput = {
  request_id: string
  reference_invoice_id: string
  expected_updated_at: string
  reason: string
  issue_date: string
  lines?: InvoiceLineInput[]
}
export type DebitNoteInput = Omit<CreditNoteInput, "lines"> & {
  amount: number
  vat_rate?: number
  description?: string
}
type NoteResult = TransitionResult & { id?: string }

async function createInvoiceNote(kind: "credit" | "debit", input: CreditNoteInput | DebitNoteInput): Promise<NoteResult> {
  const uncertain: NoteResult = {
    success: false,
    error: "Unable to confirm the note. Review the invoice and notes before retrying the same request.",
    errorAr: "تعذر تأكيد الإشعار. راجع الفاتورة والإشعارات قبل إعادة الطلب نفسه.",
  }
  const invalid: NoteResult = {
    success: false, error: "Enter a valid note date, a reason of 5 to 500 characters, and exact monetary values.",
    errorAr: "أدخل تاريخ إشعار صحيحاً وسبباً من 5 إلى 500 حرف وقيماً مالية دقيقة.",
  }
  try {
    await requirePermission("invoices", "create")
    await requirePermission("invoices", "approve")
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated.", errorAr: "يلزم تسجيل الدخول." }
    const limit = await rateLimitAccounting(user.id)
    if (!limit.success) return { success: false, error: "Too many requests. Try again shortly.", errorAr: "طلبات كثيرة. حاول مجدداً بعد قليل." }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(input.request_id ?? "") || !uuid.test(input.reference_invoice_id ?? "")
      || typeof input.expected_updated_at !== "string" || !input.expected_updated_at
      || !Number.isFinite(Date.parse(input.expected_updated_at))) return invalid
    if (typeof input.reason !== "string" || input.reason.trim().length < 5 || input.reason.trim().length > 500
      || typeof input.issue_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.issue_date)) return invalid
    const issueDate = new Date(input.issue_date)
    if (!Number.isFinite(issueDate.getTime()) || input.issue_date < "0001-01-01"
      || issueDate.toISOString().slice(0, 10) !== input.issue_date) return invalid
    if (kind === "credit" && "lines" in input && input.lines !== undefined) return {
      success: false, error: "This action supports a full invoice credit. Partial credits require a separate reviewed allocation.",
      errorAr: "هذا الإجراء يدعم الإشعار الدائن لكامل الفاتورة. الإشعارات الجزئية تحتاج توزيعاً مستقلاً ومراجعاً.",
    }
    const payload: Record<string, unknown> = { reason: input.reason.trim(), issue_date: input.issue_date }
    if (kind === "debit") {
      const debit = input as DebitNoteInput
      const rate = debit.vat_rate === undefined ? 15 : debit.vat_rate
      if (typeof debit.amount !== "number" || debit.amount <= 0 || debit.amount > 99_999_999.99
        || typeof rate !== "number" || (debit.description !== undefined && typeof debit.description !== "string")) return invalid
      const description = debit.description?.trim() || payload.reason as string
      try {
        computeInvoiceTotals([{ description, quantity: 1, unit_price: debit.amount, vat_rate: rate }], rate)
      } catch { return invalid }
      payload.amount = debit.amount; payload.vat_rate = rate; payload.description = description
    }
    const client = await createClient()
    const { data, error } = await client.rpc("create_invoice_note_atomic", {
      p_request_id: input.request_id, p_invoice_id: input.reference_invoice_id,
      p_expected_updated_at: input.expected_updated_at, p_kind: kind, p_input: payload,
    })
    if (error) {
      const code = error.message?.split(":", 1)[0]
      const safe: Record<string, [string, string]> = {
        INV_NOTE_INPUT: [invalid.error!, invalid.errorAr!],
        INV_NOTE_REFERENCE: ["Notes require a finalized SAR sales invoice. Purchase notes and paid-invoice refunds require separate workflows.", "الإشعارات تتطلب فاتورة مبيعات معتمدة بالريال. إشعارات المشتريات واستردادات الفواتير المدفوعة لها إجراءات مستقلة."],
        INV_NOTE_POSTING: ["Post the original invoice successfully before issuing a note. Review Accounting events.", "أكمل ترحيل الفاتورة الأصلية بنجاح قبل إصدار الإشعار. راجع أحداث المحاسبة."],
        INV_NOTE_RESERVED: ["A payment reserves this invoice balance. Resolve the payment before issuing a note.", "يوجد حجز دفع على رصيد الفاتورة. عالج الدفعة قبل إصدار الإشعار."],
        INV_NOTE_RETRY: ["This request already identifies another note decision. Review existing notes before starting a new request.", "هذا الطلب مرتبط بإجراء إشعار مختلف. راجع الإشعارات الموجودة قبل بدء طلب جديد."],
        INV_NOTE_REVIEW: ["The invoice or note accounting evidence requires review. No new note was confirmed.", "تحتاج بيانات محاسبة الفاتورة أو الإشعار إلى مراجعة. لم يتم تأكيد إشعار جديد."],
      }
      if (safe[code]) return { success: false, error: safe[code][0], errorAr: safe[code][1] }
      if (/^(INV00[1-9]|INV01[0-5]|AUTH007|ACC001|VAT001)$/.test(code)) {
        const def = getErrorDefinition(code)
        return { success: false, error: def.messageEn, errorAr: def.messageAr }
      }
      return uncertain
    }
    if (!data || !uuid.test(data.id ?? "") || !uuid.test(data.event_id ?? "") || data.kind !== kind
      || data.reference_invoice_id !== input.reference_invoice_id || typeof data.replayed !== "boolean"
      || data.posting_status !== "posted") return uncertain
    try { await runZatcaAdapter() } catch { /* Separate gated transmission; no claim of authority acceptance. */ }
    try { revalidatePath("/invoices"); revalidatePath("/accounting") } catch { /* Confirmed note remains committed. */ }
    return { success: true, id: data.id, replayed: data.replayed, postingPending: false }
  } catch { return uncertain }
}

export async function issueCreditNote(input: CreditNoteInput): Promise<NoteResult> {
  return createInvoiceNote("credit", input)
}

export async function issueDebitNote(input: DebitNoteInput): Promise<NoteResult> {
  return createInvoiceNote("debit", input)
}

// ── CSV export (BOM-prefixed so Excel renders Arabic) ─────────────────────

export async function exportInvoicesCsv(): Promise<{ success: boolean; csv?: string; error?: string }> {
  try {
    await requirePermission("invoices", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()

    // Cursor-based pagination: fetch in batches of 500 using id > cursor
    // to avoid OFFSET degradation on large datasets.
    const allRows: (string | number | boolean | null)[][] = []
    let cursor: string | null = null
    const PAGE_SIZE = 500
    const MAX_ROWS = 10_000 // Safety cap for CSV export

    type InvoiceRow = {
      id: string
      invoice_number: string
      invoice_type: string
      issue_date: string
      due_date: string
      status: string
      subtotal: number
      discount: number
      vat_amount: number
      total: number
      currency: string
      customers?: { name_ar: string | null } | null
      suppliers?: { name_ar: string | null } | null
    }

    while (allRows.length < MAX_ROWS) {
      let query = admin
        .from("invoices")
        .select("id,invoice_number,invoice_type,issue_date,due_date,status,subtotal,discount,vat_amount,total,currency,customers(name_ar),suppliers(name_ar)")
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .order("issue_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE + 1)

      if (cursor) {
        query = query.lt("id", cursor)
      }

      const { data, error } = await query
      if (error) return { success: false, error: error.message }
      if (!data || data.length === 0) break

      const hasMore = data.length > PAGE_SIZE
      const batch = hasMore ? data.slice(0, PAGE_SIZE) : data
      cursor = String(batch[batch.length - 1].id)

      for (const r of batch) {
        const row = r as unknown as InvoiceRow
        allRows.push([
          row.invoice_number,
          row.invoice_type,
          row.issue_date,
          row.due_date,
          row.status,
          row.subtotal,
          row.discount,
          row.vat_amount,
          row.total,
          row.currency,
          row.customers?.name_ar ?? row.suppliers?.name_ar ?? "",
        ])
      }

      if (!hasMore) break
    }

    const csv = "\uFEFF" + toCsv(
      ["invoice_number", "invoice_type", "issue_date", "due_date", "status", "subtotal", "discount", "vat_amount", "total", "currency", "party"],
      allRows
    )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "invoices",
      action: "invoices_list_exported",
      entityType: "invoices",
      newValues: { rows: allRows.length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Paginated invoice list ───────────────────────────────────────────────────

export type InvoiceListResult = {
  success: boolean
  error?: string
  data?: InvoiceRow[]
  nextCursor?: string | null
  totalEstimate?: number
  hasMore?: boolean
}

type InvoiceRow = {
  id: string
  invoice_number: string
  invoice_type: string
  issue_date: string
  due_date: string
  status: string
  subtotal: number
  discount: number
  vat_amount: number
  total: number
  currency: string
  customer_name: string | null
  supplier_name: string | null
}

/**
 * Paginated invoice list using cursor-based pagination.
 * Pass `cursor` from the previous page's `nextCursor` for the next page.
 * First page: omit cursor.
 */
export async function listInvoices(input: {
  cursor?: string | null
  pageSize?: number
}): Promise<InvoiceListResult> {
  try {
    await requirePermission("invoices", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const pageSize = Math.min(Math.max(1, input.pageSize ?? 25), 100)
    const admin = createAdminClient()

    let query = admin
      .from("invoices")
      .select("id,invoice_number,invoice_type,issue_date,due_date,status,subtotal,discount,vat_amount,total,currency,customers(name_ar),suppliers(name_ar)")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize + 1)

    if (input.cursor) {
      query = query.lt("id", input.cursor)
    }

    const { data, error } = await query
    if (error) return { success: false, error: error.message }
    if (!data) return { success: true, data: [], nextCursor: null, totalEstimate: 0, hasMore: false }

    const hasMore = data.length > pageSize
    const rows = (hasMore ? data.slice(0, pageSize) : data).map((r) => {
      const row = r as unknown as {
        id: string; invoice_number: string; invoice_type: string
        issue_date: string; due_date: string; status: string
        subtotal: number; discount: number; vat_amount: number; total: number
        currency: string
        customers?: { name_ar: string | null } | null
        suppliers?: { name_ar: string | null } | null
      }
      return {
        id: row.id,
        invoice_number: row.invoice_number,
        invoice_type: row.invoice_type,
        issue_date: row.issue_date,
        due_date: row.due_date,
        status: row.status,
        subtotal: Number(row.subtotal),
        discount: Number(row.discount),
        vat_amount: Number(row.vat_amount),
        total: Number(row.total),
        currency: row.currency,
        customer_name: row.customers?.name_ar ?? null,
        supplier_name: row.suppliers?.name_ar ?? null,
      }
    })

    const nextCursor = hasMore ? String(rows[rows.length - 1].id) : null

    // Approximate total count (cached from the count query)
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)

    return {
      success: true,
      data: rows,
      nextCursor,
      totalEstimate: count ?? rows.length,
      hasMore,
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
