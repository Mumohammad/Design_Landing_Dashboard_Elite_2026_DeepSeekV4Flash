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

import { createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError, toCsv } from "@/lib/accounting/csv-utils"
import { computeInvoiceTotals, type InvoiceLineInput } from "@/lib/accounting/invoice-math"
import { runEventDispatcher } from "@/lib/accounting/dispatcher"
import { recordPayment } from "@/lib/accounting/payments"
import { runZatcaForTenant } from "@/lib/accounting/zatca-adapter-core"
import { rateLimitAccounting } from "@/lib/auth/rate-limit"
import { getErrorDefinition } from "@/lib/errors/error-codes"
import {isMasterId,isMasterTimestamp} from "./master-contract"
import {readInvoicePage,InvoiceReadError} from "./invoice-pages"

export type { InvoiceLineInput } from "@/lib/accounting/invoice-math"

type ActionResult = { success: boolean; error?: string; errorAr?: string; replayed?:boolean }

export type InvoiceType = "sales" | "purchase"

export type InvoiceDraftInput = {
  /** Stable intent for application retries; not a document identifier. */
  request_id?: string
  invoice_type: InvoiceType
  customer_id?: string | null
  supplier_id?: string | null
  issue_date: string
  due_date: string
  /** Presentation only; the financial due date is always required. */
  show_due_date?: boolean
  currency?: string
  /** Default VAT % applied to lines that don't set their own. */
  vat_rate?: number
  notes?: string | null
  /** Bank account printed in the invoice's bank-details box (presentation only). */
  bank_account_id?: string | null
  /** "Already paid" intent. Money moves only when the user confirms after approval. */
  already_paid?: boolean
  already_paid_method?: AlreadyPaidMethod | null
  lines: InvoiceLineInput[]
}

export type AlreadyPaidMethod = "cash" | "transfer" | "card" | "cheque"
const PAID_METHODS: readonly AlreadyPaidMethod[] = ["cash", "transfer", "card", "cheque"]

// ── Decimal-safe helpers (2dp integer-minor arithmetic) ───────────────────

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

// Draft writes use the caller's authenticated session. The database validates
// tenant, permission, version, party and money, then commits header/lines/audit
// together. A failed edit leaves the previous draft intact.
function draftFailure(raw:string):ActionResult {
  const definition=getErrorDefinition(raw.split(":")[0]?.trim())
  if(definition.code!=="ERR_INTERNAL")return {success:false,error:definition.messageEn,errorAr:definition.messageAr}
  return {success:false,error:"Unable to confirm the invoice save. Retry with unchanged details.",errorAr:"تعذر تأكيد حفظ الفاتورة. أعد المحاولة بالتفاصيل نفسها."}
}
async function saveDraft(input:InvoiceDraftInput,id?:string,expectedUpdatedAt?:string):Promise<ActionResult&{id?:string}>{
 try{
  await requirePermission("invoices",id?"update":"create")
  if(!input||!isMasterId(input.request_id)||(id!==undefined&&(!isMasterId(id)||!isMasterTimestamp(expectedUpdatedAt))))return draftFailure("INV002: invalid draft request")
  if((input.currency??"SAR")!=="SAR")return draftFailure("INV012: SAR accounting only")
  if(input.show_due_date!==undefined&&typeof input.show_due_date!=="boolean")return draftFailure("INV002: invalid due-date visibility")
  if(input.bank_account_id!=null&&!isMasterId(input.bank_account_id))return draftFailure("INV002: invalid bank account")
  if(input.already_paid!==undefined&&typeof input.already_paid!=="boolean")return draftFailure("INV002: invalid paid flag")
  if(input.already_paid&&(!input.already_paid_method||!PAID_METHODS.includes(input.already_paid_method)||(input.already_paid_method!=="cash"&&!input.bank_account_id)))return {success:false,error:"Choose how the invoice was paid and, unless cash, the bank account.",errorAr:"اختر طريقة الدفع والحساب البنكي (إلا إذا كان الدفع نقداً)."}
  const computed=computeInvoiceTotals(input.lines,input.vat_rate??15)
  const {request_id,...draft}=input,client=await createClient()
  draft.bank_account_id=input.bank_account_id||null
  draft.already_paid=!!input.already_paid
  draft.already_paid_method=input.already_paid?input.already_paid_method??null:null
  draft.lines=computed.lines.map(line=>({item_name:line.item_name??null,description:line.description,quantity:line.quantity,unit_price:line.unit_price,discount:line.discount,vat_rate:line.vat_rate}))
  const {data,error}=await client.rpc("save_my_invoice_draft",{p_input:draft,p_invoice_id:id??null,p_expected_updated_at:expectedUpdatedAt??null,p_request_id:request_id})
  if(error)return draftFailure(error.message)
  if(!data||!isMasterId(data.id)||!isMasterTimestamp(data.updated_at)||(id!==undefined&&data.id!==id)||typeof data.total!=="number"||!Number.isFinite(data.total)||data.total<0||data.total>9999999999.99||data.total!==computed.total||typeof data.replayed!=="boolean")return draftFailure("")
  // The receipt confirms commit; an ancillary refresh cannot undo that result.
  try{revalidatePath("/invoices");revalidatePath("/accounting")}catch{/* a fresh read is authoritative */}
  return {success:true,id:data.id,replayed:data.replayed}
 }catch(error){return draftFailure(errorMessage(error))}
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
/**
 * Optional auto-send (Daftra-style "send on save"): when the tenant enabled
 * automatic submission, newly issued documents are submitted right away on
 * behalf of the tenant's registered ZATCA operator (so the preparation time
 * is the issue time). With auto-send off (the default) documents stay local
 * Phase 1 e-invoices until someone sends them from the invoice list. Never
 * fails the committed invoice decision.
 */
async function submitToZatcaAfterIssue(tenantId: string): Promise<void> {
  try {
    await runZatcaForTenant(tenantId)
  } catch { /* Separate, gated transmission workflow; retried on schedule. */ }
}

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
        await submitToZatcaAfterIssue(user.tenantId)
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
      if (typeof debit.amount !== "number" || debit.amount <= 0 || debit.amount > 99_999_999.99 || !/^\d+(?:\.\d{1,2})?$/.test(String(debit.amount))
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
    await submitToZatcaAfterIssue(user.tenantId)
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

export async function exportInvoicesCsv(filters:{search?:string;status?:string;locale?:string}={}):Promise<{success:boolean;csv?:string;error?:string;errorAr?:string}>{
 try{
  await requirePermission("invoices","export")
  const currentUser=await getCurrentUser();if(!currentUser)return {success:false,error:"Not authenticated.",errorAr:"يرجى تسجيل الدخول."}
  if(!filters||typeof filters!=="object"||Array.isArray(filters)||(filters.locale!==undefined&&!["ar","en"].includes(filters.locale)))throw new InvoiceReadError()
  const page=await readInvoicePage(await createClient(),"invoices",{search:filters.search??"",status:filters.status??"all",pageSize:100,exporting:true})
  const csv="\uFEFF"+toCsv(["invoice_number","invoice_type","issue_date","due_date","status","subtotal","discount","vat_amount","total","currency","party"],page.rows.map(row=>[
   row.invoice_number,row.invoice_type,row.issue_date,row.due_date,row.status,row.subtotal,row.discount,row.vat_amount,row.total,row.currency,
   (filters.locale==="en"?(row.customer_name_en||row.customer_name||row.supplier_name_en||row.supplier_name):(row.customer_name||row.customer_name_en||row.supplier_name||row.supplier_name_en))??"",
  ]))
  if(Buffer.byteLength(csv,"utf8")>524288)throw new InvoiceReadError(true)
  await writeAuditLog({tenantId:currentUser.tenantId,actorId:currentUser.authUserId,module:"invoices",action:"invoices_list_exported",entityType:"invoices",newValues:{rows:page.total}})
  return {success:true,csv}
 }catch(error){
  if(error instanceof InvoiceReadError&&error.exportLimit)return {success:false,error:"The export is too large. Narrow the search and export again.",errorAr:"حجم التصدير كبير. ضيّق البحث ثم أعد التصدير."}
  return {success:false,error:"Unable to export complete invoice records. Retry.",errorAr:"تعذر تصدير جميع سجلات الفواتير. أعد المحاولة."}
 }
}

/** Stable payment intent per invoice: retries never record a second payment. */
function alreadyPaidRequestId(invoiceId: string): string {
  const h = createHash("sha256").update(`invoice-already-paid:${invoiceId}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

type AlreadyPaidInfo = { already_paid: boolean; method: AlreadyPaidMethod | null; open_amount: number | null }

/** Reads an approved invoice's "already paid" intent and its open balance. */
export async function getAlreadyPaidInfo(input: { id: string }): Promise<ActionResult & { info?: AlreadyPaidInfo }> {
  try {
    await requirePermission("invoices", "read")
    const user = await getCurrentUser()
    if (!user || !isMasterId(input?.id)) return { success: false, error: "Reload the invoice and try again.", errorAr: "أعد تحميل الفاتورة وحاول مجدداً." }
    const client = await createClient()
    const { data: inv, error } = await client.from("invoices").select("invoice_type,already_paid,already_paid_method")
      .eq("id", input.id).is("deleted_at", null).maybeSingle()
    if (error || !inv) return { success: false, error: "Invoice not found.", errorAr: "الفاتورة غير موجودة." }
    if (!inv.already_paid) return { success: true, info: { already_paid: false, method: null, open_amount: null } }
    const sales = inv.invoice_type === "sales"
    const { data: balance } = await createAdminClient().from(sales ? "receivables" : "payables").select("total_amount,paid_amount")
      .eq("tenant_id", user.tenantId).eq("source_entity_type", sales ? "invoice" : "purchase_invoice")
      .eq("source_entity_id", input.id).is("deleted_at", null).maybeSingle()
    const open = balance ? Math.round((Number(balance.total_amount) - Number(balance.paid_amount)) * 100) / 100 : null
    return { success: true, info: { already_paid: true, method: inv.already_paid_method as AlreadyPaidMethod, open_amount: open } }
  } catch (error) {
    return { success: false, error: errorMessage(error), errorAr: "تعذر قراءة حالة الدفع." }
  }
}

/**
 * User-confirmed settlement of an approved invoice saved as "already paid":
 * records one payment for the open balance with the saved method and bank
 * account through the payments engine (which checks accounting:create).
 */
export async function recordAlreadyPaidPayment(input: { id: string }): Promise<ActionResult & { postingStatus?: "posted" | "pending" }> {
  try {
    await requirePermission("invoices", "read")
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated.", errorAr: "يلزم تسجيل الدخول." }
    if (!isMasterId(input?.id)) return { success: false, error: "Reload the invoice and try again.", errorAr: "أعد تحميل الفاتورة وحاول مجدداً." }
    const client = await createClient()
    const { data: inv } = await client.from("invoices")
      .select("invoice_number,invoice_type,already_paid,already_paid_method,bank_account_id,customer_id,supplier_id,issue_date")
      .eq("id", input.id).is("deleted_at", null).maybeSingle()
    if (!inv?.already_paid || !inv.already_paid_method) return { success: false, error: "This invoice is not marked as already paid.", errorAr: "هذه الفاتورة غير محددة كمدفوعة بالفعل." }
    const sales = inv.invoice_type === "sales"
    const { data: balance } = await createAdminClient().from(sales ? "receivables" : "payables").select("id,total_amount,paid_amount")
      .eq("tenant_id", user.tenantId).eq("source_entity_type", sales ? "invoice" : "purchase_invoice")
      .eq("source_entity_id", input.id).is("deleted_at", null).maybeSingle()
    if (!balance) return { success: false, error: "Approve the invoice and wait for its accounting posting before recording the payment.", errorAr: "اعتمد الفاتورة وانتظر ترحيلها المحاسبي قبل تسجيل الدفعة." }
    const remaining = Math.round((Number(balance.total_amount) - Number(balance.paid_amount)) * 100) / 100
    if (!(remaining > 0)) return { success: true, postingStatus: "posted" }
    const result = await recordPayment({
      request_id: alreadyPaidRequestId(input.id), direction: sales ? "in" : "out", payment_date: inv.issue_date,
      amount: remaining, method: inv.already_paid_method as AlreadyPaidMethod, bank_account_id: inv.bank_account_id,
      customer_id: sales ? inv.customer_id : null, supplier_id: sales ? null : inv.supplier_id,
      reference: inv.invoice_number,
      allocations: [sales ? { receivable_id: balance.id, amount: remaining } : { payable_id: balance.id, amount: remaining }],
    })
    if (!result.success) return { success: false, error: result.error ?? "Unable to record the payment.", errorAr: result.error ?? "تعذر تسجيل الدفعة." }
    try { revalidatePath("/invoices") } catch { /* fresh reads are authoritative */ }
    return { success: true, postingStatus: result.postingStatus }
  } catch (error) {
    return { success: false, error: errorMessage(error), errorAr: "تعذر تسجيل الدفعة. حاول مجدداً." }
  }
}
