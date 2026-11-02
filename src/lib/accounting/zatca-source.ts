import "server-only"
// Read-only loader for the immutable source of a ZATCA document. Shared by
// the live adapter (zatca-adapter-core.ts) and the offline dry run.
import type { createAdminClient } from "@/lib/supabase/admin"
import type { ZatcaLine } from "./zatca-ubl"

type InvoiceRow = {
  id: string
  invoice_number: string
  invoice_type: "sales" | "purchase"
  status: string
  customer_id: string | null
  issue_date: string
  currency: string
  subtotal: number
  discount: number
  vat_amount: number
  total: number
  vat_rate: number
}
export type ZatcaSourceDocument = {
  invoiceId: string
  docRef: string
  issueDate: string
  currency: string
  subtotal: number
  discount: number
  vatAmount: number
  total: number
  lines: ZatcaLine[]
  customerId: string | null
  referenceInvoiceNumber?: string
  noteReason?: string
}

/**
 * Loads the immutable source document (finalized sales invoice, or the note's
 * JSONB lines snapshot) for ZATCA. Read-only; shared by the live adapter and
 * the offline dry run. "skipped" = not a transmittable document.
 */
export async function loadZatcaSourceDocument(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  docType: "invoice" | "credit_note" | "debit_note",
  sourceId: string,
): Promise<ZatcaSourceDocument | "skipped" | "failed"> {
  // Load the source document. InvoiceFinalizedEvent → invoices;
  // Credit/DebitNoteIssuedEvent → the note table (its JSONB lines snapshot).
  let invoiceId: string
  let docRef: string
  let issueDate: string
  let currency = "SAR"
  let subtotal = 0
  let discount = 0
  let vatAmount = 0
  let total = 0
  let lines: ZatcaLine[] = []
  let customerId: string | null = null
  let referenceInvoiceNumber: string | undefined
  let noteReason: string | undefined

  if (docType === "invoice") {
    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id,invoice_number,invoice_type,status,customer_id,issue_date,currency,subtotal,discount,vat_amount,total,vat_rate")
      .eq("id", sourceId)
      .eq("tenant_id", tenantId)
      .maybeSingle<InvoiceRow>()
    if (invErr || !inv) return "skipped"
    // Only finalized SALES invoices are transmitted (ZATCA reports output-tax
    // documents). Purchases and non-finalized states are skipped.
    if (inv.invoice_type !== "sales" || inv.status !== "finalized") return "skipped"

    const { data: lineRows, error: linesErr } = await admin
      .from("invoice_lines")
      .select("line_no,item_name,description,quantity,unit_price,discount,amount,vat_rate,vat_amount")
      .eq("invoice_id", inv.id)
      .order("line_no", { ascending: true })
    if (linesErr) return "failed"

    invoiceId = inv.id
    docRef = inv.invoice_number
    issueDate = inv.issue_date
    currency = inv.currency ?? "SAR"
    subtotal = Number(inv.subtotal)
    discount = Number(inv.discount)
    vatAmount = Number(inv.vat_amount)
    total = Number(inv.total)
    lines = (lineRows ?? []).map((l) => ({
      line_no: l.line_no,
      item_name: l.item_name,
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      discount: Number(l.discount),
      amount: Number(l.amount),
      vat_rate: Number(l.vat_rate),
      vat_amount: Number(l.vat_amount),
    }))
    customerId = inv.customer_id
  } else {
    const table = docType === "credit_note" ? "credit_notes" : "debit_notes"
    const refColumn = docType === "credit_note" ? "credit_note_number" : "debit_note_number"
    const { data: note, error: noteErr } = await admin
      .from(table)
      .select(`id,${refColumn},reference_invoice_id,customer_id,issue_date,currency,subtotal,discount,vat_amount,total,reason,lines`)
      .eq("id", sourceId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        id: string
        reference_invoice_id: string
        customer_id: string | null
        issue_date: string
        currency: string
        subtotal: number
        discount: number
        vat_amount: number
        total: number
        reason: string | null
        lines: unknown
      }>()
    if (noteErr || !note) return "skipped"
    const { data: refInv } = await admin
      .from("invoices")
      .select("invoice_number")
      .eq("id", note.reference_invoice_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ invoice_number: string }>()
    referenceInvoiceNumber = refInv?.invoice_number
    noteReason = note.reason?.trim() || (docType === "credit_note" ? "Adjustment" : "Additional charge")

    invoiceId = note.reference_invoice_id
    docRef = String(note[refColumn as keyof typeof note] ?? note.id)
    issueDate = note.issue_date
    currency = note.currency ?? "SAR"
    subtotal = Number(note.subtotal)
    discount = Number(note.discount)
    vatAmount = Number(note.vat_amount)
    total = Number(note.total)
    lines = (Array.isArray(note.lines) ? note.lines : []).map((l, i) => {
      const row = l as Record<string, unknown>
      return {
        line_no: Number(row.line_no ?? i + 1),
        item_name: typeof row.item_name === "string" ? row.item_name : null,
        description: String(row.description ?? ""),
        quantity: Number(row.quantity ?? 1),
        unit_price: Number(row.unit_price ?? 0),
        discount: Number(row.discount ?? 0),
        amount: Number(row.amount ?? 0),
        vat_rate: Number(row.vat_rate ?? 15),
        vat_amount: Number(row.vat_amount ?? 0),
      }
    })
    customerId = note.customer_id
  }

  return { invoiceId, docRef, issueDate, currency, subtotal, discount, vatAmount, total, lines, customerId, referenceInvoiceNumber, noteReason }
}
