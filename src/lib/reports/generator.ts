// src/lib/reports/generator.ts
// v2.0 M7 — report data collectors + CSV builder for the async report queue.
//
// The worker (server action in actions.ts) inserts a row into
// report_generation_log, collects rows via these collectors, serializes to
// CSV, uploads to the `generated-reports` storage bucket, and marks the job
// completed. Pure helpers here are unit-testable without a live DB.

import type { SupabaseClient } from "@supabase/supabase-js"

export type ReportType =
  | "driver_performance"
  | "payroll_summary"
  | "fleet_cost"
  | "revenue"
  | "violations_report"
  | "attendance_summary"
  | "executive_dashboard"
  | "hs_reconciliation"
  | "custom"

export const REPORT_TYPES: ReportType[] = [
  "driver_performance",
  "payroll_summary",
  "fleet_cost",
  "revenue",
  "violations_report",
  "attendance_summary",
  "executive_dashboard",
  "hs_reconciliation",
  "custom",
]

export const REPORT_TYPE_AR: Record<ReportType, string> = {
  driver_performance: "أداء السائقين",
  payroll_summary: "ملخص الرواتب",
  fleet_cost: "تكلفة الأسطول",
  revenue: "الإيرادات",
  violations_report: "المخالفات",
  attendance_summary: "ملخص الحضور",
  executive_dashboard: "لوحة المدير التنفيذي",
  hs_reconciliation: "تسوية هنقرستيشن",
  custom: "مخصص",
}

// ── CSV serialization (RFC-4180-ish, UTF-8, CRLF) ─────────────────────
function esc(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(esc).join(","))
  return lines.join("\r\n") + "\r\n"
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return ""
  try {
    return new Date(v).toISOString().slice(0, 10)
  } catch {
    return ""
  }
}

function money(v: number | null | undefined): string {
  return (v ?? 0).toFixed(2)
}

export interface ReportOutput {
  headers: string[]
  rows: unknown[][]
  filename: string
}

const MONTHS = [
  "01", "02", "03", "04", "05", "06",
  "07", "08", "09", "10", "11", "12",
]

// ── Collectors (service-role client; RLS bypassed intentionally) ──────
export async function collectReportData(
  admin: SupabaseClient,
  tenantId: string,
  type: ReportType,
  params: Record<string, unknown>
): Promise<ReportOutput> {
  const year = Number(params.year ?? new Date().getFullYear())
  const month = Number(params.month ?? new Date().getMonth() + 1)
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")

  switch (type) {
    case "driver_performance": {
      const { data } = await admin
        .from("drivers")
        .select(
          "driver_code,iqama_number,full_name_ar,phone,category,status,profile_completeness_score,cod_outstanding_amount,cod_risk_flag"
        )
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("driver_code", { ascending: true })
      const rows = ((data as Record<string, unknown>[]) ?? []).map((d) => [
        d.driver_code ?? "",
        d.iqama_number ?? "",
        d.full_name_ar ?? "",
        d.phone ?? "",
        d.category ?? "",
        d.status ?? "",
        d.profile_completeness_score ?? 0,
        money(Number(d.cod_outstanding_amount ?? 0)),
        d.cod_risk_flag ? "YES" : "NO",
      ])
      return {
        headers: ["Code", "Iqama", "Name", "Phone", "Category", "Status", "Completeness %", "COD Outstanding", "COD Risk"],
        rows,
        filename: `driver-performance-${stamp}.csv`,
      }
    }

    case "payroll_summary": {
      const { data } = await admin
        .from("driver_payroll_periods")
        .select(
          "period_year,period_month,status,orders_achieved,orders_prorated_target,base_amount,orders_bonus,total_deductions,net_payroll,below_minimum_wage,driver:drivers(driver_code,full_name_ar)"
        )
        .eq("tenant_id", tenantId)
        .eq("period_year", year)
        .eq("period_month", month)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
      const rows = ((data as unknown[]) ?? []).map((r) => {
        const row = r as {
          period_year: number; period_month: number; status: string
          orders_achieved: number | null; orders_prorated_target: number | null
          base_amount: number | null; orders_bonus: number | null
          total_deductions: number | null; net_payroll: number | null
          below_minimum_wage: boolean
          driver: { driver_code: string | null; full_name_ar: string | null } | null
        }
        return [
          `${row.period_year}-${MONTHS[(row.period_month ?? 1) - 1] ?? ""}`,
          row.driver?.driver_code ?? "",
          row.driver?.full_name_ar ?? "",
          row.status ?? "",
          row.orders_achieved ?? 0,
          row.orders_prorated_target ?? 0,
          money(row.base_amount),
          money(row.orders_bonus),
          money(row.total_deductions),
          money(row.net_payroll),
          row.below_minimum_wage ? "YES" : "NO",
        ]
      })
      return {
        headers: ["Period", "Driver Code", "Driver", "Status", "Orders", "Target", "Base", "Bonus", "Deductions", "Net", "Below MW"],
        rows,
        filename: `payroll-summary-${year}${String(month).padStart(2, "0")}.csv`,
      }
    }

    case "fleet_cost": {
      // Cursor-based pagination: fetch maintenance events in batches
      // to handle tenants with large vehicle fleets.
      const allData: unknown[] = []
      let cursor: string | null = null
      const BATCH = 500
      while (allData.length < 10_000) {
        let q = admin
          .from("vehicle_maintenance_events")
          .select("id,vehicle:vehicles(vehicle_code,plate_number,make,model),maintenance_type,status,fault_description,provider,cost,odometer_at_service,date_in,date_out")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(BATCH + 1)
        if (cursor) q = q.lt("id", cursor)
        const { data } = await q
        if (!data || data.length === 0) break
        const hasMore = data.length > BATCH
        const batch = hasMore ? data.slice(0, BATCH) : data
        cursor = String(batch[batch.length - 1].id)
        allData.push(...batch)
        if (!hasMore) break
      }
      const rows = allData.map((r) => {
        const row = r as {
          maintenance_type: string | null; status: string | null
          fault_description: string | null; provider: string | null
          cost: number | null; odometer_at_service: number | null
          date_in: string | null; date_out: string | null
          vehicle: { vehicle_code: string | null; plate_number: string | null; make: string | null; model: string | null } | null
        }
        return [
          row.vehicle?.vehicle_code ?? "",
          `${row.vehicle?.make ?? ""} ${row.vehicle?.model ?? ""}`.trim(),
          row.vehicle?.plate_number ?? "",
          row.maintenance_type ?? "",
          row.status ?? "",
          row.fault_description ?? "",
          row.provider ?? "",
          money(row.cost),
          row.odometer_at_service ?? "",
          fmtDate(row.date_in),
          fmtDate(row.date_out),
        ]
      })
      return {
        headers: ["Vehicle", "Make/Model", "Plate", "Type", "Status", "Fault", "Provider", "Cost", "Odometer", "Date In", "Date Out"],
        rows,
        filename: `fleet-cost-${stamp}.csv`,
      }
    }

    case "revenue": {
      const { data } = await admin
        .from("platform_payments")
        .select("period_year,period_month,expected_amount,received_amount,outstanding_amount,payment_status,payment_date,platform:delivery_platforms(name_ar)")
        .eq("tenant_id", tenantId)
        .eq("period_year", year)
        .eq("period_month", month)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
      const rows = ((data as unknown[]) ?? []).map((r) => {
        const row = r as {
          period_year: number; period_month: number
          expected_amount: number | null; received_amount: number | null
          outstanding_amount: number | null; payment_status: string | null; payment_date: string | null
          platform: { name_ar: string | null } | null
        }
        return [
          `${row.period_year}-${MONTHS[(row.period_month ?? 1) - 1] ?? ""}`,
          row.platform?.name_ar ?? "",
          money(row.expected_amount),
          money(row.received_amount),
          money(row.outstanding_amount),
          row.payment_status ?? "",
          fmtDate(row.payment_date),
        ]
      })
      return {
        headers: ["Period", "Platform", "Expected", "Received", "Outstanding", "Status", "Payment Date"],
        rows,
        filename: `revenue-${year}${String(month).padStart(2, "0")}.csv`,
      }
    }

    case "violations_report": {
      // Cursor-based pagination for violations report
      const allVData: unknown[] = []
      let vCursor: string | null = null
      const VBATCH = 500
      while (allVData.length < 10_000) {
        let vq = admin
          .from("violations")
          .select("id,violation_ref,incident_date,severity,status,deduction_amount,incident_description,driver:drivers(full_name_ar)")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .order("incident_date", { ascending: false })
          .order("id", { ascending: false })
          .limit(VBATCH + 1)
        if (vCursor) vq = vq.lt("id", vCursor)
        const { data: vBatch } = await vq
        if (!vBatch || vBatch.length === 0) break
        const hasMore = vBatch.length > VBATCH
        const events = hasMore ? vBatch.slice(0, VBATCH) : vBatch
        vCursor = String(events[events.length - 1].id)
        allVData.push(...events)
        if (!hasMore) break
      }
      const rows = allVData.map((r) => {
        const row = r as {
          violation_ref: string | null; incident_date: string | null
          severity: string | null; status: string | null
          deduction_amount: number | null; incident_description: string | null
          driver: { full_name_ar: string | null } | null
        }
        return [
          row.violation_ref ?? "",
          fmtDate(row.incident_date),
          row.driver?.full_name_ar ?? "",
          row.severity ?? "",
          row.status ?? "",
          money(row.deduction_amount),
          row.incident_description ?? "",
        ]
      })
      return {
        headers: ["Ref", "Date", "Driver", "Severity", "Status", "Deduction", "Description"],
        rows,
        filename: `violations-report-${stamp}.csv`,
      }
    }

    case "attendance_summary": {
      const { data } = await admin
        .from("driver_attendance_summary")
        .select("period_year,period_month,working_days_target,working_days_actual,days_present,days_late,days_absent_unexcused,days_on_leave,driver:drivers(driver_code,full_name_ar)")
        .eq("tenant_id", tenantId)
        .eq("period_year", year)
        .eq("period_month", month)
        .is("deleted_at", null)
        .order("working_days_actual", { ascending: false })
      const rows = ((data as unknown[]) ?? []).map((r) => {
        const row = r as {
          working_days_target: number | null; working_days_actual: number | null
          days_present: number | null; days_late: number | null
          days_absent_unexcused: number | null; days_on_leave: number | null
          driver: { driver_code: string | null; full_name_ar: string | null } | null
        }
        return [
          row.driver?.driver_code ?? "",
          row.driver?.full_name_ar ?? "",
          row.working_days_target ?? 0,
          row.working_days_actual ?? 0,
          row.days_present ?? 0,
          row.days_late ?? 0,
          row.days_absent_unexcused ?? 0,
          row.days_on_leave ?? 0,
        ]
      })
      return {
        headers: ["Driver Code", "Driver", "Target Days", "Actual Days", "Present", "Late", "Absent (Unexcused)", "On Leave"],
        rows,
        filename: `attendance-summary-${year}${String(month).padStart(2, "0")}.csv`,
      }
    }

    case "executive_dashboard": {
      const [drivers, vehicles, violations, assignments, payroll, receivables] = await Promise.all([
        admin.from("drivers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
        admin.from("vehicles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
        admin.from("violations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("status", ["open", "disputed"]).is("deleted_at", null),
        admin.from("vehicle_assignments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_current", true).is("deleted_at", null),
        admin.from("driver_payroll_periods").select("net_payroll").eq("tenant_id", tenantId).eq("period_year", year).eq("period_month", month).in("status", ["approved", "paid"]).is("deleted_at", null),
        admin.from("receivables").select("total_amount,paid_amount").eq("tenant_id", tenantId).in("status", ["open", "partially_paid", "overdue"]).is("deleted_at", null),
      ])

      let totalNet = 0
      for (const p of ((payroll.data as { net_payroll: number | null }[]) ?? [])) totalNet += Number(p.net_payroll ?? 0)
      let arOutstanding = 0
      for (const r of ((receivables.data as { total_amount: number | null; paid_amount: number | null }[]) ?? [])) {
        arOutstanding += Number(r.total_amount ?? 0) - Number(r.paid_amount ?? 0)
      }

      const rows = [
        ["Drivers", drivers.count ?? 0],
        ["Vehicles", vehicles.count ?? 0],
        ["Active Vehicle Assignments", assignments.count ?? 0],
        ["Open Violations", violations.count ?? 0],
        ["Net Payroll (approved/paid)", money(totalNet)],
        ["Receivables Outstanding", money(arOutstanding)],
        ["Period", `${year}-${MONTHS[(month - 1)] ?? ""}`],
      ]
      return {
        headers: ["KPI", "Value"],
        rows,
        filename: `executive-dashboard-${year}${String(month).padStart(2, "0")}.csv`,
      }
    }

    case "hs_reconciliation": {
      const { data } = await admin
        .from("daily_order_entries")
        .select("entry_date,orders_delivered,orders_failed,orders_returned,gross_revenue,platform_reported_revenue,revenue_variance,platform:delivery_platforms(name_ar)")
        .eq("tenant_id", tenantId)
        .gte("entry_date", `${year}-${String(month).padStart(2, "0")}-01`)
        .lte("entry_date", `${year}-${String(month).padStart(2, "0")}-31`)
        .is("deleted_at", null)
        .order("entry_date", { ascending: true })
        .limit(1000)
      const rows = ((data as unknown[]) ?? []).map((r) => {
        const row = r as {
          entry_date: string | null; orders_delivered: number | null
          orders_failed: number | null; orders_returned: number | null
          gross_revenue: number | null; platform_reported_revenue: number | null
          revenue_variance: number | null
          platform: { name_ar: string | null } | null
        }
        return [
          fmtDate(row.entry_date),
          row.platform?.name_ar ?? "",
          row.orders_delivered ?? 0,
          row.orders_failed ?? 0,
          row.orders_returned ?? 0,
          money(row.gross_revenue),
          money(row.platform_reported_revenue),
          money(row.revenue_variance),
        ]
      })
      return {
        headers: ["Date", "Platform", "Delivered", "Failed", "Returned", "Gross Revenue", "Platform Reported", "Variance"],
        rows,
        filename: `hs-reconciliation-${year}${String(month).padStart(2, "0")}.csv`,
      }
    }

    case "custom":
    default: {
      return {
        headers: ["Key", "Value"],
        rows: Object.entries(params).map(([k, v]) => [k, String(v ?? "")]),
        filename: `custom-report-${stamp}.csv`,
      }
    }
  }
}
