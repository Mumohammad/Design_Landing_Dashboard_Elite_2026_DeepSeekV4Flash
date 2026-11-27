import "server-only"

// Signs a prepared (immutable) ZATCA issuance with the tenant's CSID and
// submits it to the configured NON-PRODUCTION gateway. Every attempt,
// accepted or rejected, is appended to zatca_submission_attempts.
import { createAdminClient } from "@/lib/supabase/admin"
import type { ZatcaActor } from "./zatca-issuance"
import { writeAuditLog } from "@/lib/auth/sessions"
import { getZatcaNetworkBase } from "./zatca-config"
import { resolveTenantZatcaEnvironment } from "./zatca-environment"
import { certificateFromToken } from "./zatca-cert"
import { readAuthorizedZatcaCsidCredential } from "./zatca-credentials"
import { signZatcaInvoice, ZatcaSigningError } from "./zatca-signer"
import { transmitToZatca, ZatcaTransportError, type ZatcaPipeline, type ZatcaValidationMessage } from "./zatca-transport"

export interface ZatcaSubmissionResult {
  success: boolean
  status?: "reported" | "cleared" | "rejected"
  pipeline?: ZatcaPipeline
  warnings?: ZatcaValidationMessage[]
  errors?: ZatcaValidationMessage[]
  error?: string
  transmittedAt?: string
  inProgress?: boolean
  unconfirmed?: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function submissionResult(
  status: NonNullable<ZatcaSubmissionResult["status"]>,
  pipeline: ZatcaPipeline,
  response: Record<string, unknown>,
): ZatcaSubmissionResult {
  const validation = (response.validationResults ?? {}) as { warningMessages?: ZatcaValidationMessage[]; errorMessages?: ZatcaValidationMessage[] }
  return {
    success: status !== "rejected",
    status,
    pipeline,
    warnings: validation.warningMessages ?? [],
    errors: validation.errorMessages ?? [],
  }
}

/** Riyadh wall-clock time, YYYY-MM-DDTHH:mm:ss, for xades:SigningTime. */
function riyadhNow(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 19)
}

/**
 * @param mode "compliance" runs the onboarding compliance check with the
 *   compliance CSID; "submit" reports (simplified) or clears (standard) with
 *   the production CSID of the same non-production environment.
 */
export async function submitPreparedZatcaDocumentAs(
  user: ZatcaActor,
  issuanceId: string,
  mode: "compliance" | "submit" = "submit"
): Promise<ZatcaSubmissionResult> {
  try {
    if (!UUID.test(issuanceId) || (mode !== "compliance" && mode !== "submit")) return { success: false, error: "Invalid request." }

    const admin = createAdminClient()
    const { data: authorized, error: authorizationError } = await admin.rpc("zatca_operator_authorized", {
      p_tenant: user.tenantId, p_user: user.authUserId,
    })
    if (authorizationError || authorized !== true) return { success: false, error: "The ZATCA operator is no longer authorized." }
    const environment = await resolveTenantZatcaEnvironment(admin, user.tenantId)
    if (environment === "production") return { success: false, error: "ZATCA production submission is disabled." }
    const base = environment ? getZatcaNetworkBase(environment) : null
    if (!base || !environment) return { success: false, error: "ZATCA gateway is not configured (offline mock mode)." }
    const { data: issuance, error } = await admin
      .from("zatca_document_issuances")
      .select("id,tenant_id,environment,doc_ref,invoice_hash,unsigned_xml")
      .eq("id", issuanceId)
      .eq("tenant_id", user.tenantId)
      .maybeSingle<{ id: string; tenant_id: string; environment: string; doc_ref: string; invoice_hash: string; unsigned_xml: string }>()
    if (error || !issuance) return { success: false, error: "Prepared document not found." }
    if (issuance.environment !== environment) return { success: false, error: "The document was prepared for another ZATCA environment." }

    const simplified = /<cbc:InvoiceTypeCode name="02/.test(issuance.unsigned_xml)
    const pipeline: ZatcaPipeline = mode === "compliance" ? "compliance" : simplified ? "reporting" : "clearance"
    const acceptedStatus = simplified ? "reported" : "cleared"
    if (pipeline !== "compliance") {
      const { data: accepted, error: attemptError } = await admin
        .from("zatca_submission_attempts")
        .select("response,created_at")
        .eq("tenant_id", user.tenantId)
        .eq("issuance_id", issuance.id)
        .eq("environment", environment)
        .eq("invoice_hash", issuance.invoice_hash)
        .eq("pipeline", pipeline)
        .eq("status", acceptedStatus)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle<{ response: Record<string, unknown>; created_at: string }>()
      if (attemptError) {
        return { success: false, pipeline, unconfirmed: true, error: "Unable to verify the previous ZATCA submission." }
      }
      // A previous attempt may have retained acceptance before the adapter
      // could save the source document's status. Return that durable result.
      if (accepted) {
        return {
          ...submissionResult(acceptedStatus, pipeline, accepted.response),
          transmittedAt: accepted.created_at,
        }
      }
    }

    const credential = await readAuthorizedZatcaCsidCredential(admin, user.tenantId, environment, mode === "compliance" ? "compliance" : "production")
    if (!credential?.privateKeyPem) return { success: false, error: "Issue a CSID with its private key before submitting." }

    const signed = signZatcaInvoice({
      environment,
      kind: simplified ? "simplified" : "standard",
      unsignedXml: issuance.unsigned_xml,
      credentials: { certificateBase64: certificateFromToken(credential.csidBase64), privateKeyPem: credential.privateKeyPem },
      signingTime: riyadhNow(),
    })
    if (signed.invoiceHash !== issuance.invoice_hash) return { success: false, error: "Prepared document hash mismatch." }

    let claimToken: string | null = null
    if (pipeline !== "compliance") {
      const { data: claim, error: claimError } = await admin.rpc("claim_zatca_submission", {
        p_tenant: user.tenantId,
        p_actor: user.authUserId,
        p_issuance: issuance.id,
        p_environment: environment,
        p_pipeline: pipeline,
      })
      if (claimError || !claim) return { success: false, pipeline, unconfirmed: true, error: "Unable to claim the ZATCA submission." }
      if (claim.state === "busy") return { success: false, pipeline, inProgress: true, error: "A ZATCA submission is already in progress." }
      if (claim.state === "accepted" && claim.response && typeof claim.created_at === "string") {
        return {
          ...submissionResult(acceptedStatus, pipeline, claim.response),
          transmittedAt: claim.created_at,
        }
      }
      if (claim.state !== "claimed" || typeof claim.token !== "string" || !UUID.test(claim.token)) {
        return { success: false, pipeline, unconfirmed: true, error: "Unable to claim the ZATCA submission." }
      }
      claimToken = claim.token
    }

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
        environment,
      })
      status = response.status
      raw = response.raw
      httpStatus = typeof response.raw.httpStatus === "number" ? response.raw.httpStatus : null
      if (response.clearedInvoice) clearedXml = Buffer.from(response.clearedInvoice, "base64").toString("utf8")
    } catch (e) {
      errorCode = e instanceof ZatcaTransportError ? e.code : "UNEXPECTED"
      httpStatus = e instanceof ZatcaTransportError ? e.httpStatus ?? null : null
    }

    const attempt = {
      status,
      http_status: httpStatus,
      signed_xml: signed.signedXml,
      cleared_xml: clearedXml,
      response: raw,
      error_code: errorCode,
    }
    const { data: recordedAt, error: evidenceError } = claimToken
      ? await admin.rpc("finish_zatca_submission", {
        p_tenant: user.tenantId,
        p_actor: user.authUserId,
        p_issuance: issuance.id,
        p_token: claimToken,
        p_attempt: attempt,
      })
      : await admin.from("zatca_submission_attempts").insert({
        ...attempt,
        tenant_id: user.tenantId,
        issuance_id: issuance.id,
        environment,
        pipeline,
        invoice_hash: signed.invoiceHash,
        created_by: user.authUserId,
      })
    if (evidenceError || (claimToken && typeof recordedAt !== "string")) {
      return { success: false, pipeline, unconfirmed: true, error: "Unable to retain the ZATCA submission evidence. Retry with the same prepared document." }
    }

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
    return {
      ...submissionResult(status, pipeline, raw),
      ...(typeof recordedAt === "string" ? { transmittedAt: recordedAt } : {}),
    }
  } catch (e) {
    if (e instanceof ZatcaSigningError) return { success: false, error: e.message }
    return { success: false, error: e instanceof Error ? e.message : "Unexpected error." }
  }
}
