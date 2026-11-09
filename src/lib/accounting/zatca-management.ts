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
import { zatcaConfiguredEnvironment, zatcaProductionAvailable } from "./zatca-config"
import { createClient } from "@/lib/supabase/server"
import { rateLimitAccounting } from "@/lib/auth/rate-limit"
import { ZATCA_PRODUCTION_BLOCKED, ZATCA_ENVIRONMENT_UNAVAILABLE, getZatcaNetworkBase } from "./zatca-config"
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
  configurationVersion: number
  canManageProduction: boolean
  productionBlockedReason: string
  configurationError: string | null
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
    const caller = await createClient()
    const {data:envRow,error:envError} = await caller.rpc("read_my_zatca_environment")
    if(envError || !envRow || typeof envRow.production_enabled!=="boolean" || !Number.isSafeInteger(envRow.configuration_version) || envRow.configuration_version<1 || typeof envRow.can_manage!=="boolean" || (envRow.changed_at !== null && (typeof envRow.changed_at !== "string" || !Number.isFinite(Date.parse(envRow.changed_at))))) throw new Error(ZATCA_ENVIRONMENT_UNAVAILABLE)
    const productionEnabled = envRow.production_enabled
    let configurationError: string | null = null
    try { getZatcaNetworkBase() } catch { configurationError = "ZATCA gateway configuration is unavailable. Production remains blocked." }
    const environment = productionEnabled ? null : testEnvironment


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
        enabled: enabled && !productionEnabled && !configurationError,
        mode: enabled && !productionEnabled && !configurationError && goLiveAt ? "connected" : "local",
        environment,
        testEnvironment,
        productionAvailable,
        productionEnabled,
        productionChangedAt: envRow.changed_at ?? null,
        configurationVersion: envRow.configuration_version,
        canManageProduction: envRow.can_manage,
        productionBlockedReason: ZATCA_PRODUCTION_BLOCKED,
        configurationError,
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


export type ZatcaSwitchCode = "ZATCA_SWITCH_INVALID" | "ZATCA_SWITCH_FORBIDDEN" | "ZATCA_SWITCH_STALE" | "ZATCA_SWITCH_UNAVAILABLE" | "ZATCA_SWITCH_RATE_LIMIT" | "ZATCA_PRODUCTION_BLOCKED"
export type ZatcaSwitchResult =
  | { success: true; configurationVersion: number; productionEnabled: false; requestId: string; replayed: boolean }
  | { success: false; error: string; code: ZatcaSwitchCode }

function switchFailure(code: ZatcaSwitchCode): ZatcaSwitchResult {
  const messages: Record<ZatcaSwitchCode, string> = {
    ZATCA_SWITCH_INVALID: "Invalid ZATCA setting or request identity.",
    ZATCA_SWITCH_FORBIDDEN: "You do not have permission to change the ZATCA setting.",
    ZATCA_SWITCH_STALE: "Company configuration changed. Reload and review before saving.",
    ZATCA_SWITCH_UNAVAILABLE: "The save result could not be confirmed. Reload and review before retrying.",
    ZATCA_SWITCH_RATE_LIMIT: "Too many attempts. Wait before retrying.",
    ZATCA_PRODUCTION_BLOCKED,
  }
  return { success: false, code, error: messages[code] }
}

function switchCode(error: unknown): ZatcaSwitchCode {
  if (error && typeof error === "object") {
    const e = error as { message?: string; code?: string }
    if (e.code === "AUTH007") return "ZATCA_SWITCH_FORBIDDEN"
    if (["ZATCA_SWITCH_INVALID", "ZATCA_SWITCH_FORBIDDEN", "ZATCA_SWITCH_STALE", "ZATCA_PRODUCTION_BLOCKED"].includes(e.message ?? "")) return e.message as ZatcaSwitchCode
  }
  return "ZATCA_SWITCH_UNAVAILABLE"
}

/** Caller-bound recovery switch. Production ON is unavailable in this release. */
export async function setZatcaProductionMode(enabled: boolean, expectedVersion: number, requestId: string, acknowledgement?: string): Promise<ZatcaSwitchResult> {
  try {
    await requirePermission("accounting", "approve")
    const user = await getCurrentUser()
    if (!user) return switchFailure("ZATCA_SWITCH_FORBIDDEN")
    if (typeof enabled !== "boolean" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= Number.MAX_SAFE_INTEGER ||
        typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) return switchFailure("ZATCA_SWITCH_INVALID")
    if (enabled) return switchFailure("ZATCA_PRODUCTION_BLOCKED")
    if (acknowledgement !== undefined) return switchFailure("ZATCA_SWITCH_INVALID")
    const limit = await rateLimitAccounting(user.id)
    if (!limit.success) return switchFailure("ZATCA_SWITCH_RATE_LIMIT")
    const caller = await createClient()
    const { data, error } = await caller.rpc("save_my_zatca_environment", {
      p_request_id: requestId, p_expected_version: expectedVersion, p_enabled: false, p_acknowledgement: null,
    })
    if (error) return switchFailure(switchCode(error))
    if (!data || data.request_id !== requestId || data.production_enabled !== false || data.configuration_version !== expectedVersion + 1 ||
        !Number.isSafeInteger(data.configuration_version) || typeof data.replayed !== "boolean") return switchFailure("ZATCA_SWITCH_UNAVAILABLE")
    return { success: true, configurationVersion: data.configuration_version, productionEnabled: false, requestId, replayed: data.replayed }
  } catch (error) {
    return switchFailure(switchCode(error))
  }
}
