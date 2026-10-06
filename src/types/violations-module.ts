import { z } from "zod"

// Module 5 — Violations & deductions. Columns mirror migration 019_violations.sql
// exactly — a SURFACING job over the existing schema; no new tables/columns.

export const VIOLATION_SEVERITIES = ["minor", "moderate", "major", "critical"] as const
export const VIOLATION_SOURCES = ["manual", "absher", "platform_report", "najm", "moi", "internal"] as const
export const EXTERNAL_FINE_SOURCES = ["manual", "najm", "moi", "absher"] as const
export const LEDGER_STATUSES = ["pending", "applied", "rolled_back", "cancelled"] as const
export const EXTERNAL_FINE_STATUSES = ["unmatched", "matched", "violation_created", "duplicate", "ignored"] as const

export const violationSeveritySchema = z.enum(VIOLATION_SEVERITIES)
export const externalFineSourceSchema = z.enum(EXTERNAL_FINE_SOURCES)

/** Create a violation from the module page (driver-scoped). */
export const violationCreateSchema = z.object({
  driver_id: z.string().uuid("Driver is required"),
  vehicle_id: z.string().uuid().nullable().optional(),
  violation_type_id: z.string().uuid().nullable().optional(),
  severity: violationSeveritySchema.optional(),
  incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd"),
  incident_location: z.string().trim().max(300).nullable().optional(),
  incident_description: z.string().trim().min(3, "Description is required").max(2000),
  deduction_amount: z.number().min(0).max(1_000_000).optional(),
  evidence_paths: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
})

export type ViolationCreateInput = z.infer<typeof violationCreateSchema>

/** Edit while open / under review. */
export const violationUpdateSchema = z.object({
  id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable().optional(),
  violation_type_id: z.string().uuid().nullable().optional(),
  severity: violationSeveritySchema.optional(),
  incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd").optional(),
  incident_location: z.string().trim().max(300).nullable().optional(),
  incident_description: z.string().trim().min(3).max(2000).optional(),
  deduction_amount: z.number().min(0).max(1_000_000).optional(),
  evidence_paths: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
})

export type ViolationUpdateInput = z.infer<typeof violationUpdateSchema>

/** Move a violation into review (open → under_review). */
export const violationStartReviewSchema = z.object({ id: z.string().uuid() })

/**
 * Approve a reviewed violation → status `resolved` + queue the deduction as a
 * PENDING violation_deduction_ledger row (the payroll engine picks pending
 * rows up for the matching deduction_month — see lib/payroll/calculate.ts).
 */
export const violationApproveSchema = z.object({
  id: z.string().uuid(),
  review_notes: z.string().trim().max(2000).nullable().optional(),
  /** Ledger month key `yyyy-mm` — defaults to the current month. */
  deduction_month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Deduction month must be yyyy-mm")
    .optional(),
  /** Final deduction amount — defaults to the violation's deduction_amount. */
  deduction_amount: z.number().min(0).max(1_000_000).optional(),
})

export type ViolationApproveInput = z.infer<typeof violationApproveSchema>

/** Waive a violation — reason is mandatory; the admin waiver limit applies. */
export const violationWaiveSchema = z.object({
  id: z.string().uuid(),
  waiver_reason: z.string().trim().min(5, "A waiver reason is required").max(2000),
})

export type ViolationWaiveInput = z.infer<typeof violationWaiveSchema>

/** Apply a PENDING ledger row to a draft/calculated payroll period. */
export const ledgerApplySchema = z.object({
  ledger_id: z.string().uuid(),
  payroll_period_id: z.string().uuid(),
})

export type LedgerApplyInput = z.infer<typeof ledgerApplySchema>

/** Roll an APPLIED ledger row back to pending — reason mandatory. */
export const ledgerRollbackSchema = z.object({
  ledger_id: z.string().uuid(),
  reason: z.string().trim().min(5, "A rollback reason is required").max(2000),
})

export type LedgerRollbackInput = z.infer<typeof ledgerRollbackSchema>

/** One pasted/uploaded government fine row (before match). */
export const externalFineImportRowSchema = z.object({
  rowNumber: z.number().int().min(2).optional(),
  external_ref: z.string().trim().min(1, "external_ref is required").max(120),
  external_source: z.string().trim().max(120).nullable().optional(),
  vehicle_plate: z.string().trim().max(40).nullable().optional(),
  violation_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "violation_date must be yyyy-mm-dd")
    .nullable()
    .optional(),
  violation_location: z.string().trim().max(300).nullable().optional(),
  violation_type_code: z.string().trim().max(80).nullable().optional(),
  fine_amount: z.number().min(0).nullable().optional(),
  payment_deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "payment_deadline must be yyyy-mm-dd")
    .nullable()
    .optional(),
  match_notes: z.string().trim().max(1000).nullable().optional(),
})

export type ExternalFineImportRow = z.infer<typeof externalFineImportRowSchema>

/** Match an unmatched fine to a tenant driver. */
export const externalFineMatchSchema = z.object({
  id: z.string().uuid(),
  driver_id: z.string().uuid("Driver is required"),
  match_notes: z.string().trim().max(1000).nullable().optional(),
})

/** Mark a fine duplicate/ignored with a reason (queue hygiene). */
export const externalFineMarkSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["duplicate", "ignored"]),
  match_notes: z.string().trim().min(3, "A reason is required").max(1000),
})

/** Upsert a violation type (settings-style admin). */
export const violationTypeUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(40)
    .regex(/^[a-z0-9_-]+$/i, "Code must be alphanumeric (dashes/underscores allowed)"),
  name_ar: z.string().trim().min(2, "Arabic name is required").max(120),
  name_en: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().min(2, "Category is required").max(60),
  severity: violationSeveritySchema,
  default_deduction: z.number().min(0).max(1_000_000),
  warning_threshold: z.number().int().min(1).max(99).optional(),
  is_active: z.boolean().optional(),
})

export type ViolationTypeUpsertInput = z.infer<typeof violationTypeUpsertSchema>

/** Sign evidence paths stored in violations.evidence_urls (violation-evidence bucket). */
export const evidenceSignSchema = z.object({
  paths: z.array(z.string().trim().min(1).max(600)).min(1).max(10),
})
