import type { SupabaseClient } from "@supabase/supabase-js"
import { substringFilter } from "@/lib/supabase/search-filter"
import { collectRows } from "@/lib/reports/collect-rows"
import { sumMoney, type DecimalInput } from "@/lib/accounting/decimal"

type Driver = { full_name_ar: string; driver_code: string } | null
export interface AttendanceRow {
  id: string
  driver_id: string
  attendance_date: string
  status: string
  check_in_time: string | null
  check_out_time: string | null
  late_minutes: number
  working_day_value: number
  driver: Driver
}
export interface PerformanceRow {
  id: string
  driver_id: string
  review_period: string
  review_date: string
  overall_score: number | null
  status: string
  driver: Driver
}
export interface ViolationRow {
  id: string
  driver_id: string | null
  violation_ref: string
  incident_date: string
  status: string
  severity: string
  deduction_amount: number
  dispute_deadline: string | null
  incident_description: string
  driver: Driver
}

const DRIVER_FIELDS = "driver:drivers(full_name_ar,driver_code),driver_search:drivers()"
const DRIVER_SEARCH = ["full_name_ar", "full_name_en", "driver_code"] as const

// A separate empty embed filters the parent rows without blanking the displayed
// driver when a document field matches instead. Both embeds remain RLS-scoped.
export function attendanceQuery(client: SupabaseClient, search: string, date: string) {
  let query = client.from("driver_attendance")
    .select(`id,driver_id,attendance_date,status,check_in_time,check_out_time,late_minutes,working_day_value,${DRIVER_FIELDS}`, { count: "exact" })
    .is("deleted_at", null).eq("attendance_date", date)
  if (search.trim()) query = query.or(substringFilter(DRIVER_SEARCH, search), { referencedTable: "driver_search" })
    .not("driver_search", "is", null)
  return query.order("created_at", { ascending: false }).order("id")
}

export function performanceQuery(client: SupabaseClient, search: string) {
  let query = client.from("performance_reviews")
    .select(`id,driver_id,review_period,review_date,overall_score,status,${DRIVER_FIELDS}`, { count: "exact" })
    .is("deleted_at", null)
  if (search.trim()) query = query.or(substringFilter(DRIVER_SEARCH, search), { referencedTable: "driver_search" })
    .or(`${substringFilter(["review_period"], search)},driver_search.not.is.null`)
  return query.order("review_date", { ascending: false }).order("id")
}

export function violationsQuery(client: SupabaseClient, search: string) {
  let query = client.from("violations")
    .select(`id,driver_id,violation_ref,incident_date,status,severity,deduction_amount,dispute_deadline,incident_description,${DRIVER_FIELDS}`, { count: "exact" })
    .is("deleted_at", null)
  if (search.trim()) query = query.or(substringFilter(DRIVER_SEARCH, search), { referencedTable: "driver_search" })
    .or(`${substringFilter(["violation_ref", "incident_description"], search)},driver_search.not.is.null`)
  return query.order("created_at", { ascending: false }).order("id")
}

type CountResult = { count: number | null; error: unknown }
async function exactCounts(queries: PromiseLike<CountResult>[]): Promise<number[]> {
  const results = await Promise.all(queries)
  if (results.some(({ error, count }) => error || count === null || !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Could not load overview totals")
  }
  return results.map(({ count }) => count!)
}

export function attendanceSummary(client: SupabaseClient, date: string, signal: AbortSignal) {
  const base = () => client.from("driver_attendance").select("id", { count: "exact", head: true })
    .is("deleted_at", null).eq("attendance_date", date).abortSignal(signal)
  return exactCounts([base(), base().eq("status", "present"), base().eq("status", "late"), base().eq("status", "absent_unexcused")])
}

export function performanceSummary(client: SupabaseClient, signal: AbortSignal) {
  const base = () => client.from("performance_reviews").select("id", { count: "exact", head: true })
    .is("deleted_at", null).abortSignal(signal)
  return exactCounts([base(), base().eq("status", "pending"), base().eq("status", "completed"), base().gte("overall_score", 80)])
}

export async function violationsSummary(client: SupabaseClient, signal: AbortSignal) {
  const base = () => client.from("violations").select("id", { count: "exact", head: true })
    .is("deleted_at", null).abortSignal(signal)
  const [counts, deductions] = await Promise.all([
    exactCounts([base(), base().eq("status", "open"), base().eq("status", "disputed")]),
    // No page-only money total: read just the IDs/amounts, with exact-count,
    // duplicate/change checks and the existing explicit 100,000-row budget.
    collectRows(() => client.from("violations").select("id,deduction_amount", { count: "exact" })
      .is("deleted_at", null).eq("status", "deduction_applied").order("id").abortSignal(signal)),
  ])
  const amounts = deductions.map(({ deduction_amount: amount }) => {
    if ((typeof amount !== "number" && typeof amount !== "string") || !/^\d+(\.\d{1,2})?$/.test(String(amount))) {
      throw new Error("Could not load overview totals")
    }
    return amount as DecimalInput
  })
  return { counts, deductions: amounts.reduce<number>((total, amount) => sumMoney(total, amount), 0) }
}
