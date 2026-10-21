import "server-only"
import { randomUUID } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { buildZatcaUblInvoice, type ZatcaInvoiceData, type ZatcaDocType } from "./zatca-ubl"
import { canonicalizeZatcaInvoice } from "./zatca-canonical"
import { computeInvoiceHash } from "./zatca-crypto"

export interface ZatcaPreparedDocument {
  id: string
  tenant_id: string
  stream_id: string
  environment: "sandbox" | "simulation"
  source_type: ZatcaDocType
  source_id: string
  doc_ref: string
  issued_at: string
  invoice_counter: number
  previous_invoice_hash: string
  invoice_hash: string
  unsigned_xml: string
}

type PreparedInput = Omit<ZatcaInvoiceData, "uuid" | "invoiceCounter" | "previousInvoiceHash" | "issueDate" | "issueTime" | "qr">

function preparedResult(value: unknown, tenant: string, source: string, type: ZatcaDocType, environment: string): ZatcaPreparedDocument {
  const row=value as Record<string, unknown> | null
  const strings=["id","tenant_id","stream_id","environment","source_type","source_id","doc_ref","issued_at","previous_invoice_hash","invoice_hash","unsigned_xml"]
  if (!row || strings.some(key=>typeof row[key] !== "string") || row.tenant_id !== tenant ||
      row.source_id !== source || row.source_type !== type || row.environment !== environment ||
      !Number.isSafeInteger(row.invoice_counter) || Number(row.invoice_counter) < 1) {
    throw new Error("Unexpected ZATCA preparation result.")
  }
  const data=row as unknown as ZatcaPreparedDocument
  // Explicit projection: the RPC's canonical bytes/source snapshot/actor are
  // private implementation evidence, not part of this helper's return shape.
  return {id:data.id,tenant_id:data.tenant_id,stream_id:data.stream_id,environment:data.environment,
    source_type:data.source_type,source_id:data.source_id,doc_ref:data.doc_ref,issued_at:data.issued_at,
    invoice_counter:data.invoice_counter,previous_invoice_hash:data.previous_invoice_hash,
    invoice_hash:data.invoice_hash,unsigned_xml:data.unsigned_xml}
}

/**
 * Server-only non-production preparation primitive, not a Server Action or a
 * submission. Future authorized adapters supply DB-loaded financial/profile
 * data. Store the returned artifact, not a newly built retry's proposed XML.
 * The DB validates source ownership/state/totals and atomically fences the
 * stream. Signing, onboarding, transmission and production remain unavailable.
 */
export async function prepareZatcaDocument(
  streamId: string, sourceId: string, input: PreparedInput,
): Promise<ZatcaPreparedDocument> {
  await requirePermission("accounting", "approve")
  const user = await getCurrentUser()
  if (!user) throw new Error("Not authenticated.")
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
  if (!uuidPattern.test(streamId) || !uuidPattern.test(sourceId) || !["invoice", "credit_note", "debit_note"].includes(input.docType)) {
    throw new Error("Invalid ZATCA preparation identity.")
  }
  const admin = createAdminClient()
  const { data: stream, error: streamError } = await admin.from("zatca_issuance_streams")
    .select("id,environment,last_counter,last_invoice_hash")
    .eq("id", streamId).eq("tenant_id", user.tenantId).maybeSingle()
  if (streamError || !stream) throw new Error("Unable to load the tenant's ZATCA preparation stream.")
  if (!["sandbox", "simulation"].includes(stream.environment)) throw new Error("ZATCA production preparation is disabled.")
  const { data: existing, error: existingError } = await admin.from("zatca_document_issuances")
    .select("id,tenant_id,stream_id,environment,source_type,source_id,doc_ref,issued_at,invoice_counter,previous_invoice_hash,invoice_hash,unsigned_xml")
    .eq("tenant_id", user.tenantId).eq("environment", stream.environment)
    .eq("source_type", input.docType).eq("source_id", sourceId).maybeSingle()
  if (existingError) throw new Error("Unable to load the existing ZATCA preparation.")
  if (existing) return preparedResult(existing,user.tenantId,sourceId,input.docType,stream.environment)
  const counter = Number(stream.last_counter)
  if (!Number.isSafeInteger(counter) || counter < 0 || counter >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid ZATCA preparation counter.")
  }
  if (!input.seller.vatNumber || !/^3\d{13}3$/.test(input.seller.vatNumber)) {
    throw new Error("A valid seller VAT identity is required for ZATCA preparation.")
  }
  const issuedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  const documentId = randomUUID()
  const data: ZatcaInvoiceData = {
    ...input, uuid: documentId, invoiceCounter: counter + 1,
    previousInvoiceHash: stream.last_invoice_hash,
    issueDate: issuedAt.slice(0, 10), issueTime: issuedAt.slice(11, 19),
    qr: { sellerName: input.seller.name, sellerVatNumber: input.seller.vatNumber,
      timestamp: issuedAt, total: input.total, vatAmount: input.vatAmount },
  }
  const xml = buildZatcaUblInvoice(data)
  const { data: stored, error } = await admin.rpc("record_zatca_issuance", {
    p_tenant: user.tenantId, p_stream: stream.id, p_source_type: input.docType,
    p_source_id: sourceId, p_document_uuid: documentId, p_issued_at: issuedAt,
    p_expected_counter: counter, p_previous_hash: stream.last_invoice_hash,
    p_xml: xml, p_canonical_xml: canonicalizeZatcaInvoice(xml),
    p_invoice_hash: computeInvoiceHash(xml), p_actor: user.authUserId,
  })
  if (error) {
    // SQL errors may echo invoice data. Only the conflict class is exposed.
    if (error.message?.startsWith("ZTC_CONFLICT:")) throw new Error("ZATCA preparation changed. Reload and retry.")
    throw new Error("Unable to persist the ZATCA preparation.")
  }
  return preparedResult(stored,user.tenantId,sourceId,input.docType,stream.environment)
}
