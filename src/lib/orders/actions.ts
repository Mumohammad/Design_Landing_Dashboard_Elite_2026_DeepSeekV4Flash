"use server"

// Server Actions for the Orders module (Module 5 / 10 — daily_order_entries).
//
// The permission catalog has no standalone `orders` module — the v2.0 spec
// groups "Orders & Platforms" as Module 10, so order actions are gated under
// the existing `platforms` module (read/create/update/delete/export).
//
// - createOrderEntry  — platforms:create → inserts a daily order entry + audit
// - deleteOrderEntry  — platforms:delete → soft-deletes an entry + audit
// - exportOrdersCsv   — platforms:export → BOM CSV of the period + audit

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { toCsv } from "@/lib/accounting/csv-utils"
import { orderEntryCreateSchema, type OrderEntryCreateInput } from "@/types/orders"

export type ActionResult = { success: boolean; error?: string; id?: string }
export type ExportResult = { success: boolean; csv?: string; error?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

/**
 * Create a daily order entry for the current tenant.
 * platforms:create. Validates with the canonical orderEntryCreateSchema
 * (driver/platform/date required, non-negative counts and revenue).
 */
export async function createOrderEntry(input: OrderEntryCreateInput): Promise<ActionResult> {
  try {
    await requirePermission("platforms", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = orderEntryCreateSchema.parse(input)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("daily_order_entries")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        driver_id: parsed.driver_id,
        platform_id: parsed.platform_id,
        entry_date: parsed.entry_date,
        shift_label: parsed.shift_label?.trim() || null,
        orders_delivered: parsed.orders_delivered ?? 0,
        orders_failed: parsed.orders_failed ?? 0,
        orders_returned: parsed.orders_returned ?? 0,
        orders_cancelled: parsed.orders_cancelled ?? 0,
        total_distance_km: parsed.total_distance_km ?? null,
        avg_order_distance_km: parsed.avg_order_distance_km ?? null,
        multi_order_batches: parsed.multi_order_batches ?? 0,
        gross_revenue: parsed.gross_revenue ?? 0,
        platform_reported_revenue: parsed.platform_reported_revenue ?? null,
        notes: parsed.notes?.trim() || null,
        entry_source: "manual",
        is_locked: parsed.is_locked ?? false,
      })
      .select("id")
      .single()

    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "order_entry_created",
      entityType: "daily_order_entries",
      entityId: data.id,
      newValues: {
        entry_date: parsed.entry_date,
        driver_id: parsed.driver_id,
        platform_id: parsed.platform_id,
        orders_delivered: parsed.orders_delivered ?? 0,
        gross_revenue: parsed.gross_revenue ?? 0,
      },
    })

    revalidatePath("/orders")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Soft-delete a daily order entry (no DELETE policy — the 4-policy pattern).
 * platforms:delete. Audits the deletion.
 */
export async function deleteOrderEntry(id: string): Promise<ActionResult> {
  try {
    await requirePermission("platforms", "delete")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("daily_order_entries")
      .update({ deleted_at: new Date().toISOString(), updated_by: currentUser.authUserId })
      .eq("id", id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .select("id")
      .single()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Order entry not found." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "order_entry_deleted",
      entityType: "daily_order_entries",
      entityId: id,
      newValues: { deleted: true },
    })

    revalidatePath("/orders")
    return { success: true, id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

type OrderRow = {
  entry_date: string
  shift_label: string | null
  drivers?: { full_name_ar: string | null; full_name_en: string | null } | null
  delivery_platforms?: { name_ar: string | null; name_en: string | null } | null
  orders_delivered: number
  orders_failed: number
  orders_returned: number
  orders_cancelled: number
  total_distance_km: number | null
  gross_revenue: number
  platform_reported_revenue: number | null
  revenue_variance: number
  is_locked: boolean
}

/**
 * Export the daily order entries for a given month as a BOM CSV.
 * platforms:export. Audits the export.
 */
export async function exportOrdersCsv(month: string): Promise<ExportResult> {
  try {
    await requirePermission("platforms", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const [yearStr, monthStr] = month.split("-")
    const year = Number(yearStr)
    const mon = Number(monthStr)
    if (!year || !mon || mon < 1 || mon > 12) return { success: false, error: "Invalid month." }

    const start = `${year}-${String(mon).padStart(2, "0")}-01`
    const end = `${year}-${String(mon).padStart(2, "0")}-31`

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("daily_order_entries")
      .select(
        "entry_date,shift_label,orders_delivered,orders_failed,orders_returned,orders_cancelled,total_distance_km,gross_revenue,platform_reported_revenue,revenue_variance,is_locked," +
          "drivers(full_name_ar,full_name_en),delivery_platforms(name_ar,name_en)"
      )
      .eq("tenant_id", currentUser.tenantId)
      .gte("entry_date", start)
      .lte("entry_date", end)
      .is("deleted_at", null)
      .order("entry_date", { ascending: true })
    if (error) return { success: false, error: error.message }

    const rows = (data as unknown as OrderRow[] | null) ?? []
    const csv =
      "\uFEFF" +
      toCsv(
        ["Date", "Shift", "Driver", "Platform", "Delivered", "Failed", "Returned", "Cancelled", "Distance (km)", "Revenue", "Platform Reported", "Variance", "Locked"],
        rows.map((r) => [
          r.entry_date,
          r.shift_label ?? "",
          r.drivers?.full_name_en ?? r.drivers?.full_name_ar ?? "",
          r.delivery_platforms?.name_en ?? r.delivery_platforms?.name_ar ?? "",
          r.orders_delivered,
          r.orders_failed,
          r.orders_returned,
          r.orders_cancelled,
          r.total_distance_km ?? "",
          r.gross_revenue,
          r.platform_reported_revenue ?? "",
          r.revenue_variance,
          r.is_locked ? "locked" : "open",
        ])
      )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "order_entries_exported",
      entityType: "daily_order_entries",
      entityId: null,
      newValues: { month, rows: rows.length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
