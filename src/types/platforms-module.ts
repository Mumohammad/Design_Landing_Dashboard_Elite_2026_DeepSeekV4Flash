import { z } from "zod"

// Module 10 — Delivery-platform operations. Columns mirror migrations
// 020_orders_platforms.sql + 026_platform_payments.sql exactly — a SURFACING
// job over the existing schema; no new tables/columns introduced.

export type PlatformRateType = "flat" | "distance_based" | "tiered" | "custom"

export const platformRateTypeSchema = z.enum(["flat", "distance_based", "tiered", "custom"])

export const deliveryPlatformCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(40)
    .regex(/^[a-z0-9_-]+$/i, "Code must be alphanumeric (dashes/underscores allowed)"),
  name_ar: z.string().trim().min(2, "Arabic name is required").max(120),
  name_en: z.string().trim().max(120).nullable().optional(),
  brand_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Brand color must be #RRGGBB")
    .nullable()
    .optional(),
  rate_type: platformRateTypeSchema,
  rate_per_order: z.number().min(0).max(9999).nullable().optional(),
  api_base_url: z.string().trim().url("Base URL must be a valid URL").max(500).nullable().optional().or(z.literal("")),
  sort_order: z.number().int().min(0).max(9999).optional(),
})

export type DeliveryPlatformCreateInput = z.infer<typeof deliveryPlatformCreateSchema>

export const deliveryPlatformUpdateSchema = deliveryPlatformCreateSchema.extend({
  id: z.string().uuid(),
  is_active: z.boolean().optional(),
})

export type DeliveryPlatformUpdateInput = z.infer<typeof deliveryPlatformUpdateSchema>

/** Record/settle a platform payment row (never hard-deleted). */
export const platformPaymentRecordSchema = z.object({
  platform_id: z.string().uuid(),
  period_year: z.number().int().min(2000).max(2200),
  period_month: z.number().int().min(1).max(12),
  expected_amount: z.number().min(0),
  received_amount: z.number().min(0),
  payment_status: z.enum(["pending", "partial", "paid", "overdue", "disputed"]).optional(),
  payment_date: z.string().nullable().optional(),
  payment_ref: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export type PlatformPaymentRecordInput = z.infer<typeof platformPaymentRecordSchema>

/** Manual single daily entry — carries a resolved tenant driver id. */
export const dailyEntryCreateSchema = z.object({
  driver_id: z.string().uuid("Driver is required"),
  platform_id: z.string().uuid("Platform is required"),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd"),
  shift_label: z.string().trim().max(40).nullable().optional(),
  orders_delivered: z.number().int().min(0).optional(),
  orders_failed: z.number().int().min(0).optional(),
  orders_returned: z.number().int().min(0).optional(),
  orders_cancelled: z.number().int().min(0).optional(),
  gross_revenue: z.number().min(0).optional(),
  platform_reported_revenue: z.number().min(0).nullable().optional(),
  total_distance_km: z.number().min(0).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export type DailyEntryCreateInput = z.infer<typeof dailyEntryCreateSchema>

/**
 * One CSV row before driver resolution — carries `driver_code` (the import
 * format) which the server action resolves to a tenant driver id. Kept
 * separate from {@link dailyEntryCreateSchema} so the zod contract matches
 * the transport shape exactly (no driver_code-in-driver_id coercion).
 */
export const dailyEntryImportRowSchema = z.object({
  rowNumber: z.number().int().min(2).optional(),
  driver_code: z.string().trim().min(1, "driver_code is required"),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entry_date must be yyyy-mm-dd"),
  shift_label: z.string().trim().max(40).nullable().optional(),
  orders_delivered: z.number().int().min(0).optional(),
  orders_failed: z.number().int().min(0).optional(),
  orders_returned: z.number().int().min(0).optional(),
  gross_revenue: z.number().min(0).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export type DailyEntryImportRow = z.infer<typeof dailyEntryImportRowSchema>
