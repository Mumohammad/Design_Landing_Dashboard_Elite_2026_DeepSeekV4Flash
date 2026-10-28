"use server"

// Signs a prepared (immutable) ZATCA issuance with the tenant's CSID and
// submits it to the configured NON-PRODUCTION gateway. Every attempt,
// accepted or rejected, is appended to zatca_submission_attempts.
import { X509Certificate } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { getZatcaNetworkBase } from "./zatca-config"
import { getZatcaCsidCredential } from "./zatca-credentials"
import { signZatcaInvoice, ZatcaSigningError } from "./zatca-signer"
import { transmitToZatca, ZatcaTransportError, type ZatcaPipeline, type ZatcaValidationMessage } from "./zatca-transport"

export interface ZatcaSubmissionResult {
  success: boolean
  status?: "reported" | "cleared" | "rejected"
  pipeline?: ZatcaPipeline
  warnings?: ZatcaValidationMessage[]
  errors?: ZatcaValidationMessage[]
  error?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Riyadh wall-clock time, YYYY-MM-DDTHH:mm:ss, for xades:SigningTime. */
function riyadhNow(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 19)
}

/** binarySecurityToken is Base64 of the certificate's Base64 text. */
async function certificateFromToken(token: string): Promise<string> {
  const decoded = Buffer.from(token, "base64").toString("utf8").replace(/-----[^-]+-----|\s/g, "")
  for (const candidate of [decoded, token]) {
    try {
      new X509Certificate(Buffer.from(candidate, "base64"))
      return candidate
    } catch {
      /* try the next encoding */
    }
  }
  throw new ZatcaSigningError("CERTIFICATE")
}

/**
 * @param mode "compliance" runs the onboarding compliance check with the
 *   compliance CSID; "submit" reports (simplified) or clears (standard) with
 *   the production CSID of the same non-production environment.
 */
export async function submitPreparedZatcaDocument(
  issuanceId: string,
  mode: "compliance" | "submit" = "submit"
): Promise<ZatcaSubmissionResult> {
  try {
    await requirePermission("accounting", "approve")
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated." }
    if (!UUID.test(issuanceId) || (mode !== "compliance" && mode !== "submit")) return { success: false, error: "Invalid request." }

    const base = getZatcaNetworkBase()
    const environment = process.env.ZATCA_MODE === "simulation" ? "simulation" : "sandbox"
    if (!base) return { success: false, error: "ZATCA gateway is not configured (offline mock mode)." }

    const admin = createAdminClient()
    const { data: issuance, error } = await admin
      .from("zatca_document_issuances")
      .select("id,tenant_id,environment,doc_ref,invoice_hash,unsigned_xml")
      .eq("id", issuanceId)
      .eq("tenant_id", user.tenantId)
      .maybeSingle<{ id: string; tenant_id: string; environment: string; doc_ref: string; invoice_hash: string; unsigned_xml: string }>()
    if (error || !issuance) return { success: false, error: "Prepared document not found." }
    if (issuance.environment !== environment) return { success: false, error: "The document was prepared for another ZATCA environment." }

    const credential = await getZatcaCsidCredential(environment, mode === "compliance" ? "compliance" : "production", user.tenantId)
    if (!credential?.privateKeyPem) return { success: false, error: "Issue a CSID with its private key before submitting." }

    const simplified = /<cbc:InvoiceTypeCode name="02/.test(issuance.unsigned_xml)
    const pipeline: ZatcaPipeline = mode === "compliance" ? "compliance" : simplified ? "reporting" : "clearance"
    const signed = signZatcaInvoice({
      environment,
      kind: simplified ? "simplified" : "standard",
      unsignedXml: issuance.unsigned_xml,
      credentials: { certificateBase64: await certificateFromToken(credential.csidBase64), privateKeyPem: credential.privateKeyPem },
      signingTime: riyadhNow(),
    })
    if (signed.invoiceHash !== issuance.invoice_hash) return { success: false, error: "Prepared document hash mismatch." }

    const uuid = issuance.unsigned_xml.match(/<cbc:UUID>([0-9a-f-]{36})<\/cbc:UUID>/i)?.[1]
    let status: "reported" | "cleared" | "rejected" | "failed" = "failed"
    let raw: Record<string, unknown> = {}
    let httpStatus: number | null = null
    let errorCode: string | null = null
    let clearedXml: string | null = null
    try {
      const response = await transmitToZatca({
        xml: signed.signedXml,
        pipeline,
        docRef: issuance.doc_ref,
        invoiceHash: signed.invoiceHash,
        uuid,
        credentials: credential,
      })
      status = response.status
      raw = response.raw
      httpStatus = typeof response.raw.httpStatus === "number" ? response.raw.httpStatus : null
      if (response.clearedInvoice) clearedXml = Buffer.from(response.clearedInvoice, "base64").toString("utf8")
    } catch (e) {
      errorCode = e instanceof ZatcaTransportError ? e.code : "UNEXPECTED"
      httpStatus = e instanceof ZatcaTransportError ? e.httpStatus ?? null : null
    }

    const { error: evidenceError } = await admin.from("zatca_submission_attempts").insert({
      tenant_id: user.tenantId,
      issuance_id: issuance.id,
      environment,
      pipeline,
      status,
      http_status: httpStatus,
      invoice_hash: signed.invoiceHash,
      signed_xml: signed.signedXml,
      cleared_xml: clearedXml,
      response: raw,
      error_code: errorCode,
      created_by: user.authUserId,
    })
    if (evidenceError) console.error("[zatca] failed to persist submission evidence")

    await writeAuditLog({
      tenantId: user.tenantId,
      actorId: user.authUserId,
      module: "accounting",
      action: "zatca_submission_attempted",
      entityType: "zatca_document_issuances",
      entityId: issuance.id,
      newValues: { environment, pipeline, status, httpStatus, errorCode },
    })

    if (status === "failed") return { success: false, pipeline, error: `ZATCA gateway unavailable (${errorCode}).` }
    const validation = (raw.validationResults ?? {}) as { warningMessages?: ZatcaValidationMessage[]; errorMessages?: ZatcaValidationMessage[] }
    return {
      success: status !== "rejected",
      status,
      pipeline,
      warnings: validation.warningMessages ?? [],
      errors: validation.errorMessages ?? [],
    }
  } catch (e) {
    if (e instanceof ZatcaSigningError) return { success: false, error: e.message }
    return { success: false, error: e instanceof Error ? e.message : "Unexpected error." }
  }
}
