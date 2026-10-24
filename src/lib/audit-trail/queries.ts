"use server"

// Reads use the caller-bound, tenant-filtered projection. Actor labels are
// identifiers already on this page, never a privileged user directory.
import { can, requirePermission, getCurrentUser } from "@/lib/auth/authorization"
import { createClient } from "@/lib/supabase/server"
import { AUDIT_PAGE_SIZE_DEFAULT, AUDIT_PAGE_SIZE_MAX, dateRangeBounds } from "./audit-utils"

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

export type AuditActor = { id: string; name: string }

export type AuditTrailPageData = {
  rows: AuditTrailRow[]
  actorOptions: AuditActor[]
  actorsConsented: Record<string, boolean>
  kpis: { total: number; distinctActors: number; distinctEntities: number }
  pageSize: number
  actorNames: Record<string, string>
  canExport: boolean
}

export type AuditTrailFilters = {
  from?: string
  to?: string
  actor?: string // auth actor UUID from the returned page, or "all"
  action?: string
  module?: string
  entityType?: string
  entityId?: string
}

const READ_ERROR = "Could not load the audit trail. Refresh and try again."

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

function isMetadata(v: unknown): v is Record<string, unknown> | null {
  return v === null || (typeof v === "object" && !Array.isArray(v))
}

function projectRow(value: unknown): AuditTrailRow {
  if (!value || typeof value !== "object") throw new Error(READ_ERROR)
  const r = value as Record<string, unknown>
  const nullableText = ["entity_type", "entity_id", "actor_id", "ip_address", "reason"]
  if (typeof r.id !== "string" || !isUuid(r.id) ||
      typeof r.created_at !== "string" || !Number.isFinite(Date.parse(r.created_at)) ||
      typeof r.module !== "string" || typeof r.action !== "string" ||
      nullableText.some((key) => r[key] !== null && typeof r[key] !== "string") ||
      (r.actor_id !== null && !isUuid(r.actor_id as string)) ||
      !isMetadata(r.old_values) || !isMetadata(r.new_values)) throw new Error(READ_ERROR)
  return {
    id: r.id, created_at: r.created_at, module: r.module, action: r.action,
    entity_type: r.entity_type as string | null, entity_id: r.entity_id as string | null,
    actor_id: r.actor_id as string | null, ip_address: r.ip_address as string | null,
    reason: r.reason as string | null, old_values: r.old_values, new_values: r.new_values,
  }
}

async function readPage(
  filters: AuditTrailFilters,
  pageSize: number,
  canExport: boolean
): Promise<AuditTrailPageData> {
  const currentUser = await getCurrentUser()
  if (!currentUser) throw new Error(READ_ERROR)
  // Never silently broaden an invalid actor/entity filter for a read or export.
  if ((filters.actor && filters.actor !== "all" && !isUuid(filters.actor)) ||
      (filters.entityId && !isUuid(filters.entityId))) throw new Error(READ_ERROR)
  const cap = Number.isFinite(pageSize)
    ? Math.min(Math.max(1, Math.floor(pageSize)), AUDIT_PAGE_SIZE_MAX)
    : AUDIT_PAGE_SIZE_DEFAULT
  const { fromIso, toIso } = dateRangeBounds(filters.from ?? "", filters.to ?? "")
  let rows: AuditTrailRow[]
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("fetch_audit_trail_page", {
      p_tenant_id: currentUser.tenantId,
      p_from: fromIso, p_to: toIso,
      p_actor_user_id: filters.actor && filters.actor !== "all" ? filters.actor : null,
      p_action: filters.action && filters.action !== "all" ? filters.action : null,
      p_module: filters.module && filters.module !== "all" ? filters.module : null,
      p_entity_type: filters.entityType && filters.entityType !== "all" ? filters.entityType : null,
      p_entity_id: filters.entityId || null,
      p_limit: cap,
    })
    if (error || !Array.isArray(data) || data.length > cap) throw new Error(READ_ERROR)
    rows = data.map(projectRow)
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error(READ_ERROR)
  } catch {
    // Provider diagnostics can contain raw audit payloads; do not expose or log them.
    throw new Error(READ_ERROR)
  }

  const actors = Array.from(new Set(rows.flatMap((row) => row.actor_id ? [row.actor_id] : [])))
  const actorNames: Record<string, string> = {}
  for (const id of actors) actorNames[id] = id
  const distinctEntities = new Set(rows.flatMap((row) =>
    row.entity_type && row.entity_id ? [row.entity_type + ":" + row.entity_id] : []
  )).size
  return {
    rows,
    actorOptions: actors.map((id) => ({ id, name: actorNames[id] })),
    // SQL already provides a minimal projection. Keep client masking conservative
    // without fetching consent decisions or identities from a user directory.
    actorsConsented: {},
    kpis: { total: rows.length, distinctActors: actors.length, distinctEntities },
    pageSize: cap, actorNames, canExport,
  }
}

/** One capped, filtered page; read access never implies export access. */
export async function fetchAuditTrailPage(
  filters: AuditTrailFilters = {},
  pageSize = AUDIT_PAGE_SIZE_DEFAULT
): Promise<AuditTrailPageData> {
  await requirePermission("audit_log", "read")
  const canExport = await can("audit_log", "export").then((permission) => permission.allowed).catch(() => false)
  return readPage(filters, pageSize, canExport)
}

/** Reauthorize every product export, using the same safe filtered page RPC. */
export async function exportAuditTrailPage(
  filters: AuditTrailFilters = {},
  pageSize = AUDIT_PAGE_SIZE_DEFAULT
): Promise<AuditTrailPageData> {
  await requirePermission("audit_log", "export")
  await requirePermission("audit_log", "read")
  return readPage(filters, pageSize, true)
}
