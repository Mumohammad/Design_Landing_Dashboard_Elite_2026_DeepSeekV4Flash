import "server-only"

// Financial Phase 15 — ZATCA adapter (IMPLEMENTATION-PLAN Phase 15).
//
// runZatcaAdapter(): consumes the ZATCA-relevant financial events
// (InvoiceFinalizedEvent / CreditNoteIssuedEvent / DebitNoteIssuedEvent),
// loads the immutable document + lines + parties + tenant, transforms it into
// a UBL 2.1 payload (zatca-ubl.ts), hands it to the pluggable transport
// (zatca-transport.ts — sandbox mock by default), and records the outcome in
// `zatca_transmissions` + the invoice `zatca_status` / `zatca_uuid`.
//
// Idempotency: one transmission row per (tenant, doc_type, source_id) via a
// UNIQUE index — replaying the adapter for an already-reported document is a
// no-op. Failed/rejected transmissions are retried on the next run.
//
// Network modes (sandbox/simulation gateway configured) never send unsigned
// XML: each document is prepared on the tenant's EGS issuance stream (ICV/PIH
// chain, Riyadh-local issue time), signed with the stored CSID private key and
// cleared (standard/B2B) or reported (simplified/B2C) via the prepared
// submission path, which retains the signed/cleared artifacts.
//
// Scope guardrails (ZATCA-BOUNDARY.md): the adapter NEVER recomputes amounts
// (it reads invoice + line + tax payloads), NEVER mutates financial totals,
// and claims no ZATCA compliance. Only SALES documents are transmitted
// (ZATCA reports output-tax documents; purchase invoices are input-side).
//
// Permission: accounting:approve (same as the event dispatcher).

import { integrationAvailable } from "@/lib/release/integrations"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError } from "@/lib/accounting/csv-utils"
import { buildZatcaUblInvoice, type ZatcaInvoiceData, type ZatcaLine } from "./zatca-ubl"
import { transmitToZatca } from "./zatca-transport"
import { getZatcaCsidCredential } from "./zatca-credentials"
import { getZatcaNetworkBase, zatcaConfiguredEnvironment } from "./zatca-config"
import { prepareZatcaDocumentAs, type ZatcaActor } from "./zatca-issuance"
import { submitPreparedZatcaDocumentAs } from "./zatca-submission-core"
import {
  buyerParty,
  invoiceKindFor,
  missingNationalAddress,
  sellerParty,
  transmissionStatusFor,
  ZATCA_VAT_RE,
  type CustomerPartyRow,
  type TenantPartyRow,
} from "./zatca-adapter-input"

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
  created_at?: string
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
  const m = s ? /T(\d{2}:\d{2}:\d{2})/.exec(s) : null
  if (!m) throw new Error("An authoritative invoice issuance timestamp is required; a date alone cannot establish ZATCA issue time.")
  return m[1]
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

/**
 * Run the ZATCA adapter: process pending ZATCA-relevant events through the
 * transform → transmit → record pipeline. Never throws — returns a summary.
 */
export async function runZatcaAdapterAs(
  currentUser: ZatcaActor,
  opts: { revalidate?: boolean; sourceIds?: string[] } = {},
): Promise<ZatcaAdapterSummary> {
  try {

    const admin = createAdminClient()
    // Effective sandbox mode. The transport performs a REAL POST only when a
    // gateway base URL is configured AND credentials resolve (stored tenant
    // CSID first, env fallback — see zatca-transport.ts resolveCredentials).
    // Mirror that decision here so the audit log / UI flash can never report
    // "not sandbox" while the transport is actually returning the mock.
    const networkBase = getZatcaNetworkBase()
    const environment = zatcaConfiguredEnvironment() ?? "sandbox"
    const storedCsid = networkBase ? await getZatcaCsidCredential(environment, "production", currentUser.tenantId) : null
    const sandbox = !networkBase

    // ZATCA-relevant events for this tenant (any processing status — the
    // accounting dispatcher owns that column; our ledger is the idempotency
    // boundary). Purchase invoices are never transmitted.
    // Cursor-based pagination: process events in batches to handle tenants
    // with large volumes of unprocessed financial events.
    const allEvents: EventRow[] = []
    let evCursor: string | null = null
    const BATCH_SIZE = 200
    const MAX_EVENTS = 10_000

    while (allEvents.length < MAX_EVENTS) {
      let evQuery = admin
        .from("financial_events")
        .select("id,event_type,source_type,source_id,payload,created_at")
        .eq("tenant_id", currentUser.tenantId)
        .in("event_type", [...ZATCA_EVENT_TYPES])
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(BATCH_SIZE + 1)

      if (evCursor) evQuery = evQuery.gt("id", evCursor)
      // Manual "Send to ZATCA" for selected documents only.
      if (opts.sourceIds) evQuery = evQuery.in("source_id", opts.sourceIds)

      const { data: batch, error: evErr } = await evQuery
      if (evErr) return { success: false, error: mapFinancialError(evErr.message) }
      if (!batch || batch.length === 0) break

      const hasMore = batch.length > BATCH_SIZE
      const events = hasMore ? batch.slice(0, BATCH_SIZE) : batch
      evCursor = String(events[events.length - 1].id)
      allEvents.push(...(events as unknown as EventRow[]))

      if (!hasMore) break
    }

    let processed = 0
    let skipped = 0
    let failed = 0
    let lastError: string | null = null

    for (const ev of allEvents) {
      try {
        const outcome = await processEvent(admin, currentUser.tenantId, currentUser.authUserId, ev, storedCsid, networkBase ? environment : null)
        if (outcome === "processed") processed++
        else if (outcome === "skipped") skipped++
        else failed++
      } catch (e) {
        failed++
        lastError = errorMessage(e)
      }
    }

    if (opts.revalidate !== false) revalidatePath("/accounting")
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
  storedCsid: { csidBase64: string; secret: string; privateKeyPem: string | null } | null,
  networkEnvironment: "sandbox" | "simulation" | null
): Promise<Outcome> {
  const actor: ZatcaActor = { tenantId, authUserId }
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
  let referenceInvoiceNumber: string | undefined
  let noteReason: string | undefined

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

  // Idempotency: one transmission per source document (an invoice or the
  // specific credit/debit note — several notes may reference one invoice).
  const { data: existing } = await admin
    .from("zatca_transmissions")
    .select("id,status,environment:response->>environment")
    .eq("tenant_id", tenantId)
    .eq("doc_type", docType)
    .eq("source_id", ev.source_id)
    .maybeSingle<{ id: string; status: string; environment?: string | null }>()
  // Accepted in THIS environment = done. A mock or other-environment
  // acceptance is not evidence for the configured gateway.
  if (existing && (existing.status === "reported" || existing.status === "cleared")
    && (!networkEnvironment || existing.environment === networkEnvironment || existing.environment === undefined)) {
    return "skipped"
  }

  // Seller + buyer parties (structured National Address, migration 20261028131000).
  const { data: tenant } = await admin
    .from("tenants")
    .select("name_ar,name_en,legal_name,vat_number,cr_number,address,city,region,district,building_number,additional_number,postal_code,country")
    .eq("id", tenantId)
    .maybeSingle<TenantPartyRow>()
  if (!tenant) return "failed"
  const seller = sellerParty(tenant)
  // Never replace a missing tax identity with a demo VAT number.
  if (!ZATCA_VAT_RE.test(seller.vatNumber ?? "")) throw new Error("Configure the seller VAT number before preparing a ZATCA document.")
  const sellerVat = seller.vatNumber!

  const { data: customer } = customerId
    ? await admin
        .from("customers")
        .select("name_ar,name_en,tax_number,address,city,district,building_number,additional_number,postal_code,country_code")
        .eq("id", customerId)
        .eq("tenant_id", tenantId)
        .maybeSingle<CustomerPartyRow>()
    : { data: null }
  const buyer = buyerParty(customer ?? null)
  const invoiceKind = invoiceKindFor(buyer)
  const deliveryDate = fmtDate(issueDate)

  let xml: string
  let status: "reported" | "cleared" | "rejected" | "failed" | "pending"
  let zatcaUuid: string | null
  let raw: Record<string, unknown>
  let failure: string | null = null
  let transmittedAt: string | null = new Date().toISOString()

  if (networkEnvironment) {
    const missing = [
      ...missingNationalAddress(seller, "seller", invoiceKind).map((f) => `seller.${f}`),
      ...missingNationalAddress(buyer, "buyer", invoiceKind).map((f) => `buyer.${f}`),
    ]
    if (missing.length) throw new Error(`${docRef}: complete the National Address before ZATCA submission (${missing.join(", ")}).`)
    if (docType !== "invoice" && !referenceInvoiceNumber) throw new Error(`${docRef}: the referenced sales invoice could not be loaded.`)

    const { data: stream } = await admin
      .from("zatca_issuance_streams")
      .select("id,created_at")
      .eq("tenant_id", tenantId)
      .eq("environment", networkEnvironment)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string; created_at?: string }>()
    if (!stream) throw new Error("Register an EGS issuance stream for this ZATCA environment before transmitting.")
    // Go-live cutoff: documents finalized before the EGS was registered for
    // this environment predate the integration and are never submitted.
    if (stream.created_at && ev.created_at && Date.parse(ev.created_at) < Date.parse(stream.created_at)) return "skipped"

    // prepareZatcaDocument replays the stored artifact for an already
    // prepared source, so retries never consume a new ICV or change the hash.
    const prepared = await prepareZatcaDocumentAs(actor, stream.id, ev.source_id, {
      docType,
      invoiceKind,
      invoiceNumber: docRef,
      currency,
      deliveryDate,
      paymentMeansCode: "1",
      ...(docType !== "invoice" ? { referenceInvoiceNumber, noteReason } : {}),
      seller,
      buyer,
      lines,
      subtotal,
      discount,
      vatAmount,
      total,
    })
    const result = await submitPreparedZatcaDocumentAs(actor, prepared.id, "submit")
    xml = prepared.unsigned_xml
    status = transmissionStatusFor(result)
    zatcaUuid = prepared.id
    raw = {
      issuance_id: prepared.id,
      invoice_counter: prepared.invoice_counter,
      invoice_hash: prepared.invoice_hash,
      environment: networkEnvironment,
      pipeline: result.pipeline ?? null,
      warnings: result.warnings ?? [],
      errors: result.errors ?? [],
    }
    if (status === "failed" || status === "rejected") failure = result.error ?? "Rejected by ZATCA validation."
    if (status === "failed") transmittedAt = null
  } else {
    // Offline mock (no gateway configured): unsigned preview payload only,
    // classified as mock evidence by the transport response.
    const ublData: ZatcaInvoiceData = {
      docType,
      invoiceKind,
      invoiceNumber: docRef,
      issueDate: fmtDate(issueDate),
      issueTime: fmtTime(issueDate),
      currency,
      deliveryDate,
      ...(docType !== "invoice" ? { referenceInvoiceNumber, noteReason, paymentMeansCode: "1" } : {}),
      seller,
      buyer,
      lines,
      subtotal,
      discount,
      vatAmount,
      total,
      qr: {
        sellerName: seller.name,
        sellerVatNumber: sellerVat,
        timestamp: `${fmtDate(issueDate)}T${fmtTime(issueDate)}`,
        total,
        vatAmount,
      },
    }
    xml = buildZatcaUblInvoice(ublData)
    const response = await transmitToZatca({
      xml,
      pipeline: invoiceKind === "standard" ? "clearance" : "reporting",
      docRef,
      ...(storedCsid ? { credentials: storedCsid } : {}),
    })
    status = response.status
    zatcaUuid = response.uuid
    raw = response.raw
    transmittedAt = response.receivedAt
  }

  // Record the transmission (update in place so retries refresh the same row).
  const record: Record<string, unknown> = {
    tenant_id: tenantId,
    invoice_id: invoiceId,
    source_id: ev.source_id,
    doc_type: docType,
    doc_ref: docRef,
    payload_xml: xml,
    status,
    zatca_uuid: zatcaUuid,
    response: raw,
    error_message: failure,
    transmitted_at: transmittedAt,
    updated_by: authUserId,
  }
  if (existing) {
    await admin.from("zatca_transmissions").update(record).eq("id", existing.id).eq("tenant_id", tenantId)
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
      .update({ zatca_status: status, zatca_uuid: zatcaUuid, updated_by: authUserId })
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
  }

  return status === "failed" || status === "rejected" ? "failed" : "processed"
}


/**
 * Run the adapter for a tenant on behalf of its registered ZATCA operator
 * (zatca_automation). Used by the scheduled backstop and when the user who
 * finalized a document lacks accounting:approve. The operator's grant is
 * re-checked on every run; revoked/inactive operators stop automation.
 */
export async function runZatcaForTenant(tenantId: string): Promise<ZatcaAdapterSummary & { operator?: boolean }> {
  if (!integrationAvailable("zatca")) return { success: false, error: "ZATCA integration is not enabled." }
  const admin = createAdminClient()
  const { data: automation } = await admin
    .from("zatca_automation")
    .select("operator_id,enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ operator_id: string; enabled: boolean }>()
  if (!automation?.enabled) return { success: false, operator: false, error: "No ZATCA operator registered for automatic submission." }
  const { data: authorized, error } = await admin.rpc("zatca_operator_authorized", { p_tenant: tenantId, p_user: automation.operator_id })
  if (error || authorized !== true) return { success: false, operator: false, error: "The registered ZATCA operator is no longer authorized." }
  const summary = await runZatcaAdapterAs({ tenantId, authUserId: automation.operator_id }, { revalidate: false })
  await admin.from("zatca_automation").update({
    last_run_at: new Date().toISOString(),
    last_result: { success: summary.success, processed: summary.processed ?? 0, skipped: summary.skipped ?? 0, failed: summary.failed ?? 0, error: summary.error ?? null },
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId)
  return { ...summary, operator: true }
}
