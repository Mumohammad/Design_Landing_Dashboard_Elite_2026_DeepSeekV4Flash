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
import { createClient } from "@/lib/supabase/server"
import { createOrderEntry } from "@/lib/orders/actions"
import { z } from "zod"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitOrders } from "@/lib/auth/rate-limit"
import { toCsv } from "@/lib/accounting/csv-utils"
import {
  dailyEntryImportRowSchema,
  deliveryPlatformCreateSchema,
  deliveryPlatformUpdateSchema,
  platformPaymentRecordSchema,
  type DailyEntryCreateInput,
  type DeliveryPlatformCreateInput,
  type DeliveryPlatformUpdateInput,
  type PlatformPaymentRecordInput,
} from "@/types/platforms-module"

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

export async function upsertPlatform(input: DeliveryPlatformCreateInput | DeliveryPlatformUpdateInput): Promise<PlatformActionResult> {
 try {
  const updating="id" in input
  await requirePermission("platforms",updating?"update":"create")
  const user=await getCurrentUser(); if(!user) throw new Error("Not authenticated.")
  if(!(await rateLimitOrders(user.id)).success) throw new Error("Rate limit exceeded. Try again later.")
  const parsed=updating?deliveryPlatformUpdateSchema.parse(input):deliveryPlatformCreateSchema.parse(input)
  const db=await createClient(), current=parsed as DeliveryPlatformUpdateInput
  const {data,error}=await db.rpc("save_delivery_platform",{p_input:parsed,p_id:updating?current.id:null,p_expected_updated_at:updating?current.expected_updated_at:null})
  if(error) throw new Error(error.code==="23505"?"A platform with this code already exists.":error.message)
  if(!data?.id) throw new Error("The platform was not saved. Reload and try again.")
  revalidatePath("/platforms");revalidatePath("/platforms/"+data.id)
  return {success:true,id:data.id}
 }catch(error){return {success:false,error:errorMessage(error)}}
}
/** Keep inactive master data and all linked history readable. */
export async function deactivatePlatform(id: string, expectedUpdatedAt: string): Promise<PlatformActionResult> {
 try {
  await requirePermission("platforms","update")
  const user=await getCurrentUser();if(!user)throw new Error("Not authenticated.")
  if(!(await rateLimitOrders(user.id)).success)throw new Error("Rate limit exceeded. Try again later.")
  z.object({id:z.uuid(),expectedUpdatedAt:z.iso.datetime({offset:true})}).parse({id,expectedUpdatedAt})
  const db=await createClient(),{data,error}=await db.rpc("save_delivery_platform",{p_input:{},p_id:id,p_expected_updated_at:expectedUpdatedAt,p_deactivate:true})
  if(error)throw new Error(error.message)
  if(!data?.id)throw new Error("Platform not found.")
  revalidatePath("/platforms");revalidatePath("/platforms/"+id)
  return {success:true,id}
 }catch(error){return {success:false,error:errorMessage(error)}}
}

// ── Payments ledger (balance = invoiced − paid) ─────────────────────────────

export async function recordPlatformPayment(input: PlatformPaymentRecordInput): Promise<PlatformActionResult> {
 try{
  await requirePermission("platforms","update")
  const user=await getCurrentUser();if(!user)throw new Error("Not authenticated.")
  if(!(await rateLimitOrders(user.id)).success)throw new Error("Rate limit exceeded. Try again later.")
  const parsed=platformPaymentRecordSchema.parse(input),db=await createClient()
  const {data,error}=await db.rpc("save_platform_payment",{p_input:parsed})
  if(error)throw new Error(error.message)
  if(!data?.id)throw new Error("The payment period was not saved. Reload and try again.")
  revalidatePath("/platforms");revalidatePath("/platforms/"+parsed.platform_id)
  return {success:true,id:data.id}
 }catch(error){return{success:false,error:errorMessage(error)}}
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

    const admin = await createClient()

    // Platform must be a tenant platform.
    const { data: platform } = await admin
      .from("delivery_platforms")
      .select("id")
      .eq("id", platformId)
      .eq("tenant_id", currentUser.tenantId)
      .eq("is_active", true)
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
      const { error: insErr } = await admin.rpc("save_order_entry",{p_input:values})
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
 const result=await createOrderEntry(input)
 return result.success?{success:true,inserted:1,failures:[]}:{success:false,error:result.error}
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

    const db=await createClient(),{data,error}=await db.rpc("export_delivery_platform_data",{})
    if(error)throw new Error(error.message)
    const platforms=data.platforms as PlatformListRow[],payments=data.payments as PaymentRow[]

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

export async function exportPlatformOrdersCsv(platformId: string, month: string): Promise<PlatformExportResult> {
 try {
  await requirePermission("platforms","export")
  const user=await getCurrentUser();if(!user)throw new Error("Not authenticated.")
  if(!(await rateLimitOrders(user.id)).success)throw new Error("Rate limit exceeded. Try again later.")
  z.object({platformId:z.uuid(),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)}).parse({platformId,month})
  const db=await createClient(),{data,error}=await db.rpc("export_delivery_platform_data",{p_id:platformId,p_month:month})
  if(error)throw new Error(error.message)
  type Row={entry_date:string;driver:{full_name_ar:string|null;full_name_en:string|null};orders_delivered:number;orders_failed:number;orders_returned:number;orders_cancelled:number;gross_revenue:number}
  const rows=data.entries as Row[]
  const csv="\uFEFF"+toCsv(["Date","Driver","Delivered","Failed","Returned","Cancelled","Revenue"],rows.map(r=>[r.entry_date,r.driver.full_name_en??r.driver.full_name_ar??"",r.orders_delivered,r.orders_failed,r.orders_returned,r.orders_cancelled,r.gross_revenue]))
  await writeAuditLog({tenantId:user.tenantId,actorId:user.authUserId,module:"platforms",action:"platform_orders_exported",entityType:"delivery_platform",entityId:platformId,newValues:{month,rows:rows.length}})
  return{success:true,csv}
 }catch(error){return{success:false,error:errorMessage(error)}}
}
