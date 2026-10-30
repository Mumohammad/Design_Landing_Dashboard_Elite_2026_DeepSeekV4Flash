"use server"

// ZATCA management status for the accounting page ZATCA tab. Everything the
// client needs to decide what to show is computed server-side: the client
// bundle never sees ZATCA_MODE / gateway URLs, so `integrationAvailable`
// cannot be evaluated in the browser.
//
// accounting:read. Never returns secrets, private keys or certificates.

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { integrationAvailable } from "@/lib/release/integrations"
import { ZATCA_PRODUCTION_ACK, zatcaConfiguredEnvironment, zatcaProductionAvailable } from "./zatca-config"
import { writeAuditLog } from "@/lib/auth/sessions"
import { daysUntil } from "./zatca-cert"
import { missingNationalAddress, sellerParty, ZATCA_VAT_RE, type TenantPartyRow } from "./zatca-adapter-input"
import { computeZatcaBacklog, type BacklogEvent, type BacklogTransmission, type ZatcaBacklogItem } from "./zatca-backlog"

export interface ZatcaStatus {
  enabled: boolean
  /**
   * "local": Phase 1 — e-invoices are generated and stored locally with the
   * simplified QR; nothing is sent to ZATCA. "connected": Phase 2 — an EGS unit
   * is onboarded on the configured non-production gateway.
   */
  mode: "local" | "connected"
  /** Effective environment for this tenant (production only when switched ON). */
  environment: "sandbox" | "simulation" | "production" | null
  /** The deployment's test environment (where tenants with production OFF work). */
  testEnvironment: "sandbox" | "simulation" | null
  /** This deployment allows tenants to switch to the production (core) gateway. */
  productionAvailable: boolean
  /** The tenant's production switch. */
  productionEnabled: boolean
  productionChangedAt: string | null
  profileMissing: string[]
  vatValid: boolean
  streams: { egsSerial: string; environment: string; lastCounter: number; createdAt: string }[]
  certificates: { environment: string; kind: string; status: string; expiresAt: string | null; daysLeft: number | null }[]
  backlog: { pending: number; overdue: number; items: ZatcaBacklogItem[] }
  /** Documents finalized before this time predate the EGS registration and are never submitted. */
  goLiveAt: string | null
  automation: { enabled: boolean; lastRunAt: string | null; lastResult: Record<string, unknown> | null } | null
}

const EVENT_TYPES = ["InvoiceFinalizedEvent", "CreditNoteIssuedEvent", "DebitNoteIssuedEvent"]
const BACKLOG_EVENT_LIMIT = 500

function docRefFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const p = payload as Record<string, unknown>
  const ref = p.invoice_number ?? p.credit_note_number ?? p.debit_note_number ?? p.doc_ref ?? p.number
  return typeof ref === "string" ? ref : null
}

export async function getZatcaStatus(): Promise<{ success: boolean; error?: string; status?: ZatcaStatus }> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const tenantId = currentUser.tenantId
    const enabled = integrationAvailable("zatca")
    const admin = createAdminClient()
    const testEnvironment = enabled ? zatcaConfiguredEnvironment() : null
    const productionAvailable = enabled && zatcaProductionAvailable()
    const { data: envRow } = await admin.from("zatca_tenant_environment")
      .select("production_enabled,changed_at").eq("tenant_id", tenantId)
      .maybeSingle<{ production_enabled: boolean; changed_at: string }>()
    const productionEnabled = productionAvailable && envRow?.production_enabled === true
    const environment = productionEnabled ? "production" : testEnvironment

    const [tenantRes, streamRes, csidRes, eventRes, automationRes] = await Promise.all([
      admin.from("tenants")
        .select("name_ar,name_en,legal_name,vat_number,cr_number,address,city,region,district,building_number,additional_number,postal_code,country")
        .eq("id", tenantId).maybeSingle<TenantPartyRow>(),
      admin.from("zatca_issuance_streams")
        .select("egs_serial,environment,last_counter,created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: true }),
      admin.from("zatca_csids")
        .select("environment,kind,status,expires_at")
        .eq("tenant_id", tenantId),
      admin.from("financial_events")
        .select("source_id,event_type,created_at,payload")
        .eq("tenant_id", tenantId).in("event_type", EVENT_TYPES)
        .order("created_at", { ascending: false }).limit(BACKLOG_EVENT_LIMIT),
      admin.from("zatca_automation")
        .select("enabled,last_run_at,last_result")
        .eq("tenant_id", tenantId).maybeSingle(),
    ])

    const seller = tenantRes.data ? sellerParty(tenantRes.data) : null
    const profileMissing = seller ? missingNationalAddress(seller, "seller", "standard") : ["tenant"]
    const vatValid = !!seller?.vatNumber && ZATCA_VAT_RE.test(seller.vatNumber)

    const streams = (streamRes.data ?? []) as { egs_serial: string; environment: string; last_counter: number; created_at: string }[]
    const goLiveAt = streams.find((st) => st.environment === environment)?.created_at ?? null
    const goLive = goLiveAt ? Date.parse(goLiveAt) : null
    const events: BacklogEvent[] = (eventRes.data ?? [])
      .filter((e) => goLive === null || Date.parse(e.created_at as string) >= goLive)
      .map((e) => ({
      source_id: e.source_id as string, event_type: e.event_type as string, created_at: e.created_at as string,
      doc_ref: docRefFromPayload(e.payload),
    }))
    let transmissions: BacklogTransmission[] = []
    const ids = [...new Set(events.map((e) => e.source_id))]
    if (ids.length) {
      const { data } = await admin.from("zatca_transmissions")
        .select("source_id,doc_type,status,error_message,created_at")
        .eq("tenant_id", tenantId).in("source_id", ids)
        .order("created_at", { ascending: true })
      transmissions = (data ?? []) as BacklogTransmission[]
    }
    // Backlog only applies once a gateway is configured; otherwise nothing is due.
    const backlog = enabled && goLiveAt ? computeZatcaBacklog(events, transmissions) : { pending: 0, overdue: 0, items: [] }

    return {
      success: true,
      status: {
        enabled,
        mode: enabled && goLiveAt ? "connected" : "local",
        environment,
        testEnvironment,
        productionAvailable,
        productionEnabled,
        productionChangedAt: envRow?.changed_at ?? null,
        profileMissing,
        vatValid,
        goLiveAt,
        automation: automationRes.data ? {
          enabled: !!automationRes.data.enabled,
          lastRunAt: (automationRes.data.last_run_at as string | null) ?? null,
          lastResult: (automationRes.data.last_result as Record<string, unknown> | null) ?? null,
        } : null,
        streams: streams.map((s) => ({
          egsSerial: s.egs_serial as string, environment: s.environment as string,
          lastCounter: Number(s.last_counter ?? 0), createdAt: s.created_at as string,
        })),
        certificates: (csidRes.data ?? []).map((c) => ({
          environment: c.environment as string, kind: c.kind as string, status: c.status as string,
          expiresAt: (c.expires_at as string | null) ?? null, daysLeft: daysUntil(c.expires_at as string | null),
        })),
        backlog: { ...backlog, items: backlog.items.slice(0, 50) },
      },
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to load ZATCA status." }
  }
}


/**
 * Per-tenant production switch (accounting:approve). ON moves this tenant's
 * onboarding, clearance and reporting to the ZATCA core (production) gateway
 * once a production EGS unit is onboarded with a real Fatoora OTP; documents
 * finalized before that EGS registration are never submitted. OFF returns the
 * tenant to the test gateway; documents already accepted by ZATCA stay valid.
 */
export async function setZatcaProductionMode(
  enabled: boolean, acknowledgement?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof enabled !== "boolean") return { success: false, error: "Invalid setting." }
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    if (enabled && !zatcaProductionAvailable()) {
      return { success: false, error: "ZATCA production is not enabled for this deployment. Ask the platform operator to set ZATCA_MODE=production and ZATCA_PRODUCTION_ENABLED=true." }
    }
    if (enabled && acknowledgement !== ZATCA_PRODUCTION_ACK) return { success: false, error: "Confirm the production acknowledgement to continue." }
    const admin = createAdminClient()
    if (enabled) {
      const { data: tenant } = await admin.from("tenants")
        .select("name_ar,name_en,legal_name,vat_number,cr_number,address,city,region,district,building_number,additional_number,postal_code,country")
        .eq("id", currentUser.tenantId).maybeSingle<TenantPartyRow>()
      const seller = tenant ? sellerParty(tenant) : null
      const missing = seller ? missingNationalAddress(seller, "seller", "standard") : ["tenant"]
      if (!seller?.vatNumber || !ZATCA_VAT_RE.test(seller.vatNumber) || missing.length) {
        return { success: false, error: `Complete the company tax profile before switching to production (${[...(seller?.vatNumber && ZATCA_VAT_RE.test(seller.vatNumber) ? [] : ["vatNumber"]), ...missing.filter((f) => f !== "vatNumber")].join(", ")}).` }
      }
    }
    const { error } = await admin.from("zatca_tenant_environment").upsert({
      tenant_id: currentUser.tenantId,
      production_enabled: enabled,
      changed_by: currentUser.authUserId,
      changed_at: new Date().toISOString(),
      acknowledgement: enabled ? ZATCA_PRODUCTION_ACK : null,
    }, { onConflict: "tenant_id" })
    if (error) return { success: false, error: "Unable to save the ZATCA production setting." }
    await writeAuditLog({
      tenantId: currentUser.tenantId, actorId: currentUser.authUserId, module: "accounting",
      action: enabled ? "zatca_production_enabled" : "zatca_production_disabled",
      entityType: "zatca_tenant_environment", newValues: { production_enabled: enabled },
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to change the ZATCA production setting." }
  }
}
