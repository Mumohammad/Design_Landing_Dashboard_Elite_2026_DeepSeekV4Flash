// Real-data test path for the drivers module (feat/drivers-module-integration).
//
// Seeds 2 test drivers + every cross-module surface (documents, leave types &
// requests, attendance, violation, training, vehicle assignment, COD session,
// monthly orders, onboarding checklist, assets, photo placeholder) into the
// linked Supabase project so every driver surface renders from real DB rows.
//
// Idempotent: every insert is keyed on a deterministic business key and is
// skipped when it already exists. All rows are tenant-scoped and carry a
// recognizable marker (driver codes ED-SEED-*, refs SEED-*) for easy cleanup.
//
// GUARDED: refuses to run unless NODE_ENV !== "production" AND SEED_ALLOW=true.
// Dates are FIXED (not relative to today) so re-runs stay idempotent.
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8")
  const out: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "").trim()
  }
  return out
}

const env = loadEnv()

if (process.env.NODE_ENV === "production") {
  console.error("REFUSED: NODE_ENV=production. This seed only runs outside production.")
  process.exit(1)
}
if (process.env.SEED_ALLOW !== "true") {
  console.error("REFUSED: set SEED_ALLOW=true to acknowledge seeding the linked dev database.")
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (put them in .env.local).")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TENANT = "00000000-0000-0000-0000-000000000001"

/* ── fixed dates (idempotency) ── */
const D = {
  att: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"],
  attStatus: ["present", "present", "late", "present", "day_off"] as const,
  leaveApproved: { start: "2026-08-10", end: "2026-08-12", days: 3 },
  leavePending: { start: "2026-10-05", end: "2026-10-06", days: 2 },
  violationIncident: "2026-09-10",
  trainingDate: "2026-09-01",
  trainingExpiry: "2027-09-01",
  codSession: "2026-09-15",
  assignedAt: "2026-09-01T08:00:00Z",
  handedOver: "2026-09-02T09:00:00Z",
  periods: [
    { year: 2026, month: 9 },
    { year: 2026, month: 8 },
  ],
}

/* 1x1 PNG so the photo avatar actually renders through the signed-URL provider */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

async function count(t: string): Promise<number> {
  const r = await admin.from(t).select("id", { count: "exact", head: true })
  return r.count ?? 0
}

const TABLES = [
  "leave_types",
  "drivers",
  "driver_documents",
  "driver_leave_requests",
  "driver_attendance",
  "violations",
  "training_records",
  "vehicle_assignments",
  "driver_cod_sessions",
  "monthly_driver_orders",
  "driver_onboarding_checklists",
  "driver_assets",
] as const

const before: Record<string, number> = {}
for (const t of TABLES) before[t] = await count(t)

/* ── leave types (leave_requests FK target — table exists live but empty) ── */
const leaveTypeSpecs = [
  { code: "annual", name_ar: "سنوية", name_en: "Annual", days_per_year: 21, is_paid: true, is_deductible: false },
  { code: "sick", name_ar: "مرضية", name_en: "Sick", days_per_year: 30, is_paid: true, is_deductible: false },
  { code: "emergency", name_ar: "اضطرارية", name_en: "Emergency", days_per_year: 5, is_paid: false, is_deductible: true },
]
const leaveTypeId = new Map<string, string>()
for (const lt of leaveTypeSpecs) {
  const { data: existing } = await admin
    .from("leave_types")
    .select("id")
    .eq("tenant_id", TENANT)
    .eq("code", lt.code)
    .maybeSingle()
  if (existing) {
    leaveTypeId.set(lt.code, existing.id)
    continue
  }
  const { data, error } = await admin
    .from("leave_types")
    .insert({ tenant_id: TENANT, ...lt })
    .select("id")
    .single()
  if (error) {
    console.error("leave_type error:", lt.code, error.message)
    process.exit(1)
  }
  leaveTypeId.set(lt.code, data.id)
  console.log("leave_type ok:", lt.code)
}

/* ── test drivers ── */
const driverSpecs = [
  {
    code: "ED-SEED-1",
    ar: "سائق اختبار الأول",
    en: "Test Driver One",
    mobile: "+966559001001",
    iqama: "2900110011",
    category: "sponsored_type1" as const,
    salary: 5000,
  },
  {
    code: "ED-SEED-2",
    ar: "سائق اختبار الثاني",
    en: "Test Driver Two",
    mobile: "+966559001002",
    iqama: "2900110022",
    category: "freelancer" as const,
    salary: 4200,
  },
]

const drivers: { id: string; code: string }[] = []
for (const d of driverSpecs) {
  const payload = {
    tenant_id: TENANT,
    driver_code: d.code,
    full_name_ar: d.ar,
    full_name_en: d.en,
    nationality: "Saudi",
    nationality_code: "SA",
    iqama_number: d.iqama,
    iqama_expiry_date: "2027-03-31",
    license_number: `SEED-DL-${d.code.slice(-1)}`,
    license_expiry_date: "2026-12-15",
    primary_mobile: d.mobile,
    category: d.category,
    employment_type: "full_time",
    contract_type: "unlimited",
    status: "active",
    hire_date: "2025-01-15",
    basic_salary: d.salary,
    city_zone: "Buraydah",
    profile_completeness_score: 90,
    compliance_risk_score: 10,
    documents_complete: true,
    priority: "normal",
  }
  const { data: existing } = await admin
    .from("drivers")
    .select("id")
    .eq("driver_code", d.code)
    .maybeSingle()
  if (existing) {
    drivers.push({ id: existing.id, code: d.code })
    console.log("driver ok (existing):", d.code)
    continue
  }
  const { data, error } = await admin.from("drivers").insert(payload).select("id").single()
  if (error) {
    console.error("driver insert error:", d.code, error.message)
    process.exit(1)
  }
  drivers.push({ id: data.id, code: d.code })
  console.log("driver ok:", d.code)
}

/* ── photo placeholder rows (+ tiny PNG in storage so the provider signs it) ── */
for (const d of drivers) {
  const path = `${TENANT}/${d.id}/photo-seed.png`
  const { error: upErr } = await admin.storage
    .from("driver-photos")
    .upload(path, PLACEHOLDER_PNG, { contentType: "image/png", upsert: true })
  if (upErr && !String(upErr.message).includes("exists")) {
    console.error("photo upload error:", d.code, upErr.message)
    continue
  }
  await admin.from("drivers").update({ photo_url: path }).eq("id", d.id)
  console.log("photo ok:", d.code)
}

/* ── documents: 3 per driver ── */
const docSpecs = [
  { doc_type: "iqama", number: "IQ", expiry: "2027-03-31", verified: true },
  { doc_type: "driving_license", number: "DL", expiry: "2026-12-15", verified: true },
  { doc_type: "medical_certificate", number: "MC", expiry: "2026-10-31", verified: false },
] as const

let docs = 0
for (const d of drivers) {
  for (const s of docSpecs) {
    const { data: existing } = await admin
      .from("driver_documents")
      .select("id")
      .eq("driver_id", d.id)
      .eq("doc_type", s.doc_type)
      .is("deleted_at", null)
      .maybeSingle()
    if (existing) continue
    const { error } = await admin.from("driver_documents").insert({
      tenant_id: TENANT,
      driver_id: d.id,
      doc_type: s.doc_type,
      doc_number: `SEED-${s.number}-${d.code.slice(-1)}`,
      issue_date: "2026-01-10",
      expiry_date: s.expiry,
      issuing_authority: "Seed",
      file_url: `/seed-placeholders/${s.doc_type}.pdf`,
      file_size_bytes: 1024,
      mime_type: "application/pdf",
      is_verified: s.verified,
    })
    if (error) console.error("document error:", d.code, s.doc_type, error.message)
    else docs++
  }
}
if (docs) console.log("documents ok:", docs)

/* ── leave requests: 2 per driver (1 approved past, 1 pending future) ── */
let leaves = 0
for (const d of drivers) {
  for (const [spec, status, code] of [
    [D.leaveApproved, "approved", "annual"],
    [D.leavePending, "pending", "emergency"],
  ] as const) {
    const { data: existing } = await admin
      .from("driver_leave_requests")
      .select("id")
      .eq("driver_id", d.id)
      .eq("start_date", spec.start)
      .eq("end_date", spec.end)
      .maybeSingle()
    if (existing) continue
    const { error } = await admin.from("driver_leave_requests").insert({
      tenant_id: TENANT,
      driver_id: d.id,
      leave_type_id: leaveTypeId.get(code)!,
      start_date: spec.start,
      end_date: spec.end,
      days_requested: spec.days,
      reason: "Seed test data",
      status,
    })
    if (error) console.error("leave error:", d.code, error.message)
    else leaves++
  }
}
if (leaves) console.log("leave_requests ok:", leaves)

/* ── attendance: 5 days per driver ── */
let att = 0
for (const d of drivers) {
  for (let i = 0; i < D.att.length; i++) {
    const day = D.att[i]
    const status = D.attStatus[i]
    const { data: existing } = await admin
      .from("driver_attendance")
      .select("id")
      .eq("driver_id", d.id)
      .eq("attendance_date", day)
      .maybeSingle()
    if (existing) continue
    const { error } = await admin.from("driver_attendance").insert({
      tenant_id: TENANT,
      driver_id: d.id,
      attendance_date: day,
      status,
      check_in_time: status === "day_off" ? null : `${day}T08:00:00Z`,
      check_out_time: status === "day_off" ? null : `${day}T17:00:00Z`,
      late_minutes: status === "late" ? 25 : 0,
      overtime_minutes: 0,
      entry_method: "manual",
      notes: "Seed test data",
    })
    if (error) console.error("attendance error:", d.code, day, error.message)
    else att++
  }
}
if (att) console.log("attendance ok:", att)

/* ── violations: 1 per driver (deterministic unique ref) ── */
let vio = 0
for (const d of drivers) {
  const ref = `VIO-SEED-${d.code.slice(-1)}`
  const { data: existing } = await admin
    .from("violations")
    .select("id")
    .eq("violation_ref", ref)
    .maybeSingle()
  if (existing) continue
  const { error } = await admin.from("violations").insert({
    tenant_id: TENANT,
    driver_id: d.id,
    violation_ref: ref,
    source: "manual",
    severity: "minor",
    incident_date: D.violationIncident,
    incident_location: "Buraydah",
    incident_description: "Speeding on delivery route (seed)",
    deduction_amount: 150,
    status: "open",
  })
  if (error) console.error("violation error:", d.code, error.message)
  else vio++
}
if (vio) console.log("violations ok:", vio)

/* ── training: 1 per driver ── */
let trn = 0
for (const d of drivers) {
  const { data: existing } = await admin
    .from("training_records")
    .select("id")
    .eq("driver_id", d.id)
    .eq("course_name", "Defensive Driving (seed)")
    .maybeSingle()
  if (existing) continue
  const { error } = await admin.from("training_records").insert({
    tenant_id: TENANT,
    driver_id: d.id,
    course_name: "Defensive Driving (seed)",
    training_date: D.trainingDate,
    expiry_date: D.trainingExpiry,
    provider: "Seed Academy",
    score: 92,
    is_passed: true,
  })
  if (error) console.error("training error:", d.code, error.message)
  else trn++
}
if (trn) console.log("training ok:", trn)

/* ── vehicle assignment: 1 (driver 1 → EDV-007); driver 2 stays empty by design ── */
{
  const d1 = drivers[0]
  const { data: vehicle } = await admin
    .from("vehicles")
    .select("id, vehicle_code")
    .eq("tenant_id", TENANT)
    .eq("vehicle_code", "EDV-007")
    .is("deleted_at", null)
    .maybeSingle()
  if (vehicle) {
    const { data: existing } = await admin
      .from("vehicle_assignments")
      .select("id")
      .eq("driver_id", d1.id)
      .eq("is_current", true)
      .is("deleted_at", null)
      .maybeSingle()
    if (!existing) {
      const { error } = await admin.from("vehicle_assignments").insert({
        tenant_id: TENANT,
        vehicle_id: vehicle.id,
        driver_id: d1.id,
        assigned_at: D.assignedAt,
        is_current: true,
        assignment_reason: "Seed test assignment",
      })
      if (error) console.error("assignment error:", error.message)
      else {
        console.log("vehicle_assignment ok: ED-SEED-1 -> EDV-007")
        await admin.from("drivers").update({ current_vehicle_id: vehicle.id }).eq("id", d1.id)
      }
    }
  } else {
    console.error("vehicle EDV-007 not found — run scripts/seed-demo-data.mjs first")
  }
}

/* ── COD session: 1 per driver ── */
const { data: platform } = await admin
  .from("delivery_platforms")
  .select("id, code")
  .eq("tenant_id", TENANT)
  .eq("code", "hungerstation")
  .maybeSingle()

let cod = 0
if (platform) {
  for (const d of drivers) {
    const ref = `SEED-COD-${d.code.slice(-1)}`
    const { data: existing } = await admin
      .from("driver_cod_sessions")
      .select("id")
      .eq("driver_id", d.id)
      .eq("session_ref", ref)
      .maybeSingle()
    if (existing) continue
    const { error } = await admin.from("driver_cod_sessions").insert({
      tenant_id: TENANT,
      driver_id: d.id,
      platform_id: platform.id,
      session_date: D.codSession,
      session_ref: ref,
      orders_with_cod: 6,
      cod_collected: 210.5,
      cod_submitted: 210.5,
      submission_date: D.codSession,
      submission_method: "cash_handover",
      status: "reconciled",
    })
    if (error) console.error("cod error:", d.code, error.message)
    else cod++
  }
} else {
  console.error("platform hungerstation not found — run scripts/seed-demo-data.mjs first")
}
if (cod) console.log("cod_sessions ok:", cod)

/* ── monthly orders: 2 periods per driver (payroll KPI feed) ── */
let orders = 0
for (const d of drivers) {
  for (const p of D.periods) {
    const { data: existing } = await admin
      .from("monthly_driver_orders")
      .select("id")
      .eq("driver_id", d.id)
      .eq("period_year", p.year)
      .eq("period_month", p.month)
      .is("deleted_at", null)
      .maybeSingle()
    if (existing) continue
    const delivered = d.code === "ED-SEED-1" ? 320 : 275
    const { error } = await admin.from("monthly_driver_orders").insert({
      tenant_id: TENANT,
      driver_id: d.id,
      platform_id: platform?.id ?? null,
      period_year: p.year,
      period_month: p.month,
      total_delivered: delivered,
      total_failed: 8,
      total_returned: 4,
      total_revenue: delivered * 4.5,
      working_days: 24,
    })
    if (error) console.error("orders error:", d.code, p.year, p.month, error.message)
    else orders++
  }
}
if (orders) console.log("monthly_orders ok:", orders)

/* ── onboarding checklist: 4 steps per driver (2 done → 50% chip) ── */
const steps = [
  { name: "Sign employment contract", status: "completed" },
  { name: "Issue uniform & badge", status: "completed" },
  { name: "Vehicle handover briefing", status: "in_progress" },
  { name: "COD policy training", status: "pending" },
]
let stepsDone = 0
for (const d of drivers) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const { data: existing } = await admin
      .from("driver_onboarding_checklists")
      .select("id")
      .eq("driver_id", d.id)
      .eq("step_name", s.name)
      .is("deleted_at", null)
      .maybeSingle()
    if (existing) continue
    const { error } = await admin.from("driver_onboarding_checklists").insert({
      tenant_id: TENANT,
      driver_id: d.id,
      step_name: s.name,
      step_order: i + 1,
      status: s.status,
      completed_at: s.status === "completed" ? D.handedOver : null,
    })
    if (error) console.error("onboarding error:", d.code, s.name, error.message)
    else stepsDone++
  }
}
if (stepsDone) console.log("onboarding_steps ok:", stepsDone)

/* ── assets issued ── */
const assetSpecs = [
  { driver: 0, asset_type: "Delivery Bag", serial: "SEED-BAG-001", returned: false },
  { driver: 0, asset_type: "POS Device", serial: "SEED-POS-001", returned: false },
  { driver: 1, asset_type: "Delivery Bag", serial: "SEED-BAG-002", returned: true },
]
let assets = 0
for (const a of assetSpecs) {
  const d = drivers[a.driver]
  const { data: existing } = await admin
    .from("driver_assets")
    .select("id")
    .eq("driver_id", d.id)
    .eq("serial", a.serial)
    .is("deleted_at", null)
    .maybeSingle()
  if (existing) continue
  const { error } = await admin.from("driver_assets").insert({
    tenant_id: TENANT,
    driver_id: d.id,
    asset_type: a.asset_type,
    serial: a.serial,
    condition: "good",
    handed_over_at: D.handedOver,
    returned_at: a.returned ? D.handedOver : null,
    handover_ref: `SEED-HO-${a.serial.slice(-3)}`,
    notes: "Seed test data",
  })
  if (error) console.error("asset error:", d.code, a.serial, error.message)
  else assets++
}
if (assets) console.log("assets ok:", assets)

/* ── before/after row counts (for the PR description) ── */
console.log("\nRow counts (before → after):")
for (const t of TABLES) {
  const after = await count(t)
  console.log(`  ${t.padEnd(30)} ${String(before[t]).padStart(5)} → ${String(after).padStart(5)}`)
}

console.log("\nSeed complete.")
