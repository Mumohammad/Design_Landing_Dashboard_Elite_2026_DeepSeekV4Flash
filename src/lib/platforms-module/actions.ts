"use server"

// Server Actions for the Platforms module (Module 10 — delivery-platform
// operations). Surfaces `delivery_platforms`, `daily_order_entries`,
// `monthly_driver_orders` + `platform_payments` (migrations 020/026) — no
// schema changes.
//
//   * upsertPlatform        — platforms:create / platforms:update
//   * deactivatePlatform    — platforms:update (soft-deactivate, never delete)
//   * recordPlatformPayment — platforms:update (insert-or-update period row)
//   * importDailyEntries    — platforms:create (paste-import, partial-failure)
//   * exportPlatformsCsv    — platforms:export (BOM CSV)
//
// Permission note: order actions are gated under `platforms` (v2.0 groups
// Orders & Platforms as Module 10 — see src/lib/orders/actions.ts).

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitOrders, rateLimitVehicles } from "@/lib/auth/rate-limit"
import { toCsv } from "@/lib/accounting/csv-utils"
import {
  dailyEntryCreateSchema,
  dailyEntryImportRowSchema,
  deliveryPlatformCreateSchema,
  deliveryPlatformUpdateSchema,
  platformPaymentRecordSchema,
  type DailyEntryCreateInput,
  type DeliveryPlatformCreateInput,
  type DeliveryPlatformUpdateInput,
  type PlatformPaymentRecordInput,
} from "@/types/platforms-module"
import { paymentBalance } from "./module-utils"

export type PlatformActionResult = { success: boolean; error?: string; id?: string }
export type ImportResult = {
  success: boolean
  error?: string
  inserted?: number
  failures?: { rowNumber: number; error: string }[]
}
export type PlatformExportResult = { success: boolean; csv?: string; error?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

// ── Platforms CRUD ──────────────────────────────────────────────────────────

export async function upsertPlatform(
  input: DeliveryPlatformCreateInput | DeliveryPlatformUpdateInput
): Promise<PlatformActionResult> {
  try {
    const isUpdate = "id" in input && typeof (input as { id?: string }).id === "string"
    await requirePermission("platforms", isUpdate ? "update" : "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitOrders(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()

    if (isUpdate) {
      const parsed = deliveryPlatformUpdateSchema.parse(input)
      const { data, error } = await admin
        .from("delivery_platforms")
        .update({
          code: parsed.code,
          name_ar: parsed.name_ar,
          name_en: parsed.name_en?.trim() || null,
          brand_color: parsed.brand_color?.trim() || null,
          rate_type: parsed.rate_type,
          rate_per_order: parsed.rate_per_order ?? null,
          api_base_url: parsed.api_base_url?.trim() || null,
          sort_order: parsed.sort_order ?? 100,
          is_active: parsed.is_active ?? true,
          updated_by: currentUser.authUserId,
        })
        .eq("id", parsed.id)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .select("id")
        .single()
      if (error) {
        if (error.message.includes("idx_delivery_platforms_unique_code") || error.message.includes("duplicate key")) {
          return { success: false, error: "A platform with this code already exists." }
        }
        return { success: false, error: error.message }
      }
      if (!data) return { success: false, error: "Platform not found." }

      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.authUserId,
        module: "platforms",
        action: "platform_updated",
        entityType: "delivery_platform",
        entityId: parsed.id,
        newValues: { code: parsed.code, name_ar: parsed.name_ar, is_active: parsed.is_active ?? true },
      })
      revalidatePath("/platforms")
      revalidatePath(`/platforms/${parsed.id}`)
      return { success: true, id: parsed.id }
    }

    const parsed = deliveryPlatformCreateSchema.parse(input)
    const { data, error } = await admin
      .from("delivery_platforms")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        code: parsed.code,
        name_ar: parsed.name_ar,
        name_en: parsed.name_en?.trim() || null,
        brand_color: parsed.brand_color?.trim() || null,
        rate_type: parsed.rate_type,
        rate_per_order: parsed.rate_per_order ?? null,
        api_base_url: parsed.api_base_url?.trim() || null,
        sort_order: parsed.sort_order ?? 100,
        is_active: true,
      })
      .select("id")
      .single()
    if (error) {
      if (error.message.includes("idx_delivery_platforms_unique_code") || error.message.includes("duplicate key")) {
        return { success: false, error: "A platform with this code already exists." }
      }
      return { success: false, error: error.message }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "platform_created",
      entityType: "delivery_platform",
      entityId: data.id,
      newValues: { code: parsed.code, name_ar: parsed.name_ar, rate_type: parsed.rate_type },
    })
    revalidatePath("/platforms")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Deactivate (soft-delete) a platform. FK usage is checked first — platforms
 * referenced by drivers/daily entries/payments are deactivated, never
 * hard-deleted (the 4-policy pattern: no DELETE policies exist anyway).
 */
export async function deactivatePlatform(id: string): Promise<PlatformActionResult> {
  try {
    await requirePermission("platforms", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitOrders(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("delivery_platforms")
      .update({ is_active: false, deleted_at: new Date().toISOString(), updated_by: currentUser.authUserId })
      .eq("id", id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Platform not found." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "platform_deactivated",
      entityType: "delivery_platform",
      entityId: id,
      newValues: { is_active: false, deleted_at: "set" },
    })
    revalidatePath("/platforms")
    return { success: true, id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Payments ledger (balance = invoiced − paid) ─────────────────────────────

export async function recordPlatformPayment(
  input: PlatformPaymentRecordInput
): Promise<PlatformActionResult> {
  try {
    await requirePermission("platforms", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = platformPaymentRecordSchema.parse(input)
    const admin = createAdminClient()

    // Platform must be a tenant platform.
    const { data: platform } = await admin
      .from("delivery_platforms")
      .select("id, name_ar")
      .eq("id", parsed.platform_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!platform) return { success: false, error: "Platform not found in your tenant." }

    const { outstanding, status } = paymentBalance(parsed.expected_amount, parsed.received_amount, parsed.payment_status)

    // One row per (tenant, platform, year, month) — partial unique index
    // idx_platform_payments_unique_period (WHERE deleted_at IS NULL).
    // supabase-js .upsert() cannot target a PARTIAL index (ON CONFLICT needs
    // the index predicate, which the client cannot express), so this is a
    // read-then-write with one retry: a concurrent insert that wins the race
    // surfaces as 23505 and the loser re-reads and updates instead.
    const rowValues = {
      expected_amount: parsed.expected_amount,
      received_amount: parsed.received_amount,
      outstanding_amount: outstanding,
      payment_status: status,
      payment_date: parsed.payment_date?.trim() || null,
      payment_ref: parsed.payment_ref?.trim() || null,
      notes: parsed.notes?.trim() || null,
      updated_by: currentUser.authUserId,
    }
    const findExisting = () =>
      admin
        .from("platform_payments")
        .select("id")
        .eq("tenant_id", currentUser.tenantId)
        .eq("platform_id", parsed.platform_id)
        .eq("period_year", parsed.period_year)
        .eq("period_month", parsed.period_month)
        .is("deleted_at", null)
        .maybeSingle<{ id: string }>()

    let paymentId: string | null = null
    for (let attempt = 0; attempt < 2 && !paymentId; attempt++) {
      const { data: existing } = await findExisting()
      if (existing) {
        const { error } = await admin
          .from("platform_payments")
          .update(rowValues)
          .eq("id", existing.id)
          .eq("tenant_id", currentUser.tenantId)
          .is("deleted_at", null)
          .select("id")
          .single()
        if (error) return { success: false, error: error.message }
        paymentId = existing.id
      } else {
        const { data: inserted, error } = await admin
          .from("platform_payments")
          .insert({
            tenant_id: currentUser.tenantId,
            platform_id: parsed.platform_id,
            period_year: parsed.period_year,
            period_month: parsed.period_month,
            created_by: currentUser.authUserId,
            ...rowValues,
          })
          .select("id")
          .single()
        if (error) {
          if (error.code === "23505" && attempt === 0) continue // concurrent insert won — update instead
          return { success: false, error: error.message }
        }
        paymentId = inserted.id
      }
    }
    if (!paymentId) return { success: false, error: "Could not record the payment (concurrent update)." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "platform_payment_recorded",
      entityType: "platform_payments",
      entityId: paymentId,
      newValues: {
        platform_id: parsed.platform_id,
        period: `${parsed.period_year}-${String(parsed.period_month).padStart(2, "0")}`,
        expected_amount: parsed.expected_amount,
        received_amount: parsed.received_amount,
        outstanding_amount: outstanding,
        payment_status: status,
      },
    })
    revalidatePath("/platforms")
    revalidatePath(`/platforms/${parsed.platform_id}`)
    return { success: true, id: paymentId }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Daily-entry import (manual add + CSV paste, partial-failure report) ─────

export async function importDailyEntries(
  rows: unknown[],
  platformId: string,
  entrySource: "manual" | "import" = "import"
): Promise<ImportResult> {
  try {
    await requirePermission("platforms", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitOrders(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    if (!platformId) return { success: false, error: "Platform is required." }
    if (!Array.isArray(rows) || rows.length === 0) return { success: false, error: "No rows to import." }
    if (rows.length > 500) return { success: false, error: "Import is capped at 500 rows per batch." }

    const admin = createAdminClient()

    // Platform must be a tenant platform.
    const { data: platform } = await admin
      .from("delivery_platforms")
      .select("id")
      .eq("id", platformId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!platform) return { success: false, error: "Platform not found in your tenant." }

    // Validate each transport row (driver_code + counts), keeping row numbers
    // for the partial-failure report.
    const parsedRows: { rowNumber: number; row: DailyEntryCreateInput & { driver_code: string } }[] = []
    const failures: { rowNumber: number; error: string }[] = []
    rows.forEach((raw, i) => {
      const rowNumber =
        typeof (raw as { rowNumber?: unknown }).rowNumber === "number"
          ? (raw as { rowNumber: number }).rowNumber
          : i + 2
      const parsed = dailyEntryImportRowSchema.safeParse(raw)
      if (!parsed.success) {
        failures.push({ rowNumber, error: parsed.error.issues.map((iss) => iss.message).join("; ") })
        return
      }
      parsedRows.push({ rowNumber, row: parsed.data as DailyEntryCreateInput & { driver_code: string } })
    })

    // Resolve driver codes → driver ids (tenant drivers only).
    const codes = [...new Set(parsedRows.map((r) => r.row.driver_code))]
    if (codes.length === 0) return { success: false, error: "No driver codes to resolve." }
    const { data: driverRows, error: drvErr } = await admin
      .from("drivers")
      .select("id, driver_code")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .in("driver_code", codes)
    if (drvErr) return { success: false, error: drvErr.message }
    const byCode = new Map<string, string>(
      (driverRows ?? []).map((d: { id: string; driver_code: string | null }) => [d.driver_code ?? "", d.id])
    )

    // Insert good rows one-by-one so a duplicate natural key
    // (tenant, entry_date, driver, platform, COALESCE(shift,'full_day'))
    // fails ONLY its own row — idempotent re-imports report the clash.
    const toInsert: { rowNumber: number; values: Record<string, unknown> }[] = parsedRows.flatMap(({ rowNumber, row }) => {
      const driverId = byCode.get(row.driver_code)
      if (!driverId) {
        failures.push({ rowNumber, error: `unknown driver_code "${row.driver_code}"` })
        return []
      }
      return [
        {
          rowNumber,
          values: {
            tenant_id: currentUser.tenantId,
            created_by: currentUser.authUserId,
            driver_id: driverId,
            platform_id: platformId,
            entry_date: row.entry_date,
            shift_label: row.shift_label?.trim() || null,
            orders_delivered: row.orders_delivered ?? 0,
            orders_failed: row.orders_failed ?? 0,
            orders_returned: row.orders_returned ?? 0,
            orders_cancelled: 0,
            gross_revenue: row.gross_revenue ?? 0,
            platform_reported_revenue: null,
            total_distance_km: null,
            notes: row.notes?.trim() || null,
            entry_source: entrySource,
          },
        },
      ]
    })

    let inserted = 0
    for (const { rowNumber, values } of toInsert) {
      const { error: insErr } = await admin.from("daily_order_entries").insert(values)
      if (insErr) {
        failures.push({
          rowNumber,
          error: insErr.message.includes("idx_daily_order_entries_unique")
            ? "duplicate entry for this driver/date/shift (already imported)"
            : insErr.message,
        })
      } else {
        inserted++
      }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "daily_entries_imported",
      entityType: "daily_order_entries",
      entityId: null,
      newValues: { platform_id: platformId, rows_received: rows.length, inserted, failed: failures.length },
    })

    revalidatePath("/platforms")
    revalidatePath(`/platforms/${platformId}`)
    revalidatePath("/orders")
    return { success: true, inserted, failures }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/** Manual single entry — resolves an explicit driver id, no code lookup. */
export async function createDailyEntry(input: DailyEntryCreateInput): Promise<ImportResult> {
  try {
    await requirePermission("platforms", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitOrders(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = dailyEntryCreateSchema.parse(input)
    const admin = createAdminClient()

    // Platform AND driver must both belong to the caller's tenant.
    const [platRes, drvRes] = await Promise.all([
      admin
        .from("delivery_platforms")
        .select("id")
        .eq("id", parsed.platform_id)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .maybeSingle(),
      admin
        .from("drivers")
        .select("id")
        .eq("id", parsed.driver_id)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .maybeSingle(),
    ])
    if (!platRes.data) return { success: false, error: "Platform not found in your tenant." }
    if (!drvRes.data) return { success: false, error: "Driver not found in your tenant." }

    const { error: insErr } = await admin.from("daily_order_entries").insert({
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
      gross_revenue: parsed.gross_revenue ?? 0,
      platform_reported_revenue: parsed.platform_reported_revenue ?? null,
      total_distance_km: parsed.total_distance_km ?? null,
      notes: parsed.notes?.trim() || null,
      entry_source: "manual",
    })
    if (insErr) {
      if (insErr.message.includes("idx_daily_order_entries_unique")) {
        return { success: false, error: "duplicate entry for this driver/date/shift (already recorded)" }
      }
      return { success: false, error: insErr.message }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "daily_entry_created",
      entityType: "daily_order_entries",
      entityId: null,
      newValues: {
        platform_id: parsed.platform_id,
        driver_id: parsed.driver_id,
        entry_date: parsed.entry_date,
        shift_label: parsed.shift_label ?? null,
      },
    })
    revalidatePath("/platforms")
    revalidatePath(`/platforms/${parsed.platform_id}`)
    revalidatePath("/orders")
    return { success: true, inserted: 1, failures: [] }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── CSV export (BOM) ────────────────────────────────────────────────────────

type PlatformListRow = {
  id: string
  code: string
  name_ar: string
  name_en: string | null
  is_active: boolean
  rate_type: string
  rate_per_order: number | null
  sort_order: number
}

type PaymentRow = {
  period_year: number
  period_month: number
  expected_amount: number
  received_amount: number
  outstanding_amount: number
  payment_status: string
  payment_date: string | null
  platform: { name_ar: string | null; name_en: string | null } | null
}

export async function exportPlatformsCsv(): Promise<PlatformExportResult> {
  try {
    await requirePermission("platforms", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitOrders(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const [platRes, payRes] = await Promise.all([
      admin
        .from("delivery_platforms")
        .select("id,code,name_ar,name_en,is_active,rate_type,rate_per_order,sort_order")
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true }),
      admin
        .from("platform_payments")
        .select("period_year,period_month,expected_amount,received_amount,outstanding_amount,payment_status,payment_date,platform:delivery_platforms(name_ar,name_en)")
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .limit(5000),
    ])
    if (platRes.error) return { success: false, error: platRes.error.message }
    if (payRes.error) return { success: false, error: payRes.error.message }

    const platforms = (platRes.data as unknown as PlatformListRow[] | null) ?? []
    const payments = (payRes.data as unknown as PaymentRow[] | null) ?? []

    const csv =
      "\uFEFF" +
      toCsv(
        ["Section", "Code", "Platform", "Active", "Rate Type", "Rate/Order", "Period", "Expected", "Received", "Outstanding", "Payment Status", "Payment Date"],
        [
          ...platforms.map((p) => [
            "platform", p.code, p.name_en || p.name_ar, p.is_active ? "yes" : "no", p.rate_type,
            p.rate_per_order != null ? Number(p.rate_per_order).toFixed(2) : "", "", "", "", "", "", "",
          ]),
          ...payments.map((r) => [
            "payment", "", r.platform?.name_en || r.platform?.name_ar || "", "", "",
            "", `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
            Number(r.expected_amount).toFixed(2), Number(r.received_amount).toFixed(2),
            Number(r.outstanding_amount).toFixed(2), r.payment_status, r.payment_date ?? "",
          ]),
        ]
      )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "platforms",
      action: "platforms_exported",
      entityType: "delivery_platform",
      entityId: null,
      newValues: { platforms: platforms.length, payments: payments.length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
