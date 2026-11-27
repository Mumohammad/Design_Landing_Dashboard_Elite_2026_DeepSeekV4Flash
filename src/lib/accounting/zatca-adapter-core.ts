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
import { buildZatcaUblInvoice, type ZatcaInvoiceData } from "./zatca-ubl"
import { transmitToZatca } from "./zatca-transport"
import { getZatcaNetworkBase } from "./zatca-config"
import { resolveTenantZatcaEnvironment } from "./zatca-environment"
import { prepareZatcaDocumentAs, type ZatcaActor } from "./zatca-issuance"
import { loadZatcaBuyer, loadZatcaSourceDocument } from "./zatca-source"
import { submitPreparedZatcaDocumentAs } from "./zatca-submission-core"
import {
  invoiceKindFor,
  missingNationalAddress,
  sellerParty,
  transmissionStatusFor,
  ZATCA_VAT_RE,
  type TenantPartyRow,
} from "./zatca-adapter-input"

export type ZatcaAdapterSummary = {
  success: boolean
  error?: string
  processed?: number
  skipped?: number
  failed?: number
  inProgress?: number
  sandbox?: boolean
  scheduledProgress?: { scan: ScheduledZatcaScan | null }
}

type EventRow = {
  id: string
  event_type: string
  source_id: string
  created_at: string
}

type EventCursor = Pick<EventRow, "id" | "created_at">

export type ScheduledZatcaScan = {
  environment: "sandbox" | "simulation"
  through: string
  cursor: EventCursor | null
}

type ScheduledZatcaTurn = { scan: ScheduledZatcaScan | null; stopAt: number }
type ScheduledEventWindow = { events: EventRow[]; after: EventCursor | null; has_more: boolean }

const SCHEDULED_EVENTS_PER_TURN = 16
const SCHEDULED_WINDOW_SIZE = 512
const SCHEDULED_WINDOWS_PER_TURN = 16

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

const ZATCA_EVENT_TYPES = new Set([
  "InvoiceFinalizedEvent",
  "CreditNoteIssuedEvent",
  "DebitNoteIssuedEvent",
])

function readManualEvents(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  through: string,
  cursor: EventCursor | null,
  pageSize: number,
  sourceIds?: string[],
) {
  let query = admin
    .from("financial_events")
    .select("id,event_type,source_id,created_at")
    .eq("tenant_id", tenantId)
    .in("event_type", [...ZATCA_EVENT_TYPES])
    .lte("created_at", through)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(pageSize)

  if (cursor) {
    const time = `"${cursor.created_at}"`
    query = query.or(`created_at.gt.${time},and(created_at.eq.${time},id.gt.${cursor.id})`)
  }
  if (sourceIds) query = query.in("source_id", sourceIds)
  return query
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return ""
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date(s).toISOString().slice(0, 10)
}

function fmtTime(s: string | null | undefined): string {
  const m = s ? /T(\d{2}:\d{2}:\d{2})/.exec(s) : null
  if (!m) throw new Error("An authoritative invoice issuance timestamp is required; a date alone cannot establish ZATCA issue time.")
  return m[1]
}


/**
 * Run the ZATCA adapter: process pending ZATCA-relevant events through the
 * transform → transmit → record pipeline. Never throws — returns a summary.
 */
export async function runZatcaAdapterAs(
  currentUser: ZatcaActor,
  opts: { revalidate?: boolean; sourceIds?: string[]; scheduled?: ScheduledZatcaTurn } = {},
): Promise<ZatcaAdapterSummary> {
  try {

    const admin = createAdminClient()
    const { data: authorized, error: authorizationError } = await admin.rpc("zatca_operator_authorized", {
      p_tenant: currentUser.tenantId, p_user: currentUser.authUserId,
    })
    if (authorizationError || authorized !== true) return { success: false, error: "The ZATCA operator is no longer authorized." }
    // The configured gateway uses the signed submission path. That path
    // loads a credential for the authorized tenant only when it needs to send.
    const tenantEnvironment = await resolveTenantZatcaEnvironment(admin, currentUser.tenantId)
    if (tenantEnvironment === "production") return { success: false, error: "ZATCA production submission is disabled." }
    const networkBase = getZatcaNetworkBase(tenantEnvironment ?? undefined)
    if (networkBase && !tenantEnvironment) return { success: false, error: "Unable to resolve the tenant's ZATCA environment." }
    const environment = tenantEnvironment ?? "sandbox"
    const sandbox = !networkBase
    const scheduled = opts.scheduled
    if (scheduled && sandbox) return { success: false, error: "The ZATCA gateway is unavailable for scheduled retry." }

    // ZATCA-relevant events for this tenant (any processing status — the
    // accounting dispatcher owns that column; our ledger is the idempotency
    // boundary). Purchase invoices are never transmitted.
    // Cursor-based pagination: process events in batches to handle tenants
    // with large volumes of unprocessed financial events.
    // Hold the sweep's upper bound across scheduled turns. An advancing
    // backlog must eventually wrap so failures in earlier pages get retried.
    const savedScan = scheduled?.scan?.environment === environment ? scheduled.scan : null
    let cursor: EventCursor | null = savedScan?.cursor ?? null
    const issuedThrough = savedScan?.through ?? new Date().toISOString()
    const manualPageSize = 200
    let windowsLeft = SCHEDULED_WINDOWS_PER_TURN
    let scheduledEventsLeft = SCHEDULED_EVENTS_PER_TURN
    let sweepComplete = false
    let pageRead = false
    let processed = 0
    let skipped = 0
    let failed = 0
    let inProgress = 0
    let lastError: string | null = null
    let scheduledReadError: string | null = null

    scanEvents: for (;;) {
      let events: EventRow[]
      let hasMore: boolean
      let windowEnd: EventCursor | null = null
      if (scheduled) {
        if (windowsLeft === 0 || scheduledEventsLeft === 0 || Date.now() >= scheduled.stopAt) break
        const { data, error } = await admin.rpc("list_zatca_scheduled_events", {
          p_tenant: currentUser.tenantId, p_environment: environment, p_through: issuedThrough,
          p_cursor_at: cursor?.created_at ?? null, p_cursor_id: cursor?.id ?? null, p_limit: SCHEDULED_WINDOW_SIZE,
        })
        if (error || !data) {
          scheduledReadError = error
            ? mapFinancialError(error.message)
            : "Register an EGS issuance stream for this ZATCA environment before transmitting."
          break
        }
        const window: ScheduledEventWindow = data
        events = window.events
        hasMore = window.has_more
        windowEnd = window.after
        windowsLeft--
        pageRead = true
      } else {
        const { data, error } = await readManualEvents(admin, currentUser.tenantId, issuedThrough, cursor, manualPageSize, opts.sourceIds)
        if (error) return { success: false, processed, skipped, failed, inProgress, sandbox, error: mapFinancialError(error.message) }
        events = data ?? []
        hasMore = events.length === manualPageSize
      }
      for (const ev of events) {
        if (scheduled) {
          if (scheduledEventsLeft === 0 || Date.now() >= scheduled.stopAt) break scanEvents
          scheduledEventsLeft--
        }
        try {
          const outcome = await processEvent(admin, currentUser.tenantId, currentUser.authUserId, ev, networkBase ? environment : null)
          if (outcome === "processed") processed++
          else if (outcome === "skipped") skipped++
          else if (outcome === "in_progress") {
            inProgress++
            skipped++
          } else failed++
        } catch (e) {
          failed++
          lastError = errorMessage(e)
        }
        cursor = { id: ev.id, created_at: ev.created_at }
      }
      if (windowEnd) cursor = windowEnd
      if (!hasMore) {
        sweepComplete = true
        break
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
        in_progress: inProgress,
        sandbox,
        last_error: scheduledReadError ?? lastError,
      },
    })

    const scheduledProgress = scheduled && pageRead
      ? { scan: sweepComplete ? null : { environment, through: issuedThrough, cursor } }
      : undefined
    return {
      success: !scheduledReadError, processed, skipped, failed, inProgress, sandbox,
      error: scheduledReadError ?? lastError ?? undefined,
      ...(scheduledProgress ? { scheduledProgress } : {}),
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

type Outcome = "processed" | "skipped" | "in_progress" | "failed"

async function processEvent(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  authUserId: string,
  ev: EventRow,
  networkEnvironment: "sandbox" | "simulation" | "production" | null
): Promise<Outcome> {
  const actor: ZatcaActor = { tenantId, authUserId }
  const docType = ev.event_type === "InvoiceFinalizedEvent" ? "invoice"
    : ev.event_type === "CreditNoteIssuedEvent" ? "credit_note"
    : "debit_note"

  const source = await loadZatcaSourceDocument(admin, tenantId, docType, ev.source_id, { existingPreparationEnvironment: networkEnvironment })
  if (source === "skipped" || source === "failed") return source
  const { docRef, issueDate, currency, subtotal, discount, vatAmount, total, lines, customerId, referenceInvoiceNumber, noteReason } = source

  // Idempotency: one transmission per source document (an invoice or the
  // specific credit/debit note — several notes may reference one invoice).
  const { data: existing, error: transmissionReadError } = await admin
    .from("zatca_transmissions")
    .select("id,status,environment:response->>environment,mock:response->mock,sandbox:response->sandbox")
    .eq("tenant_id", tenantId)
    .eq("doc_type", docType)
    .eq("source_id", ev.source_id)
    .maybeSingle<{ id: string; status: string; environment?: string | null; mock?: boolean; sandbox?: boolean }>()
  if (transmissionReadError) throw new Error("Unable to verify the previous ZATCA transmission.")
  // Accepted in THIS environment = done. A mock or other-environment
  // acceptance is not evidence for the configured gateway.
  if (existing && (existing.status === "reported" || existing.status === "cleared")
    && (!networkEnvironment || (existing.environment === networkEnvironment && existing.mock !== true && existing.sandbox !== true))) {
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

  const buyer = await loadZatcaBuyer(admin, tenantId, customerId)
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
    if (result.inProgress) return "in_progress"
    if (result.unconfirmed) throw new Error(result.error ?? "Unable to confirm the ZATCA submission.")
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
    transmittedAt = status === "failed" ? null : result.transmittedAt ?? transmittedAt
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
    })
    status = response.status
    zatcaUuid = response.uuid
    raw = response.raw
    transmittedAt = response.receivedAt
  }

  // One authorized transaction records the source transmission and updates
  // only the invoice's ZATCA fields. Direct service-role finance writes stay
  // blocked; a persistence failure is never counted as a processed document.
  const { data: recorded, error: recordError } = await admin.rpc("record_zatca_transmission", {
    p_tenant: tenantId, p_actor: authUserId, p_source_type: docType,
    p_source_id: ev.source_id, p_payload_xml: xml, p_status: status,
    p_zatca_uuid: zatcaUuid, p_response: raw,
    p_error_message: failure, p_transmitted_at: transmittedAt,
  })
  if (recordError || recorded !== true) throw new Error("Unable to persist the ZATCA transmission result.")

  return status === "failed" || status === "rejected" ? "failed" : "processed"
}


/**
 * Run the adapter for a tenant on behalf of its registered ZATCA operator
 * (zatca_automation). Used by the scheduled backstop and when the user who
 * finalized a document lacks accounting:approve. The operator's grant is
 * re-checked on every run; revoked/inactive operators stop automation.
 */
export async function runZatcaForTenant(
  tenantId: string,
  sourceId?: string,
  scheduled?: ScheduledZatcaTurn,
): Promise<ZatcaAdapterSummary & { operator?: boolean }> {
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
  const summary = await runZatcaAdapterAs({ tenantId, authUserId: automation.operator_id }, {
    revalidate: false, sourceIds: sourceId ? [sourceId] : undefined, scheduled,
  })
  await admin.from("zatca_automation").update({
    last_run_at: new Date().toISOString(),
    last_result: { success: summary.success, processed: summary.processed ?? 0, skipped: summary.skipped ?? 0, failed: summary.failed ?? 0, in_progress: summary.inProgress ?? 0, error: summary.error ?? null },
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId)
  return { ...summary, operator: true }
}
