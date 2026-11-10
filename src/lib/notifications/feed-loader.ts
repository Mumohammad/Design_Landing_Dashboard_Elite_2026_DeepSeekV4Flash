import "server-only"

// Shared tenant feed loader for the in-app bell (caller RLS client) and the
// scheduled management digest (service-role client). Every query is pinned to
// the tenant explicitly, so the service-role path cannot cross tenants; with
// the RLS client the policies apply on top. A missing table or a module the
// role cannot read contributes no items instead of failing the whole feed.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buildNotificationFeed,
  NOTIFICATION_HORIZON_DAYS,
  type DriverExpiryRow,
  type EntityDocumentRow,
  type MaintenanceDueRow,
  type NotificationCategory,
  type NotificationFeed,
  type OverdueReceivableRow,
  type PayableDueRow,
  type VehicleExpiryRow,
  type VehicleInspectionRow,
} from "./feed-utils"

const OPEN_VIOLATION_STATUS = ["open", "under_review", "acknowledged", "disputed", "escalated"]

function shift(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

async function safe<T>(fn: () => PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

type Embedded = { full_name_ar?: string | null; full_name_en?: string | null; plate_number?: string | null }
function one(v: Embedded | Embedded[] | null | undefined): Embedded | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

export interface LoadFeedOptions {
  /** "user" = RLS caller (approvals via the caller-bound RPC); "service" = digest. */
  mode: "user" | "service"
  horizonDays?: number
  categories?: NotificationCategory[]
  limit?: number
}

export async function loadTenantFeed(
  db: SupabaseClient,
  tenantId: string,
  todayIso: string,
  opts: LoadFeedOptions,
): Promise<NotificationFeed> {
  const horizonDays = opts.horizonDays ?? NOTIFICATION_HORIZON_DAYS
  const horizon = shift(todayIso, horizonDays)
  const want = (c: NotificationCategory) => !opts.categories || opts.categories.length === 0 || opts.categories.includes(c)

  const drivers = want("drivers")
    ? safe<DriverExpiryRow[]>(async () => {
        const { data, error } = await db
          .from("drivers")
          .select("id, full_name_ar, full_name_en, iqama_expiry_date, license_expiry_date, passport_expiry_date, contract_end")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .not("status", "in", "(terminated,blacklisted)")
          .or(`iqama_expiry_date.lte.${horizon},license_expiry_date.lte.${horizon},passport_expiry_date.lte.${horizon},contract_end.lte.${horizon}`)
          .limit(1000)
        return error ? [] : ((data ?? []) as DriverExpiryRow[])
      }, [])
    : Promise.resolve([])

  const driverDocuments = want("drivers")
    ? safe<EntityDocumentRow[]>(async () => {
        const { data, error } = await db
          .from("driver_documents")
          .select("id, driver_id, document_type, expiry_date, drivers(full_name_ar, full_name_en)")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .not("expiry_date", "is", null)
          .lte("expiry_date", horizon)
          .limit(1000)
        if (error) return []
        return (data ?? []).map((r) => {
          const owner = one(r.drivers as Embedded | Embedded[] | null)
          return {
            id: r.id as string,
            owner_id: r.driver_id as string,
            owner_label: owner?.full_name_ar || owner?.full_name_en || null,
            document_type: (r.document_type as string | null) ?? null,
            expiry_date: (r.expiry_date as string | null) ?? null,
          }
        })
      }, [])
    : Promise.resolve([])

  const vehicles = want("vehicles")
    ? safe<(VehicleExpiryRow & VehicleInspectionRow)[]>(async () => {
        const { data, error } = await db
          .from("vehicles")
          .select("id, plate_number, insurance_expiry, registration_expiry, operating_card_expiry, rental_contract_end, inspection_expiry")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .or(`insurance_expiry.lte.${horizon},registration_expiry.lte.${horizon},operating_card_expiry.lte.${horizon},rental_contract_end.lte.${horizon},inspection_expiry.lte.${horizon}`)
          .limit(1000)
        return error ? [] : ((data ?? []) as (VehicleExpiryRow & VehicleInspectionRow)[])
      }, [])
    : Promise.resolve([])

  const vehicleDocuments = want("vehicles")
    ? safe<EntityDocumentRow[]>(async () => {
        const { data, error } = await db
          .from("vehicle_documents")
          .select("id, vehicle_id, document_type, expiry_date, vehicles(plate_number)")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .eq("is_active", true)
          .not("expiry_date", "is", null)
          .lte("expiry_date", horizon)
          .limit(1000)
        if (error) return []
        return (data ?? []).map((r) => ({
          id: r.id as string,
          owner_id: r.vehicle_id as string,
          owner_label: one(r.vehicles as Embedded | Embedded[] | null)?.plate_number ?? null,
          document_type: (r.document_type as string | null) ?? null,
          expiry_date: (r.expiry_date as string | null) ?? null,
        }))
      }, [])
    : Promise.resolve([])

  const maintenance = want("maintenance")
    ? safe<MaintenanceDueRow[]>(async () => {
        const { data, error } = await db
          .from("vehicle_maintenance_events")
          .select("vehicle_id, next_service_date, vehicles(plate_number)")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .neq("status", "cancelled")
          .not("next_service_date", "is", null)
          .gte("next_service_date", shift(todayIso, -365))
          .limit(2000)
        if (error) return []
        return (data ?? []).map((r) => ({
          vehicle_id: r.vehicle_id as string,
          plate_number: one(r.vehicles as Embedded | Embedded[] | null)?.plate_number ?? null,
          next_service_date: (r.next_service_date as string | null) ?? null,
        }))
      }, [])
    : Promise.resolve([])

  const receivables = want("finance")
    ? safe<OverdueReceivableRow[]>(async () => {
        const { data, error } = await db
          .from("receivables")
          .select("id, invoice_ref, due_date, total_amount, paid_amount")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .in("status", ["open", "partially_paid", "overdue"])
          .lt("due_date", todayIso)
          .limit(500)
        return error ? [] : ((data ?? []) as OverdueReceivableRow[])
      }, [])
    : Promise.resolve([])

  const payables = want("finance")
    ? safe<PayableDueRow[]>(async () => {
        const { data, error } = await db
          .from("payables")
          .select("id, invoice_ref, due_date, total_amount, paid_amount")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .in("status", ["open", "partially_paid", "overdue"])
          .lte("due_date", shift(todayIso, 7))
          .limit(500)
        return error ? [] : ((data ?? []) as PayableDueRow[])
      }, [])
    : Promise.resolve([])

  const violations = want("violations")
    ? safe<number>(async () => {
        const { count, error } = await db
          .from("violations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .in("status", OPEN_VIOLATION_STATUS)
        return error ? 0 : (count ?? 0)
      }, 0)
    : Promise.resolve(0)

  const approvals = want("approvals")
    ? opts.mode === "user"
      ? safe<number>(async () => {
          const { data, error } = await db.rpc("fetch_pending_approvals", {
            p_tenant_id: tenantId,
            p_type: null,
            p_from: null,
            p_to: null,
            p_limit: 100,
          })
          return error || !Array.isArray(data) ? 0 : data.length
        }, 0)
      : safe<number>(async () => {
          const head = { count: "exact" as const, head: true }
          const [e, l, a] = await Promise.all([
            db.from("expenses").select("id", head).eq("tenant_id", tenantId).is("deleted_at", null).eq("is_approved", false).is("rejected_at", null),
            db.from("driver_leave_requests").select("id", head).eq("tenant_id", tenantId).is("deleted_at", null).eq("status", "pending"),
            db.from("driver_applications").select("id", head).eq("tenant_id", tenantId).in("status", ["submitted", "under_review"]),
          ])
          return (e.error ? 0 : (e.count ?? 0)) + (l.error ? 0 : (l.count ?? 0)) + (a.error ? 0 : (a.count ?? 0))
        }, 0)
    : Promise.resolve(0)

  const [d, dd, v, vd, m, r, p, vio, ap] = await Promise.all([
    drivers, driverDocuments, vehicles, vehicleDocuments, maintenance, receivables, payables, violations, approvals,
  ])

  return buildNotificationFeed({
    todayIso,
    horizonDays,
    categories: opts.categories,
    limit: opts.limit,
    drivers: d,
    driverDocuments: dd,
    vehicles: v,
    vehicleInspections: v,
    vehicleDocuments: vd,
    maintenance: m,
    receivables: r,
    payables: p,
    openViolations: vio,
    pendingApprovals: ap,
  })
}
