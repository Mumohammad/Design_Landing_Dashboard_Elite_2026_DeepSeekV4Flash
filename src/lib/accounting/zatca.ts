"use server"

// Financial Phase 15 — ZATCA adapter (IMPLEMENTATION-PLAN Phase 15).
//
// runZatcaAdapter(): consumes the ZATCA-relevant financial events
// (InvoiceFinalizedEvent / CreditNoteIssuedEvent / DebitNoteIssuedEvent),
// loads the immutable document + lines + parties + tenant, transforms it into
// a UBL 2.1 payload (zatca-ubl.ts), hands it to the pluggable transport
// (zatca-transport.ts — sandbox mock by default), and records the outcome in
// `zatca_transmissions` + the invoice `zatca_status` / `zatca_uuid`.
//
// Idempotency: one transmission row per (tenant, invoice_id, doc_type) via a
// UNIQUE index — replaying the adapter for an already-reported document is a
// no-op. Failed/rejected transmissions are retried on the next run.
//
// Scope guardrails (ZATCA-BOUNDARY.md): the adapter NEVER recomputes amounts
// (it reads invoice + line + tax payloads), NEVER mutates financial totals,
// and claims no ZATCA compliance. Only SALES documents are transmitted
// (ZATCA reports output-tax documents; purchase invoices are input-side).
//
// Permission: accounting:approve (same as the event dispatcher).

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError } from "@/lib/accounting/csv-utils"
import { buildZatcaUblInvoice, type ZatcaInvoiceData, type ZatcaLine, type ZatcaParty } from "./zatca-ubl"
import { transmitToZatca } from "./zatca-transport"
import { getZatcaCsidCredential } from "./zatca-csid"

export type ZatcaAdapterSummary = {
  success: boolean
  error?: string
  processed?: number
  skipped?: number
  failed?: number
  sandbox?: boolean
}

type EventRow = {
  id: string
  event_type: string
  source_type: string
  source_id: string
  payload: Record<string, unknown>
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

const ZATCA_EVENT_TYPES = new Set([
  "InvoiceFinalizedEvent",
  "CreditNoteIssuedEvent",
  "DebitNoteIssuedEvent",
])

function fmtDate(s: string | null | undefined): string {
  if (!s) return ""
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date(s).toISOString().slice(0, 10)
}

function fmtTime(s: string | null | undefined): string {
  if (!s) return "00:00:00"
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(s)
  return m ? m[1] : "00:00:00"
}

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

type PartyRow = {
  name_ar: string
  name_en: string | null
  tax_number: string | null
  address: string | null
  city: string | null
}

type TenantRow = {
  name_ar: string
  name_en: string | null
  legal_name: string | null
  vat_number: string | null
  cr_number: string | null
  address: string | null
  city: string | null
}

function partyName(row: PartyRow): string {
  return row.name_ar || row.name_en || ""
}

/**
 * Run the ZATCA adapter: process pending ZATCA-relevant events through the
 * transform → transmit → record pipeline. Never throws — returns a summary.
 */
export async function runZatcaAdapter(): Promise<ZatcaAdapterSummary> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    // Effective sandbox mode. The transport performs a REAL POST only when a
    // gateway base URL is configured AND credentials resolve (stored tenant
    // CSID first, env fallback — see zatca-transport.ts resolveCredentials).
    // Mirror that decision here so the audit log / UI flash can never report
    // "not sandbox" while the transport is actually returning the mock.
    const storedCsid = await getZatcaCsidCredential("production", "production", currentUser.tenantId)
    const reportingBaseConfigured = Boolean(process.env.ZATCA_API_BASE_URL)
    const envCredentialsConfigured = Boolean(process.env.ZATCA_CSID_CERT && process.env.ZATCA_CSID_SECRET)
    const sandbox = !(reportingBaseConfigured && (storedCsid || envCredentialsConfigured))

    // ZATCA-relevant events for this tenant (any processing status — the
    // accounting dispatcher owns that column; our ledger is the idempotency
    // boundary). Purchase invoices are never transmitted.
    const { data: events, error: evErr } = await admin
      .from("financial_events")
      .select("id,event_type,source_type,source_id,payload")
      .eq("tenant_id", currentUser.tenantId)
      .in("event_type", [...ZATCA_EVENT_TYPES])
      .order("created_at", { ascending: true })
      .limit(200)
    if (evErr) return { success: false, error: mapFinancialError(evErr.message) }

    let processed = 0
    let skipped = 0
    let failed = 0
    let lastError: string | null = null

    for (const ev of (events ?? []) as EventRow[]) {
      try {
        const outcome = await processEvent(admin, currentUser.tenantId, currentUser.authUserId, ev, storedCsid)
        if (outcome === "processed") processed++
        else if (outcome === "skipped") skipped++
        else failed++
      } catch (e) {
        failed++
        lastError = errorMessage(e)
      }
    }

    revalidatePath("/accounting")
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "zatca_adapter_ran",
      entityType: "zatca_transmissions",
      newValues: {
        processed,
        skipped,
        failed,
        sandbox,
        last_error: lastError,
      },
    })

    return { success: true, processed, skipped, failed, sandbox, error: lastError ?? undefined }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

type Outcome = "processed" | "skipped" | "failed"

async function processEvent(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  authUserId: string,
  ev: EventRow,
  storedCsid: { csidBase64: string; secret: string; privateKeyPem: string | null } | null
): Promise<Outcome> {
  const docType = ev.event_type === "InvoiceFinalizedEvent" ? "invoice"
    : ev.event_type === "CreditNoteIssuedEvent" ? "credit_note"
    : "debit_note"

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

  if (docType === "invoice") {
    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .select("id,invoice_number,invoice_type,status,customer_id,issue_date,currency,subtotal,discount,vat_amount,total,vat_rate")
      .eq("id", ev.source_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<InvoiceRow>()
    if (invErr || !inv) return "skipped"
    // Only finalized SALES invoices are transmitted (ZATCA reports output-tax
    // documents). Purchases and non-finalized states are skipped.
    if (inv.invoice_type !== "sales" || inv.status !== "finalized") return "skipped"

    const { data: lineRows, error: linesErr } = await admin
      .from("invoice_lines")
      .select("line_no,description,quantity,unit_price,amount,vat_rate,vat_amount")
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
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
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
      .select(`id,${refColumn},reference_invoice_id,customer_id,issue_date,currency,subtotal,discount,vat_amount,total,lines`)
      .eq("id", ev.source_id)
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
        lines: unknown
      }>()
    if (noteErr || !note) return "skipped"

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
        description: String(row.description ?? ""),
        quantity: Number(row.quantity ?? 1),
        unit_price: Number(row.unit_price ?? 0),
        amount: Number(row.amount ?? 0),
        vat_rate: Number(row.vat_rate ?? 15),
        vat_amount: Number(row.vat_amount ?? 0),
      }
    })
    customerId = note.customer_id
  }

  // Idempotency: an existing successful transmission skips this event.
  const { data: existing } = await admin
    .from("zatca_transmissions")
    .select("id,status")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .eq("doc_type", docType)
    .maybeSingle<{ id: string; status: string }>()
  if (existing && (existing.status === "reported" || existing.status === "cleared")) {
    return "skipped"
  }

  // Seller + buyer parties.
  const { data: tenant } = await admin
    .from("tenants")
    .select("name_ar,name_en,legal_name,vat_number,cr_number,address,city")
    .eq("id", tenantId)
    .maybeSingle<TenantRow>()
  if (!tenant) return "failed"
  // Seller VAT number is mandatory for ZATCA. Fall back to a documented
  // 15-digit demo placeholder when unset (mirrors invoice-docs.ts) so the
  // sandbox flow stays exercisable with the seeded demo tenant.
  const sellerVat = /^\d{15}$/.test(tenant.vat_number ?? "") ? tenant.vat_number! : "310122993400001"

  const { data: customer } = customerId
    ? await admin
        .from("customers")
        .select("name_ar,name_en,tax_number,address,city")
        .eq("id", customerId)
        .maybeSingle<PartyRow>()
    : { data: null }
  const buyer: ZatcaParty = {
    name: partyName((customer as PartyRow | null) ?? { name_ar: "عميل نقدي", name_en: "Walk-in customer", tax_number: null, address: null, city: null }),
    vatNumber: (customer as PartyRow | null)?.tax_number ?? null,
    address: (customer as PartyRow | null)?.address ?? null,
    city: (customer as PartyRow | null)?.city ?? null,
  }

  const sellerName = tenant.legal_name || tenant.name_ar || tenant.name_en || ""
  const seller: ZatcaParty = {
    name: sellerName,
    vatNumber: sellerVat,
    crNumber: tenant.cr_number ?? null,
    address: tenant.address ?? null,
    city: tenant.city ?? null,
  }

  const ublData: ZatcaInvoiceData = {
    docType,
    invoiceNumber: docRef,
    issueDate: fmtDate(issueDate),
    issueTime: fmtTime(issueDate),
    currency,
    seller,
    buyer,
    lines,
    subtotal,
    discount,
    vatAmount,
    total,
    qr: {
      sellerName,
      sellerVatNumber: sellerVat,
      timestamp: `${fmtDate(issueDate)}T${fmtTime(issueDate)}Z`,
      total,
      vatAmount,
    },
  }
  const xml = buildZatcaUblInvoice(ublData)

  // Transmit (sandbox mock by default). When the tenant has a stored
  // production CSID (migration 055), pass it as explicit credentials so the
  // transport authenticates with the documented Basic auth instead of the
  // sandbox mock — the env-only path still works for self-hosted setups.
  const response = await transmitToZatca({
    xml,
    pipeline: "reporting",
    docRef,
    ...(storedCsid ? { credentials: storedCsid } : {}),
  })

  // Record the transmission (upsert so retries refresh the same row).
  const record: Record<string, unknown> = {
    tenant_id: tenantId,
    invoice_id: invoiceId,
    doc_type: docType,
    doc_ref: docRef,
    payload_xml: xml,
    status: response.status,
    zatca_uuid: response.uuid,
    response: response.raw,
    error_message: null,
    transmitted_at: response.receivedAt,
    updated_by: authUserId,
  }
  if (existing) {
    await admin.from("zatca_transmissions").update(record).eq("id", existing.id)
  } else {
    record.created_by = authUserId
    const { error: insErr } = await admin.from("zatca_transmissions").insert(record)
    if (insErr) throw new Error(mapFinancialError(insErr.message))
  }

  // Reflect the status on the invoice itself (status fields only — financial
  // columns untouched; protect_finalized_invoice allows this).
  if (docType === "invoice") {
    await admin
      .from("invoices")
      .update({ zatca_status: response.status, zatca_uuid: response.uuid, updated_by: authUserId })
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
  }

  return "processed"
}

/**
 * Load a single transmission (payload + response) for the UI detail view.
 * Tenant-scoped via RLS on the service-role client.
 */
export async function getZatcaTransmission(id: string): Promise<{
  success: boolean
  error?: string
  transmission?: {
    doc_ref: string
    doc_type: string
    status: string
    zatca_uuid: string | null
    payload_xml: string
    response: Record<string, unknown> | null
    transmitted_at: string | null
    error_message: string | null
  }
}> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("zatca_transmissions")
      .select("doc_ref,doc_type,status,zatca_uuid,payload_xml,response,transmitted_at,error_message")
      .eq("id", id)
      .eq("tenant_id", currentUser.tenantId)
      .maybeSingle()
    if (error) return { success: false, error: mapFinancialError(error.message) }
    if (!data) return { success: false, error: "ZATCA transmission not found." }
    return { success: true, transmission: data as typeof data }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
