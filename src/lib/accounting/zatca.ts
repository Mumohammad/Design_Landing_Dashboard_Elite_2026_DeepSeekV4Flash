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
