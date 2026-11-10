"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { toCsv } from "@/lib/accounting/csv-utils"
import { rateLimitOrders } from "@/lib/auth/rate-limit"
import { orderEntryCreateSchema, type OrderEntryCreateInput, type DailyOrderEntry } from "@/types/orders"

export type ActionResult = { success: boolean; error?: string; id?: string; updated_at?: string }
export type ExportResult = { success: boolean; csv?: string; error?: string }
export type OrderListRow = DailyOrderEntry & { driver: { full_name_ar: string | null; full_name_en: string | null; driver_code: string | null } | null; platform: { name_ar: string | null; name_en: string | null } | null }
export type OrderListResult = { success: boolean; error?: string; rows: OrderListRow[]; total: number; summary: { delivered: number; failed: number; revenue: number } }
const keys = z.object({ id: z.uuid(), expected: z.iso.datetime({ offset: true }) })
const pageInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), search: z.string().max(200), page: z.number().int().min(1), pageSize: z.number().int().min(1).max(1000) })
function message(error: unknown): string { return error instanceof z.ZodError ? error.issues[0]?.message ?? "Check the entered values." : error instanceof Error ? error.message : "Could not complete the order operation. Try again." }
async function mutate(input: OrderEntryCreateInput | null, id?: string, expectedUpdatedAt?: string): Promise<ActionResult> {
 try {
  await requirePermission("platforms", input === null ? "delete" : id ? "update" : "create")
  const user = await getCurrentUser()
  if (!user) throw new Error("Not authenticated.")
  if (!(await rateLimitOrders(user.id)).success) throw new Error("Rate limit exceeded. Try again later.")
  if (id || input === null) keys.parse({ id, expected: expectedUpdatedAt })
  const parsed = input === null ? null : orderEntryCreateSchema.parse(input)
  const db = await createClient()
  const result = parsed === null
   ? await db.rpc("archive_order_entry", { p_id: id!, p_expected_updated_at: expectedUpdatedAt! })
   : await db.rpc("save_order_entry", { p_input: parsed, p_id: id ?? null, p_expected_updated_at: expectedUpdatedAt ?? null })
  if (result.error) throw new Error(result.error.message)
  if (!result.data?.id) throw new Error("The entry was not saved. Reload and try again.")
  revalidatePath("/orders"); revalidatePath("/platforms"); revalidatePath("/payroll/preparation")
  return { success: true, id: result.data.id, updated_at: result.data.updated_at }
 } catch(error) { return { success: false, error: message(error) } }
}
export async function createOrderEntry(input: OrderEntryCreateInput): Promise<ActionResult> { return mutate(input) }
export async function updateOrderEntry(id: string, expectedUpdatedAt: string, input: OrderEntryCreateInput): Promise<ActionResult> { return mutate(input,id,expectedUpdatedAt) }
export async function deleteOrderEntry(id: string, expectedUpdatedAt: string): Promise<ActionResult> { return mutate(null,id,expectedUpdatedAt) }
export async function listOrderEntries(month: string, search = "", page = 1, pageSize = 50): Promise<OrderListResult> {
 try {
  await requirePermission("platforms","read")
  if (!await getCurrentUser()) throw new Error("Not authenticated.")
  const input=pageInput.parse({month,search,page,pageSize}), db=await createClient()
  const {data,error}=await db.rpc("list_order_entries",{p_month:input.month,p_search:input.search,p_page:input.page,p_page_size:input.pageSize})
  if(error) throw new Error(error.message)
  return {success:true,rows:data.rows,total:data.total,summary:data.summary}
 } catch(error) { return {success:false,error:message(error),rows:[],total:0,summary:{delivered:0,failed:0,revenue:0}} }
}
export async function exportOrdersCsv(month: string): Promise<ExportResult> {
 try {
  await requirePermission("platforms","export")
  const user=await getCurrentUser(); if(!user) throw new Error("Not authenticated.")
  if(!(await rateLimitOrders(user.id)).success) throw new Error("Rate limit exceeded. Try again later.")
  pageInput.parse({month,search:"",page:1,pageSize:1000})
  const db=await createClient(),{data,error}=await db.rpc("export_order_entries",{p_month:month})
  if(error)throw new Error(error.message)
  const rows=data as OrderListRow[]
  const csv="\uFEFF"+toCsv(["Date","Shift","Driver","Platform","Delivered","Failed","Returned","Cancelled","Distance (km)","Revenue","Platform Reported","Variance","Locked"],rows.map(r=>[r.entry_date,r.shift_label??"",r.driver?.full_name_en??r.driver?.full_name_ar??"",r.platform?.name_en??r.platform?.name_ar??"",r.orders_delivered,r.orders_failed,r.orders_returned,r.orders_cancelled,r.total_distance_km??"",r.gross_revenue,r.platform_reported_revenue??"",r.revenue_variance,r.is_locked?"locked":"open"]))
  await writeAuditLog({tenantId:user.tenantId,actorId:user.authUserId,module:"platforms",action:"order_entries_exported",entityType:"daily_order_entries",entityId:null,newValues:{month,rows:rows.length}})
  return {success:true,csv}
 } catch(error) { return {success:false,error:message(error)} }
}
