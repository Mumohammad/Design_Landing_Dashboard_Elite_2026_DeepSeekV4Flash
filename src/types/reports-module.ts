import { z } from "zod"

// Reports hub (Module 12/13 surface). Columns mirror migrations
// 024_reports.sql + 025_templates.sql (+ 059 verify tokens) exactly — a
// SURFACING job over the existing schema; no new tables/columns introduced.

/**
 * The eight live-table report types offered in the UI (the DB enum also has a
 * legacy `custom` value which the hub never offers — it echoes params back
 * instead of reading live tables).
 */
export const reportTypeSchema = z.enum([
  "driver_performance",
  "payroll_summary",
  "fleet_cost",
  "revenue",
  "violations_report",
  "attendance_summary",
  "executive_dashboard",
  "hs_reconciliation",
])

export type ReportTypeInput = z.infer<typeof reportTypeSchema>

/** Queue one report generation (month params only offered when relevant). */
export const reportGenerateSchema = z.object({
  report_type: reportTypeSchema,
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})

export type ReportGenerateInput = z.infer<typeof reportGenerateSchema>

/** Print or archive a generated document (id-only decision inputs). */
export const docDecisionSchema = z.object({
  id: z.string().uuid(),
})

export type DocDecisionInput = z.infer<typeof docDecisionSchema>
