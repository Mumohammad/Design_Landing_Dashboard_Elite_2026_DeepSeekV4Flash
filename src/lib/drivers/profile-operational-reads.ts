import type { SupabaseClient } from "@supabase/supabase-js"
import type { HandoverAssignment, HandoverRow } from "@/components/vehicles/fleet-history-panels"
import { collectRows } from "@/lib/reports/collect-rows"
import { GOV_CHECK_TYPES, type GovCheckRow } from "./government-checks"
import { buildScorecard } from "./scorecard"

type DriverDocs = { iqama_expiry_date: string | null; license_expiry_date: string | null; passport_expiry_date: string | null }
type OrderRow = { total_delivered: number | null; total_failed: number | null; total_returned: number | null; working_days: number | null }
type Vehicle = { plate_number: string | null; make: string | null; model: string | null; year: number | null }
export type DriverHandoverForm = HandoverRow & {
  tenant_id: string; photos: string[] | null; driver_signature_url: string | null; supervisor_signature_url: string | null
  vehicle_assignments: { driver_id: string; vehicles: Vehicle | null } | null
}

function shift(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** A latest-row query is deliberately bounded, with count and ID checks. */
function latest<T>(result: { data: unknown[] | null; error: unknown; count: number | null }): T | null {
  const { data, count, error } = result
  if (error || !Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0
    || data.length !== Math.min(1, count) || data.some(row => !row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string")) {
    throw new Error("Latest driver data is unavailable")
  }
  return (data[0] as T | undefined) ?? null
}

/** Every scored history is complete; no failed source is treated as a zero. */
export async function readDriverScorecard(db: SupabaseClient, driverId: string, today: string, signal: AbortSignal) {
  const [year, month] = today.split("-").map(Number)
  const months = [0, 1, 2].map(offset => {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1))
    return `and(period_year.eq.${date.getUTCFullYear()},period_month.eq.${date.getUTCMonth() + 1})`
  }).join(",")
  const [attendance, violations, orders, driver, review] = await Promise.all([
    collectRows(() => db.from("driver_attendance").select("id,status", { count: "exact" })
      .eq("driver_id", driverId).is("deleted_at", null).gte("attendance_date", shift(today, -90)).lte("attendance_date", today)
      .order("id").abortSignal(signal)),
    collectRows(() => db.from("violations").select("id,severity,status", { count: "exact" })
      .eq("driver_id", driverId).is("deleted_at", null).gte("incident_date", shift(today, -180)).lte("incident_date", today)
      .order("id").abortSignal(signal)),
    collectRows(() => db.from("monthly_driver_orders").select("id,total_delivered,total_failed,total_returned,working_days", { count: "exact" })
      .eq("driver_id", driverId).is("deleted_at", null).or(months).order("id").abortSignal(signal)),
    db.from("drivers").select("iqama_expiry_date,license_expiry_date,passport_expiry_date")
      .eq("id", driverId).is("deleted_at", null).abortSignal(signal).maybeSingle(),
    db.from("performance_reviews").select("id,overall_score", { count: "exact" })
      .eq("driver_id", driverId).eq("status", "completed").is("deleted_at", null)
      .order("review_date", { ascending: false }).order("id", { ascending: false }).limit(1).abortSignal(signal),
  ])
  if (driver.error || !driver.data) throw new Error("Driver documents are unavailable")
  const docs = driver.data as DriverDocs
  const last = latest<{ overall_score: number | null }>(review)
  return buildScorecard({
    todayIso: today,
    attendance: attendance as { status: string }[],
    violations: violations as { severity: string | null; status: string | null }[],
    orders: orders as OrderRow[],
    documents: [docs.iqama_expiry_date, docs.license_expiry_date, docs.passport_expiry_date],
    latestReview: last?.overall_score ?? null,
  })
}

/** Six independent latest-row reads cannot crowd an older check type out. */
export async function readLatestGovernmentChecks(db: SupabaseClient, driverId: string, signal: AbortSignal): Promise<GovCheckRow[]> {
  const rows = await Promise.all(GOV_CHECK_TYPES.map(async type => {
    const result = await db.from("driver_government_checks")
      .select("id,check_type,result,reference,notes,checked_on,next_due_on,created_at", { count: "exact" })
      .eq("driver_id", driverId).eq("check_type", type)
      .order("checked_on", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(1).abortSignal(signal)
    const row = latest<GovCheckRow>(result)
    if (row && row.check_type !== type) throw new Error("Government check scope changed")
    return row
  }))
  return rows.filter((row): row is GovCheckRow => row !== null)
}

/** Missing evidence URLs must not quietly produce an incomplete inspection. */
export async function readHandoverEvidenceUrls(db: SupabaseClient, paths: string[], signal?: AbortSignal): Promise<Record<string, string>> {
  const unique = [...new Set(paths)]
  if (!unique.length) return {}
  const urls: Record<string, string> = {}
  // Keep storage requests bounded even for a long handover history.
  for (let offset = 0; offset < unique.length; offset += 100) {
    if (signal?.aborted) throw new Error("Read cancelled")
    const batch = unique.slice(offset, offset + 100)
    const { data, error } = await db.storage.from("handover-evidence").createSignedUrls(batch, 900)
    if (signal?.aborted) throw new Error("Read cancelled")
    if (error || !Array.isArray(data) || data.length !== batch.length) throw new Error("Handover evidence is unavailable")
    for (const row of data) {
      if (row.error || !row.path || !row.signedUrl || !batch.includes(row.path) || urls[row.path]) throw new Error("Handover evidence is incomplete")
      urls[row.path] = row.signedUrl
    }
  }
  return urls
}

export async function readDriverHandovers(db: SupabaseClient, driverId: string, signal: AbortSignal) {
  const [forms, assignments] = await Promise.all([
    collectRows(() => db.from("vehicle_handover_forms")
      .select("*,vehicle_assignments!inner(driver_id,deleted_at,vehicles(plate_number,make,model,year))", { count: "exact" })
      .eq("vehicle_assignments.driver_id", driverId).is("vehicle_assignments.deleted_at", null).is("deleted_at", null)
      .order("form_date", { ascending: false }).order("created_at", { ascending: false }).order("id").abortSignal(signal)),
    collectRows(() => db.from("vehicle_assignments").select("id,driver_id,is_current,assigned_at", { count: "exact" })
      .eq("driver_id", driverId).is("deleted_at", null).order("assigned_at", { ascending: false }).order("id").abortSignal(signal)),
  ])
  if (signal.aborted) throw new Error("Read cancelled")
  const list = forms as DriverHandoverForm[]
  const paths = list.flatMap(form => [...(form.photos ?? []).slice(0, 6), form.driver_signature_url, form.supervisor_signature_url])
    .filter((path): path is string => !!path)
  const urls = await readHandoverEvidenceUrls(db, paths, signal)
  return { list, assignments: assignments as HandoverAssignment[], urls }
}
