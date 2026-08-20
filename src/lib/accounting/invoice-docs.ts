"use server"

// Financial Phase 6 — Invoice documents (PDF / print / QR).
//
// generateInvoiceDocument(invoiceId): loads the invoice + lines + party +
// tenant, builds the tax-QR payload (verification QR — NOT a ZATCA tax QR),
// renders the bilingual RTL A4 HTML, uploads it to the tenant's
// `invoice-documents` bucket, and records the document in
// `generated_documents` (verify_url → /verify-document/[docNumber]).
//
// Re-running for the same invoice regenerates the same doc_number and
// refreshes the record (idempotent print). Permission: invoices:print.

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { buildInvoiceHtml, type InvoiceDocData } from "./invoice-html"
import { buildTaxQrPayload, qrPngDataUrl } from "./invoice-qr"
import { mapFinancialError } from "./csv-utils"

type ActionResult = {
  success: boolean
  error?: string
  html?: string
  docNumber?: string
  verifyUrl?: string
}

const STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  draft: { ar: "مسودة", en: "Draft" },
  issued: { ar: "صادرة", en: "Issued" },
  finalized: { ar: "معتمدة", en: "Finalized" },
  paid: { ar: "مدفوعة", en: "Paid" },
  partially_paid: { ar: "مدفوعة جزئياً", en: "Partially Paid" },
  overdue: { ar: "متأخرة", en: "Overdue" },
  cancelled: { ar: "ملغاة", en: "Cancelled" },
  credited: { ar: "معتمدة بإشعار", en: "Credited" },
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—"
  // Stored as YYYY-MM-DD; render verbatim to avoid timezone drift.
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date(s).toISOString().slice(0, 10)
}

type InvoiceRow = {
  id: string
  invoice_number: string
  invoice_type: "sales" | "purchase"
  status: string
  customer_id: string | null
  supplier_id: string | null
  issue_date: string
  due_date: string | null
  currency: string
  subtotal: number
  discount: number
  vat_amount: number
  total: number
  vat_rate: number
  notes: string | null
}

type LineRow = {
  line_no: number
  description: string
  quantity: number
  unit_price: number
  discount: number
  amount: number
  vat_rate: number
  vat_amount: number
}

type PartyRow = {
  name_ar: string
  name_en: string | null
  tax_number: string | null
  address: string | null
  phone: string | null
}

type TenantRow = {
  name_ar: string
  name_en: string | null
  vat_number: string | null
  cr_number: string | null
  phone: string | null
  address: string | null
  city: string | null
}

/**
 * Generate (or regenerate) the printable invoice document.
 * Returns the full HTML so the client can open a print dialog.
 */
export async function generateInvoiceDocument(invoiceId: string): Promise<ActionResult> {
  try {
    await requirePermission("invoices", "print")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()

    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id,invoice_number,invoice_type,status,customer_id,supplier_id,issue_date,due_date,currency,subtotal,discount,vat_amount,total,vat_rate,notes")
      .eq("id", invoiceId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle<InvoiceRow>()
    if (invErr || !inv) return { success: false, error: mapFinancialError("INV001: invoice not found") }

    const { data: lines, error: linesErr } = await admin
      .from("invoice_lines")
      .select("line_no,description,quantity,unit_price,discount,amount,vat_rate,vat_amount")
      .eq("invoice_id", invoiceId)
      .order("line_no", { ascending: true })
    if (linesErr) return { success: false, error: mapFinancialError(linesErr.message) }

    const partyKind = inv.invoice_type === "sales" ? "customers" : "suppliers"
    const { data: party } = await admin
      .from(partyKind)
      .select("name_ar,name_en,tax_number,address,phone")
      .eq("id", inv.invoice_type === "sales" ? inv.customer_id : inv.supplier_id)
      .maybeSingle<PartyRow>()

    const { data: tenant } = await admin
      .from("tenants")
      .select("name_ar,name_en,vat_number,cr_number,phone,address,city")
      .eq("id", currentUser.tenantId)
      .maybeSingle<TenantRow>()

    // Seller VAT number: real 15-digit number, else a documented 15-digit
    // demo placeholder (the seed tenant uses 'VAT-PLACEHOLDER' — 013).
    const sellerVat =
      /^\d{15}$/.test(tenant?.vat_number ?? "") ? tenant!.vat_number! : "310122993400001"

    const docNumber = `INVDOC-${inv.invoice_number}`
    const verifyUrl = `/verify-document/${docNumber}`
    const timestamp = new Date().toISOString()
    const status = STATUS_LABELS[inv.status] ?? { ar: inv.status, en: inv.status }
    const isSales = inv.invoice_type === "sales"
    const docType = isSales
      ? { ar: "فاتورة بيع", en: "Sales Invoice" }
      : { ar: "فاتورة شراء", en: "Purchase Invoice" }

    // Verification QR — standard 5-field TLV payload (invoice-qr.ts).
    const payload = buildTaxQrPayload({
      sellerName: tenant?.name_ar ?? tenant?.name_en ?? "نخبة التطوير",
      sellerVatNumber: sellerVat,
      timestamp,
      total: Number(inv.total),
      vatAmount: Number(inv.vat_amount),
    })
    const qrDataUrl = await qrPngDataUrl(payload)

    const doc: InvoiceDocData = {
      kind: "invoice",
      docTypeAr: docType.ar,
      docTypeEn: docType.en,
      invoiceNumber: inv.invoice_number,
      companyNameAr: tenant?.name_ar ?? "نخبة التطوير",
      companyNameEn: tenant?.name_en ?? "Elite Development",
      companyVatNumber: sellerVat,
      companyCrNumber: tenant?.cr_number ?? null,
      companyPhone: tenant?.phone ?? null,
      companyAddress: tenant?.address ?? "",
      companyCity: tenant?.city ?? "",
      partyNameAr: party?.name_ar ?? "—",
      partyNameEn: party?.name_en ?? "",
      partyTaxNumber: party?.tax_number ?? "",
      partyAddress: party?.address ?? "",
      partyPhone: party?.phone ?? "",
      issueDate: fmtDate(inv.issue_date),
      dueDate: inv.due_date ? fmtDate(inv.due_date) : null,
      currency: inv.currency ?? "SAR",
      lines: (lines ?? []) as LineRow[],
      subtotal: Number(inv.subtotal),
      discount: Number(inv.discount),
      vatAmount: Number(inv.vat_amount),
      total: Number(inv.total),
      notes: inv.notes,
      statusLabelAr: status.ar,
      statusLabelEn: status.en,
      qrDataUrl,
      verifyUrl,
      generatedAt: timestamp,
    }

    const html = buildInvoiceHtml(doc)

    // Store the rendered file under the tenant folder (signed URL for access).
    const storagePath = `${currentUser.tenantId}/${docNumber}.html`
    const { error: upErr } = await admin.storage
      .from("invoice-documents")
      .upload(storagePath, Buffer.from(html, "utf8"), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      })
    if (upErr) return { success: false, error: `Storage upload failed: ${upErr.message}` }

    const { data: signed } = await admin.storage
      .from("invoice-documents")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30)

    const generatedData = {
      kind: "invoice",
      invoice_number: inv.invoice_number,
      invoice_type: inv.invoice_type,
      status: inv.status,
      lines: (lines ?? []) as LineRow[],
      subtotal: Number(inv.subtotal),
      discount: Number(inv.discount),
      vat_amount: Number(inv.vat_amount),
      total: Number(inv.total),
      currency: inv.currency,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      party: party ?? null,
      company: {
        name_ar: tenant?.name_ar ?? null,
        name_en: tenant?.name_en ?? null,
        vat_number: sellerVat,
      },
    }

    // Record in generated_documents — regenerating refreshes the same doc.
    // The lookup deliberately ignores deleted_at: doc_number is UNIQUE, so a
    // soft-deleted row would still block a fresh INSERT (23505).
    const { data: existing } = await admin
      .from("generated_documents")
      .select("id,deleted_at")
      .eq("doc_number", docNumber)
      .maybeSingle<{ id: string; deleted_at: string | null }>()
    if (existing?.deleted_at) {
      // Restore the soft-deleted record so regeneration stays idempotent.
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
          invoice_id: inv.id,
          generated_data: generatedData,
          file_url: signed?.signedUrl ?? null,
          qr_code_url: null,
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
          invoice_id: inv.id,
          generated_data: generatedData,
          file_url: signed?.signedUrl ?? null,
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
      module: "invoices",
      action: "invoice_document_generated",
      entityType: "generated_documents",
      entityId: docId,
      newValues: {
        invoice_number: inv.invoice_number,
        doc_number: docNumber,
        total: Number(inv.total),
      },
    })

    return { success: true, html, docNumber, verifyUrl }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
