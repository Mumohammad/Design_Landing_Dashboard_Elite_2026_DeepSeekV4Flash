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
const BACKLOG_PAGE_SIZE = 100
const STATUS_UNAVAILABLE = "Unable to verify ZATCA status. Reload before continuing."

function docRefFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const p = payload as Record<string, unknown>
  const ref = p.invoice_number ?? p.note_number ?? p.credit_note_number ?? p.debit_note_number ?? p.doc_ref ?? p.number
  return typeof ref === "string" ? ref : null
}

async function loadBacklog(
  admin: ReturnType<typeof createAdminClient>, tenantId: string,
  environment: "sandbox" | "simulation", goLiveAt: string,
) {
  const events: BacklogEvent[] = []
  const transmissions: BacklogTransmission[] = []
  let cursor: string | null = null
  for (;;) {
    let query = admin.from("financial_events").select("id,source_id,event_type,created_at,payload")
      .eq("tenant_id", tenantId).in("event_type", EVENT_TYPES).gte("created_at", goLiveAt)
      .order("id", { ascending: true }).limit(BACKLOG_PAGE_SIZE)
    if (cursor) query = query.gt("id", cursor)
    const { data: page, error } = await query
    if (error || !page) throw new Error(STATUS_UNAVAILABLE)
    if (!page.length) break
    const ids = [...new Set(page.map(event => event.source_id as string))]
    const result = await admin.from("zatca_transmissions")
      .select("source_id,doc_type,status,error_message,environment:response->>environment")
      .eq("tenant_id", tenantId).in("source_id", ids)
    if (result.error || !result.data) throw new Error(STATUS_UNAVAILABLE)
    transmissions.push(...result.data.filter(row => row.environment === environment) as BacklogTransmission[])
    for (const row of page) events.push({
      source_id: row.source_id, event_type: row.event_type, created_at: row.created_at,
      doc_ref: docRefFromPayload(row.payload),
    })
    if (page.length < BACKLOG_PAGE_SIZE) break
    cursor = page[page.length - 1].id
  }
  return computeZatcaBacklog(events, transmissions)
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


    const [tenantRes, streamRes, csidRes, automationRes] = await Promise.all([
      admin.from("tenants")
        .select("name_ar,name_en,legal_name,vat_number,cr_number,address,city,region,district,building_number,additional_number,postal_code,country")
        .eq("id", tenantId).maybeSingle<TenantPartyRow>(),
      admin.from("zatca_issuance_streams")
        .select("egs_serial,environment,last_counter,created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: true }),
      admin.from("zatca_csids")
        .select("environment,kind,status,expires_at")
        .eq("tenant_id", tenantId),
      admin.from("zatca_automation")
        .select("enabled,last_run_at,last_result")
        .eq("tenant_id", tenantId).maybeSingle(),
    ])
    if ([tenantRes, streamRes, csidRes, automationRes].some(result => result.error)) {
      return { success: false, error: STATUS_UNAVAILABLE }
    }

    const seller = tenantRes.data ? sellerParty(tenantRes.data) : null
    const profileMissing = seller ? missingNationalAddress(seller, "seller", "standard") : ["tenant"]
    const vatValid = !!seller?.vatNumber && ZATCA_VAT_RE.test(seller.vatNumber)

    const streams = (streamRes.data ?? []) as { egs_serial: string; environment: string; last_counter: number; created_at: string }[]
    const goLiveAt = streams.find((st) => st.environment === environment)?.created_at ?? null
    const backlog = enabled && environment && goLiveAt && !configurationError
      ? await loadBacklog(admin, tenantId, environment, goLiveAt)
      : { pending: 0, overdue: 0, items: [] }

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
