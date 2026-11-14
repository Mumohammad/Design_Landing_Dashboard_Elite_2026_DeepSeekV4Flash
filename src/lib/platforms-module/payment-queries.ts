"use server"

import { z } from "zod"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitOrders } from "@/lib/auth/rate-limit"
import { collectRows } from "@/lib/reports/collect-rows"
import { createClient } from "@/lib/supabase/server"

const paymentSchema = z.object({
  id: z.uuid(),
  platform_id: z.uuid(),
  period_year: z.number().int().min(2000).max(2200),
  period_month: z.number().int().min(1).max(12),
  expected_amount: z.number().finite().nonnegative(),
  received_amount: z.number().finite().nonnegative(),
  outstanding_amount: z.number().finite().nonnegative(),
  payment_status: z.enum(["pending", "partial", "paid", "overdue", "disputed"]),
  payment_date: z.iso.date().nullable(),
  payment_ref: z.string().nullable(),
  platform: z.object({ name_ar: z.string(), name_en: z.string().nullable(), code: z.string() }).nullable(),
})

export type PlatformPaymentListRow = z.infer<typeof paymentSchema>
export type PlatformPaymentsResult =
  | { success: true; rows: PlatformPaymentListRow[] }
  | { success: false; error: string }

/** Complete caller-authorized reconciliation list. No service-role read or writes. */
export async function listPlatformPayments(): Promise<PlatformPaymentsResult> {
  try {
    await requirePermission("platforms", "read")
    const user = await getCurrentUser()
    if (!user) throw new Error("Unauthenticated")
    if (!(await rateLimitOrders(user.id)).success) {
      return { success: false, error: "Too many attempts. Wait before retrying." }
    }
    const db = await createClient()
    const rows = await collectRows(() => db
      .from("platform_payments")
      .select("id,platform_id,period_year,period_month,expected_amount,received_amount,outstanding_amount,payment_status,payment_date,payment_ref,platform:delivery_platforms(name_ar,name_en,code)", { count: "exact" })
      .eq("tenant_id", user.tenantId)
      .is("deleted_at", null)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .order("id", { ascending: true }))
    return { success: true, rows: z.array(paymentSchema).parse(rows) }
  } catch {
    // Failed or changing pages must never become an apparently empty ledger.
    return { success: false, error: "Could not load platform payments. Try again." }
  }
}
