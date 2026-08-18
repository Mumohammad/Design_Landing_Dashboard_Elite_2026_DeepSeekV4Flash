import { z } from "zod"

// Module 5 / 10 — Orders (daily_order_entries). Columns mirror migration
// 020_orders_platforms.sql exactly.

export type OrderEntrySource = "manual" | "import" | "api"

export interface DailyOrderEntry {
  id: string
  tenant_id: string
  driver_id: string
  platform_id: string
  entry_date: string
  shift_label: string | null
  orders_delivered: number
  orders_failed: number
  orders_returned: number
  orders_cancelled: number
  total_distance_km: number | null
  avg_order_distance_km: number | null
  multi_order_batches: number
  gross_revenue: number
  platform_reported_revenue: number | null
  revenue_variance: number
  notes: string | null
  entry_source: OrderEntrySource
  is_locked: boolean
  created_at: string
  updated_at: string
}

export const orderEntrySourceSchema = z.enum(["manual", "import", "api"])

export const orderEntryCreateSchema = z.object({
  driver_id: z.string().uuid("Driver is required"),
  platform_id: z.string().uuid("Platform is required"),
  entry_date: z.string().min(1, "Date is required"),
  shift_label: z.string().nullable().optional(),
  orders_delivered: z.number().int().min(0).optional(),
  orders_failed: z.number().int().min(0).optional(),
  orders_returned: z.number().int().min(0).optional(),
  orders_cancelled: z.number().int().min(0).optional(),
  total_distance_km: z.number().min(0).nullable().optional(),
  avg_order_distance_km: z.number().min(0).nullable().optional(),
  multi_order_batches: z.number().int().min(0).optional(),
  gross_revenue: z.number().min(0).optional(),
  platform_reported_revenue: z.number().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  is_locked: z.boolean().optional(),
})

export type OrderEntryCreateInput = z.infer<typeof orderEntryCreateSchema>
