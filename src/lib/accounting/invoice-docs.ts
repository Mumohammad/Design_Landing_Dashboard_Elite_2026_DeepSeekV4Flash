import "server-only"

// Financial Phase 6 — Invoice documents (PDF / print / QR).
//
// generateInvoiceDocument(invoiceId): loads the invoice + lines + party +
// tenant, builds the tax-QR payload (verification QR — NOT a ZATCA tax QR),
// renders a bilingual reference-layout Letter PDF without browser metadata, uploads it to the tenant's
// `invoice-documents` bucket, and records the document in
// `generated_documents` (verify_url → /verify-document/[docNumber]).
//
// Re-running for the same invoice regenerates the same doc_number and
// refreshes the record, retaining each content-addressed file. Permission: invoices:print.

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { buildInvoiceHtml, type InvoiceDocData } from "./invoice-html"
import { buildTaxQrPayload, qrPngDataUrl } from "./invoice-qr"
import { mapFinancialError } from "./csv-utils"
import { createHash, randomBytes } from "crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { sumMoney } from "./decimal"
import { loadInvoiceReferenceFonts, renderInvoicePdf } from "./invoice-pdf"
import { loadAuthorityQr } from "./zatca-document-qr"
import { loadTenantLogoDataUrl } from "@/lib/branding/logo"

type ActionResult = {
  success: boolean
  error?: string
  pdf?: Uint8Array
  retryable?: boolean
  docNumber?: string
  verifyUrl?: string
}

const FINAL_SALES_STATUSES = new Set(["finalized", "paid", "partially_paid", "overdue", "credited"])

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
  show_due_date: boolean
  currency: string
  subtotal: number
  discount: number
  vat_amount: number
  total: number
  vat_rate: number
  notes: string | null
  finalized_at?: string | null
}

type LineRow = {
  item_name?: string | null
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
  building_number: string | null
  district: string | null
  logo_url: string | null
}

/**
 * Generate (or regenerate) the printable invoice document.
 * Returns the same PDF bytes that are retained in private storage.
 */
export async function generateInvoiceDocument(invoiceId: string, bankAccountId?: string): Promise<ActionResult> {
  try {
    await requirePermission("invoices", "print")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()

    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id,invoice_number,invoice_type,status,customer_id,supplier_id,issue_date,due_date,show_due_date,currency,subtotal,discount,vat_amount,total,vat_rate,notes,finalized_at")
      .eq("id", invoiceId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle<InvoiceRow>()
    if (invErr || !inv) return { success: false, error: mapFinancialError("INV001: invoice not found") }

    const { data: lines, error: linesErr } = await admin
      .from("invoice_lines")
      .select("line_no,item_name,description,quantity,unit_price,discount,amount,vat_rate,vat_amount")
      .eq("invoice_id", invoiceId)
      .eq("tenant_id", currentUser.tenantId)
      .order("line_no", { ascending: true })
    if (linesErr || !Array.isArray(lines) || lines.length === 0) return { success: false, error: "Unable to load the invoice line items." }

    const partyKind = inv.invoice_type === "sales" ? "customers" : "suppliers"
    const { data: party, error: partyError } = await admin
      .from(partyKind)
      .select("name_ar,name_en,tax_number,address,phone")
      .eq("id", inv.invoice_type === "sales" ? inv.customer_id : inv.supplier_id)
      .eq("tenant_id", currentUser.tenantId)
      .maybeSingle<PartyRow>()

    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("name_ar,name_en,vat_number,cr_number,phone,address,city,building_number,district,logo_url")
      .eq("id", currentUser.tenantId)
      .maybeSingle<TenantRow>()

    if (partyError || !party || tenantError || !tenant) {
      return { success: false, error: "Unable to load the invoice company or customer/supplier details. Try again." }
    }

    if (!tenant || !/^\d{15}$/.test(tenant.vat_number ?? "")) {
      return { success: false, error: "أضف الرقم الضريبي الصحيح في إعدادات الشركة أولاً. / Configure the company's 15-digit VAT number before printing a tax invoice." }
    }
    const sellerVat = tenant.vat_number!
    const { data: balances, error: balanceError } = await admin
      .from(inv.invoice_type === "sales" ? "receivables" : "payables")
      .select("paid_amount").eq("tenant_id", currentUser.tenantId)
      .eq("source_entity_type", inv.invoice_type === "sales" ? "invoice" : "purchase_invoice")
      .eq("source_entity_id", inv.id).is("deleted_at", null)
    if (balanceError || !Array.isArray(balances)) return { success: false, error: "Unable to load the invoice payment balance." }
    let bank: { bank_name: string; account_name: string; iban: string } | null = null
    if (bankAccountId) {
      const result = await admin.from("bank_accounts").select("bank_name,account_name,iban")
        .eq("id", bankAccountId).eq("tenant_id", currentUser.tenantId)
        .eq("currency", inv.currency).eq("is_active", true).is("deleted_at", null).maybeSingle()
      if (result.error || !result.data) return { success: false, error: "Select an active bank account in the invoice currency." }
      bank = result.data
    }
    // The tenant's own uploaded logo (Settings → Company); no logo when the
    // company has not uploaded one — never the platform's brand mark.
    const [logoDataUrl, fontBytes, referenceFonts] = await Promise.all([
      loadTenantLogoDataUrl(admin, currentUser.tenantId, tenant.logo_url),
      readFile(path.join(process.cwd(), "src", "assets", "fonts", "cairo.woff2")),
      loadInvoiceReferenceFonts(),
    ])

    const docNumber = `INVDOC-${inv.invoice_number}`

    // High-entropy verify token — prevents enumeration of invoice documents.
    const verifyToken = randomBytes(32).toString('hex')
    const verifyTokenHash = createHash('sha256').update(verifyToken).digest('hex')
    const verifyUrl = `/verify-document/${verifyToken}`
    const timestamp = new Date().toISOString()
    const status = STATUS_LABELS[inv.status] ?? { ar: inv.status, en: inv.status }
    const isSales = inv.invoice_type === "sales"
    const docType = isSales
      ? { ar: "فاتورة بيع", en: "Sales Invoice" }
      : { ar: "فاتورة شراء", en: "Purchase Invoice" }

    // Printed QR: the cleared (standard) or EGS-stamped reported (simplified)
    // QR from accepted ZATCA submission evidence when it exists; otherwise the
    // internal 5-field TLV verification QR, explicitly disclosed as such.
    const authorityQr = isSales ? await loadAuthorityQr(admin, currentUser.tenantId, inv.id) : null
    // Phase 1 (generation): a finalized sales invoice is an issued e-invoice
    // carrying the 5-field TLV QR stamped with its issue (finalization) time.
    // Nothing is submitted to ZATCA in this mode; drafts/issued copies keep
    // the explicit "internal · unvalidated" disclosure.
    const phase1 = isSales && FINAL_SALES_STATUSES.has(inv.status) && !!inv.finalized_at
    const simplified = isSales && !/^3\d{13}3$/.test(party?.tax_number ?? "")
    const payload = buildTaxQrPayload({
      sellerName: tenant.name_ar || tenant.name_en || "",
      sellerVatNumber: sellerVat,
      timestamp: phase1 ? new Date(inv.finalized_at!).toISOString() : timestamp,
      total: Number(inv.total),
      vatAmount: Number(inv.vat_amount),
    })
    const qrDataUrl = await qrPngDataUrl(authorityQr?.qrBase64 ?? payload)
    const envLabel = authorityQr?.environment === "simulation" ? { ar: "بيئة المحاكاة", en: "simulation" } : { ar: "البيئة التجريبية", en: "sandbox" }
    // Phase 1 prints the plain QR (as the reference invoices do); only
    // ZATCA-environment evidence carries a disclosure note.
    // Production (core gateway) documents print the authority QR without a
    // test disclosure; sandbox/simulation evidence keeps the explicit note.
    const qrNote = authorityQr
      ? authorityQr.environment === "production"
        ? authorityQr.kind === "cleared"
          ? { ar: "رمز من الفاتورة المُخلَّصة لدى هيئة الزكاة والضريبة والجمارك", en: "ZATCA-cleared invoice QR" }
          : { ar: "فاتورة مبسطة مُبلّغ عنها لدى هيئة الزكاة والضريبة والجمارك", en: "Simplified invoice reported to ZATCA" }
        : authorityQr.kind === "cleared"
          ? { ar: `رمز من الفاتورة المُخلَّصة لدى ZATCA (${envLabel.ar}) · ليست فاتورة إنتاج`, en: `ZATCA-cleared QR (${envLabel.en}) · not a production invoice` }
          : { ar: `رمز مختوم ومُبلّغ لـ ZATCA (${envLabel.ar}) · ليست فاتورة إنتاج`, en: `EGS-stamped reported QR (${envLabel.en}) · not a production invoice` }
      : null
    // National-address print lines: "<building> <street>" / "<district> <city>".
    const district = tenant.district?.trim() ?? ""
    const companyAddress = [tenant.building_number, tenant.address].map((v) => v?.trim()).filter(Boolean).join(" ")
    const companyCity = [district && !district.startsWith("حي") ? `حي ${district}` : district, tenant.city?.trim()].filter(Boolean).join(" ")

    const doc: InvoiceDocData = {
      kind: "invoice",
      ...referenceFonts,
      docTypeAr: docType.ar,
      docTypeEn: docType.en,
      invoiceNumber: inv.invoice_number,
      companyNameAr: tenant.name_ar || tenant.name_en || "",
      companyNameEn: tenant.name_en ?? "",
      companyVatNumber: sellerVat,
      companyCrNumber: tenant.cr_number,
      companyPhone: tenant.phone,
      companyAddress,
      companyCity,
      logoDataUrl: logoDataUrl ?? undefined,
      fontDataUrl: `data:font/woff2;base64,${fontBytes.toString("base64")}`,
      partyNameAr: party?.name_ar ?? "—",
      partyNameEn: party?.name_en ?? "",
      partyTaxNumber: party?.tax_number ?? "",
      partyAddress: party?.address ?? "",
      partyPhone: party?.phone ?? "",
      issueDate: fmtDate(inv.issue_date),
      dueDate: inv.show_due_date && inv.due_date ? fmtDate(inv.due_date) : null,
      currency: inv.currency ?? "SAR",
      lines: (lines as LineRow[]).map(line => ({ ...line, itemName: line.item_name ?? undefined })),
      subtotal: Number(inv.subtotal),
      discount: Number(inv.discount),
      vatAmount: Number(inv.vat_amount),
      total: Number(inv.total),
      paidAmount: sumMoney(...(balances ?? []).map(balance => Number(balance.paid_amount))),
      bankIban: bank?.iban,
      bankName: bank?.bank_name,
      bankBeneficiary: bank?.account_name,
      notes: inv.notes,
      statusLabelAr: status.ar,
      statusLabelEn: status.en,
      qrDataUrl,
      internalQr: !authorityQr && !phase1,
      qrNote,
      simplified,
      verifyUrl,
      generatedAt: timestamp,
    }

    const html = buildInvoiceHtml(doc)
    let pdf: Uint8Array
    try { pdf = await renderInvoicePdf(html) }
    catch { return { success: false, error: "Unable to render invoice PDF.", retryable: true } }
    const pdfHash = createHash("sha256").update(pdf).digest("hex")

    // Retain the exact downloadable PDF. Content-addressed paths prevent a
    // concurrent reprint with different bank options overwriting this artifact.
    const storagePath = `${currentUser.tenantId}/${inv.id}/${pdfHash}.pdf`
    const { error: upErr } = await admin.storage
      .from("invoice-documents")
      .upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      })
    if (upErr) return { success: false, error: `Storage upload failed: ${upErr.message}` }

    const { data: signed, error: signedError } = await admin.storage
      .from("invoice-documents")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30)
    if (signedError || !signed?.signedUrl) return { success: false, error: "Unable to create the invoice download link." }

    const generatedData = {
      kind: "invoice",
      file_format: "pdf",
      layout_version: "reference-a4-2",
      font_source: referenceFonts.referenceFontDataUrl ? "protected_reference" : "system_or_cairo",
      pdf_sha256: pdfHash,
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
      qr_kind: authorityQr ? `zatca_${authorityQr.environment}_${authorityQr.kind}` : phase1 ? "phase1_generated" : "internal_unvalidated",
      qr_generated_at: timestamp,
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
    const { data: existing, error: existingError } = await admin
      .from("generated_documents")
      .select("id,deleted_at")
      .eq("doc_number", docNumber)
      .eq("tenant_id", currentUser.tenantId)
      .maybeSingle<{ id: string; deleted_at: string | null }>()
    if (existingError) return { success: false, error: "Unable to load the generated invoice record." }
    if (existing?.deleted_at) {
      // Restore the soft-deleted record so regeneration stays idempotent.
      const restore = await admin
        .from("generated_documents")
        .update({ deleted_at: null, updated_by: currentUser.authUserId })
        .eq("id", existing.id)
        .eq("tenant_id", currentUser.tenantId)
      if (restore.error) return { success: false, error: "Unable to restore the generated invoice record." }
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
          verify_token_hash: verifyTokenHash,
          status: "generated",
          generated_at: timestamp,
          updated_by: currentUser.authUserId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("tenant_id", currentUser.tenantId)
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
          verify_token_hash: verifyTokenHash,
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

    return { success: true, pdf, docNumber, verifyUrl }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
