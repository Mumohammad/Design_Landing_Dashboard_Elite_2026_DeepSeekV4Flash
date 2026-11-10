"use server"

// Financial Phase 15 — ZATCA adapter Server Actions. The pipeline itself
// (events → prepare → sign → clear/report → record) lives in
// zatca-adapter-core.ts so the scheduled backstop can reuse it.
//
// Permission: accounting:approve to run, accounting:read for details.

import { integrationAvailable, INTEGRATION_UNAVAILABLE } from "@/lib/release/integrations"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { mapFinancialError } from "@/lib/accounting/csv-utils"
import { isMockZatcaResponse } from "./zatca-evidence"
import { writeAuditLog } from "@/lib/auth/sessions"
import { runZatcaAdapterAs, type ZatcaAdapterSummary } from "./zatca-adapter-core"

export type { ZatcaAdapterSummary } from "./zatca-adapter-core"

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

/**
 * Run the ZATCA adapter for the signed-in user's tenant. Never throws —
 * returns a summary.
 */
export async function runZatcaAdapter(): Promise<ZatcaAdapterSummary> {
  if (!integrationAvailable("zatca")) return { success: false, error: INTEGRATION_UNAVAILABLE }
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    return await runZatcaAdapterAs(currentUser)
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Per-document "Send to ZATCA" (Daftra-style): submit one finalized sales
 * invoice, credit note or debit note through the connected (non-production)
 * gateway. Already reported/cleared documents are idempotent no-ops.
 */
export async function sendDocumentToZatca(sourceId: string): Promise<ZatcaAdapterSummary> {
  if (!integrationAvailable("zatca")) return { success: false, error: INTEGRATION_UNAVAILABLE }
  if (typeof sourceId !== "string" || !UUID_RE.test(sourceId)) return { success: false, error: "Invalid document." }
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const admin = createAdminClient()
    const { data: stream } = await admin.from("zatca_issuance_streams")
      .select("egs_serial").eq("tenant_id", currentUser.tenantId).limit(1).maybeSingle()
    if (!stream) return { success: false, error: "Connect ZATCA (onboard the EGS unit) before sending documents." }
    return await runZatcaAdapterAs(currentUser, { sourceIds: [sourceId] })
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Toggle automatic submission (Daftra-style "send to ZATCA on save"). The
 * signed-in approver becomes the tenant's ZATCA operator for the immediate
 * post-finalization submission and the scheduled backstop.
 */
export async function setZatcaAutoSend(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  if (!integrationAvailable("zatca")) return { success: false, error: INTEGRATION_UNAVAILABLE }
  if (typeof enabled !== "boolean") return { success: false, error: "Invalid setting." }
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const admin = createAdminClient()
    if (enabled) {
      const { data: stream } = await admin.from("zatca_issuance_streams")
        .select("egs_serial").eq("tenant_id", currentUser.tenantId).limit(1).maybeSingle()
      if (!stream) return { success: false, error: "Connect ZATCA (onboard the EGS unit) before enabling automatic submission." }
    }
    const { error } = await admin.from("zatca_automation").upsert({
      tenant_id: currentUser.tenantId, operator_id: currentUser.authUserId, enabled, updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    await writeAuditLog({
      tenantId: currentUser.tenantId, actorId: currentUser.authUserId, module: "accounting",
      action: "zatca_auto_send_changed", entityType: "zatca_automation", newValues: { enabled },
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Load a single transmission (payload + response) for the UI detail view.
 * Explicit tenant scope: the service-role client bypasses RLS.
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
    mock: boolean
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
    // Gateway bodies can contain sensitive echoed fields. The detail UI needs
    // only the evidence classification, never an arbitrary raw response.
    const { response, ...document } = data
    return { success: true, transmission: { ...document, mock: isMockZatcaResponse(response) } }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
