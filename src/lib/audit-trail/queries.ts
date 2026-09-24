"use server"

// Read queries for the Audit-Trail surface (Prompt D) — the /audit-log page.
//
// Server-side only: audit_log is a Phase-A core table with SELECT-only RLS
// for end users (ADR-007 append-only; INSERT is service-role-only via
// writeAuditLog()). Reads flow through the service-role admin client after
// requirePermission() — same pattern as src/lib/auth/user-reads.ts, whose
// fetchAuditLog() this module supersedes for the audit surface (the stub page
// it fed did no server-side filtering). READ-ONLY module: nothing here
// writes any table.
//
// Filtering happens server-side (RPC) so pagination caps stay honest: the
// client only ever sees one capped page of the filtered set.

import { requirePermission, getCurrentUser } from "@/lib/auth/authorization"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  dateRangeBounds,
} from "./audit-utils"

export type AuditTrailRow = {
  id: string
  created_at: string
  module: string
  action: string
  entity_type: string | null
  entity_id: string | null
  actor_id: string | null
  ip_address: string | null
  reason: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
}

export type AuditActor = {
  id: string // custom users row id (stable join key for audit_log.actor_id)
  name: string
}

export type AuditTrailPageData = {
  rows: AuditTrailRow[]
  actorOptions: AuditActor[]
  actorsConsented: Record<string, boolean> // users.id -> has PDPL terms consent
  kpis: { total: number; distinctActors: number; distinctEntities: number }
  pageSize: number
  actorNames: Record<string, string> // auth.users UUID -> display name
}

export type AuditTrailFilters = {
  from?: string
  to?: string
  actor?: string // users.id | "all"
  action?: string
  module?: string
  entityType?: string
  entityId?: string
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

/**
 * Fetch one capped page of audit events with server-side filters applied.
 * Requires `audit_log.read` (GM bypasses). Returns actor display names,
 * actor picker options, and per-actor PDPL consent so the UI can mask
 * metadata rendered for consent-absent actors.
 */
export async function fetchAuditTrailPage(
  filters: AuditTrailFilters = {},
  pageSize = AUDIT_PAGE_SIZE_DEFAULT
): Promise<AuditTrailPageData> {
  await requirePermission("audit_log", "read")

  const currentUser = await getCurrentUser()
  if (!currentUser) {
    return { rows: [], actorOptions: [], actorsConsented: {}, kpis: { total: 0, distinctActors: 0, distinctEntities: 0 }, pageSize: AUDIT_PAGE_SIZE_DEFAULT, actorNames: {} }
  }

  const cap = Math.min(Math.max(1, Math.floor(pageSize)), AUDIT_PAGE_SIZE_MAX)
  const admin = createAdminClient()

  const actorId =
    filters.actor && filters.actor !== "all" && isUuid(filters.actor) ? filters.actor : null
  const entityType =
    filters.entityType && filters.entityType !== "all" ? filters.entityType : null
  const { fromIso, toIso } = dateRangeBounds(filters.from ?? "", filters.to ?? "")

  // Server-side filtered page (RLS-equivalent tenant scoping explicit on the
  // definer function args; caps applied in SQL).
  let rows: AuditTrailRow[] = []
  try {
    const { data, error } = await admin.rpc("fetch_audit_trail_page", {
      p_tenant_id: currentUser.tenantId,
      p_from: fromIso,
      p_to: toIso,
      p_actor_user_id: actorId,
      p_action: filters.action && filters.action !== "all" ? filters.action : null,
      p_module: filters.module && filters.module !== "all" ? filters.module : null,
      p_entity_type: entityType,
      p_entity_id:
        filters.entityId && isUuid(filters.entityId) ? filters.entityId : null,
      p_limit: cap,
    })
    if (error) throw error
    rows = (data ?? []) as unknown as AuditTrailRow[]
  } catch (e) {
    console.error("[audit-trail] fetchAuditTrailPage failed:", e)
    return { rows: [], actorOptions: [], actorsConsented: {}, kpis: { total: 0, distinctActors: 0, distinctEntities: 0 }, pageSize: cap, actorNames: {} }
  }

  // Actor picker: everyone who ever audited in this tenant (also drives the
  // masking consent batch). Display names resolve through users.auth_user_id.
  const { data: actorRows } = await admin
    .from("users")
    .select("id, auth_user_id, full_name_ar, full_name_en, email")
    .eq("tenant_id", currentUser.tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  const allActors: AuditActor[] = (actorRows ?? []).map((u) => {
    const r = u as Record<string, unknown>
    return {
      id: r.id as string,
      name:
        (r.full_name_ar as string | null) ??
        (r.full_name_en as string | null) ??
        (r.email as string),
    }
  })

  // auth.users UUID -> display name (audit_log.actor_id is an auth.users FK).
  const actorNames: Record<string, string> = {}
  // Join maps between the two id spaces: audit rows carry auth.users UUIDs,
  // the consent RPC and picker options work on custom users.id values.
  const usersIdByAuthId = new Map<string, string>()
  const authIdByUsersId = new Map<string, string>()
  for (const u of actorRows ?? []) {
    const r = u as Record<string, unknown>
    actorNames[r.auth_user_id as string] =
      (r.full_name_ar as string | null) ?? (r.full_name_en as string | null) ?? (r.email as string)
    usersIdByAuthId.set(r.auth_user_id as string, r.id as string)
    authIdByUsersId.set(r.id as string, r.auth_user_id as string)
  }

  // Batch PDPL consent (avoids per-actor RPC round trips on the page).
  const consented: Record<string, boolean> = {}
  const relevantAuthIds = new Set<string>()
  for (const row of rows) if (row.actor_id) relevantAuthIds.add(row.actor_id)
  for (const a of allActors) {
    const authId = authIdByUsersId.get(a.id)
    if (authId) relevantAuthIds.add(authId)
  }
  for (const authId of relevantAuthIds) {
    const pUserId = usersIdByAuthId.get(authId)
    if (!pUserId) {
      consented[authId] = false
      continue
    }
    try {
      const { data: consent, error: consentError } = await admin.rpc("has_user_pdpl_consent", {
        p_user_id: pUserId,
        p_consent_type: "terms",
      })
      consented[authId] = !consentError && consent === true
    } catch {
      consented[authId] = false
    }
  }

  const distinctActors = new Set(rows.map((r) => r.actor_id).filter(Boolean)).size
  const distinctEntities = new Set(
    rows.map((r) => (r.entity_type && r.entity_id ? `${r.entity_type}:${r.entity_id}` : "")).filter(Boolean)
  ).size

  return {
    rows,
    actorOptions: allActors,
    actorsConsented: consented,
    kpis: { total: rows.length, distinctActors, distinctEntities },
    pageSize: cap,
    actorNames,
  }
}
