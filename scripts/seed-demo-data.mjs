// Dev helper: seed the linked Supabase project with realistic demo data
// (delivery platforms, drivers, vehicles) so module pages and the dashboard
// render real content for screenshots / verification.
// Idempotent per run for platforms; drivers/vehicles use a fixed tenant.
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

function loadEnv() {
  const raw = readFileSync(".env.local", "utf8")
  const out = {}
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "").trim()
  }
  return out
}

const env = loadEnv()
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TENANT = "00000000-0000-0000-0000-000000000001"

/* ── Delivery platforms ── */
const platforms = [
  { code: "hungerstation", name_ar: "هنقرستيشن", name_en: "HungerStation", brand_color: "#E87D3E", rate_type: "distance_based", rate_per_order: 5.0, sort_order: 10 },
  { code: "jahez", name_ar: "جاهز", name_en: "Jahez", brand_color: "#1E5A99", rate_type: "flat", rate_per_order: 4.5, sort_order: 20 },
  { code: "keeta", name_ar: "كيتا", name_en: "Keeta", brand_color: "#FFC107", rate_type: "flat", rate_per_order: 4.0, sort_order: 30 },
  { code: "toyou", name_ar: "تويو", name_en: "ToYou", brand_color: "#10B981", rate_type: "flat", rate_per_order: 4.25, sort_order: 40 },
  { code: "mrsool", name_ar: "مرسول", name_en: "Mrsool", brand_color: "#8B5CF6", rate_type: "flat", rate_per_order: 4.75, sort_order: 50 },
  { code: "ninja", name_ar: "نينجا", name_en: "Ninja", brand_color: "#EF4444", rate_type: "flat", rate_per_order: 3.75, sort_order: 60 },
]

for (const p of platforms) {
  const { data: existing } = await admin
    .from("delivery_platforms")
    .select("id")
    .eq("tenant_id", TENANT)
    .eq("code", p.code)
    .is("deleted_at", null)
    .maybeSingle()

  if (existing) {
    const { error } = await admin
      .from("delivery_platforms")
      .update({ ...p })
      .eq("id", existing.id)
    if (error) console.error("platform update error:", p.code, error.message)
    else console.log("platform ok (updated):", p.code)
  } else {
    const { error } = await admin.from("delivery_platforms").insert({
      tenant_id: TENANT,
      ...p,
    })
    if (error) console.error("platform insert error:", p.code, error.message)
    else console.log("platform ok (inserted):", p.code)
  }
}

const { data: platformRows } = await admin
  .from("delivery_platforms")
  .select("id, code")
  .eq("tenant_id", TENANT)

const platformId = (code) => platformRows?.find((p) => p.code === code)?.id

/* ── Drivers ── */
const drivers = [
  { code: "ED-1001", ar: "أحمد العتيبي", en: "Ahmed Alotaibi", nat: "Saudi", iqama: "2123456789", mobile: "+966551234501", category: "sponsored_type1", status: "active", hire: "2022-05-01", salary: 5200 },
  { code: "ED-1002", ar: "محمد القحطاني", en: "Mohammed Alqahtani", nat: "Saudi", iqama: "2123456790", mobile: "+966551234502", category: "sponsored_type2", status: "active", hire: "2023-02-12", salary: 4800 },
  { code: "ED-1003", ar: "خالد الشمري", en: "Khaled Alshammari", nat: "Saudi", iqama: "2123456791", mobile: "+966551234503", category: "sponsored_type1", status: "active", hire: "2021-11-20", salary: 5400 },
  { code: "ED-1004", ar: "عبدالله الحربي", en: "Abdullah Alharbi", nat: "Saudi", iqama: "2123456792", mobile: "+966551234504", category: "freelancer", status: "on_leave", hire: "2024-01-15", salary: 4100 },
  { code: "ED-1005", ar: "سعد المطيري", en: "Saad Almutairi", nat: "Saudi", iqama: "2123456793", mobile: "+966551234505", category: "sponsored_type1", status: "active", hire: "2020-08-03", salary: 5600 },
  { code: "ED-1006", ar: "فهد العنزي", en: "Fahad Alanazi", nat: "Saudi", iqama: "2123456794", mobile: "+966551234506", category: "sponsored_type2", status: "active", hire: "2023-06-25", salary: 4700 },
  { code: "ED-1007", ar: "ناصر الدوسري", en: "Nasser Aldosari", nat: "Saudi", iqama: "2123456795", mobile: "+966551234507", category: "sponsored_type1", status: "suspended", hire: "2022-09-10", salary: 5000 },
  { code: "ED-1008", ar: "عبدالرحمن السبيعي", en: "Abdulrahman Alsubaie", nat: "Saudi", iqama: "2123456796", mobile: "+966551234508", category: "freelancer", status: "active", hire: "2024-03-01", salary: 4300 },
  { code: "ED-1009", ar: "سلطان الزهراني", en: "Sultan Alzahrani", nat: "Saudi", iqama: "2123456797", mobile: "+966551234509", category: "sponsored_type1", status: "active", hire: "2021-04-18", salary: 5300 },
  { code: "ED-1010", ar: "ماجد الغامدي", en: "Majed Alghamdi", nat: "Saudi", iqama: "2123456798", mobile: "+966551234510", category: "sponsored_type2", status: "on_leave", hire: "2023-10-05", salary: 4600 },
  { code: "ED-1011", ar: "تركي البقمي", en: "Turki Albaqmi", nat: "Saudi", iqama: "2123456799", mobile: "+966551234511", category: "sponsored_type1", status: "active", hire: "2022-02-22", salary: 5100 },
  { code: "ED-1012", ar: "بندر المالكي", en: "Bandar Almalki", nat: "Saudi", iqama: "2123456800", mobile: "+966551234512", category: "freelancer", status: "active", hire: "2024-06-01", salary: 4200 },
]

const driverRows = []
for (const d of drivers) {
  const { data, error } = await admin.from("drivers").insert({
    tenant_id: TENANT,
    driver_code: d.code,
    full_name_ar: d.ar,
    full_name_en: d.en,
    nationality: d.nat,
    nationality_code: "SA",
    iqama_number: d.iqama,
    iqama_expiry_date: "2026-12-31",
    license_number: `DL-${1000 + driverRows.length}`,
    license_expiry_date: "2026-06-30",
    primary_mobile: d.mobile,
    category: d.category,
    employment_type: "full_time",
    contract_type: "unlimited",
    status: d.status,
    hire_date: d.hire,
    basic_salary: d.salary,
    city_zone: "Buraydah",
    profile_completeness_score: 92,
    compliance_risk_score: 8,
    documents_complete: true,
    priority: "normal",
  }).select("id").single()
  if (error) console.error("driver insert error:", d.code, error.message)
  else {
    console.log("driver ok:", d.code)
    driverRows.push({ id: data.id, code: d.code })
  }
}

/* ── Vehicles ── */
const vehicles = [
  { code: "EDV-011", plate: "ح 1234 ب", make: "Toyota", model: "Hilux", year: 2021, color: "White", status: "assigned", condition: "good", fuel: "diesel", odometer: 84500, ins: "2026-09-30", reg: "2026-10-18", insp: "2026-06-15" },
  { code: "EDV-007", plate: "د 5678 أ", make: "Nissan", model: "Navara", year: 2020, color: "Silver", status: "available", condition: "excellent", fuel: "diesel", odometer: 112300, ins: "2026-12-12", reg: "2026-01-20", insp: "2026-02-10" },
  { code: "EDV-015", plate: "س 9901 ج", make: "Hyundai", model: "H-1", year: 2022, color: "Gray", status: "assigned", condition: "good", fuel: "diesel", odometer: 61200, ins: "2027-03-05", reg: "2026-04-22", insp: "2026-08-30" },
  { code: "EDV-003", plate: "ن 4521 د", make: "Toyota", model: "Corolla", year: 2019, color: "Black", status: "in_maintenance", condition: "fair", fuel: "petrol", odometer: 156700, ins: "2026-11-02", reg: "2026-07-19", insp: "2026-01-28" },
  { code: "EDV-021", plate: "ع 7740 ه", make: "Kia", model: "Carnival", year: 2023, color: "White", status: "available", condition: "excellent", fuel: "petrol", odometer: 32400, ins: "2027-06-14", reg: "2026-05-30", insp: "2026-09-25" },
  { code: "EDV-009", plate: "ق 6188 و", make: "Chevrolet", model: "Caprice", year: 2018, color: "Silver", status: "assigned", condition: "good", fuel: "petrol", odometer: 189200, ins: "2026-10-08", reg: "2026-08-11", insp: "2026-04-17" },
  { code: "EDV-017", plate: "م 3002 ز", make: "GMC", model: "Yukon", year: 2021, color: "Black", status: "off_road", condition: "poor", fuel: "petrol", odometer: 132900, ins: "2026-12-01", reg: "2026-02-28", insp: "2026-11-12" },
  { code: "EDV-005", plate: "ب 8813 ح", make: "Ford", model: "Ranger", year: 2022, color: "Red", status: "available", condition: "good", fuel: "diesel", odometer: 52300, ins: "2027-01-22", reg: "2026-09-14", insp: "2026-05-06" },
  { code: "EDV-019", plate: "ل 2467 ط", make: "Hyundai", model: "Staria", year: 2023, color: "Gray", status: "assigned", condition: "excellent", fuel: "diesel", odometer: 27800, ins: "2027-08-09", reg: "2026-06-27", insp: "2026-10-03" },
  { code: "EDV-013", plate: "ز 7055 ي", make: "Isuzu", model: "D-Max", year: 2020, color: "White", status: "in_maintenance", condition: "fair", fuel: "diesel", odometer: 143600, ins: "2026-11-18", reg: "2026-03-16", insp: "2026-12-21" },
]

for (const v of vehicles) {
  const { error } = await admin.from("vehicles").insert({
    tenant_id: TENANT,
    vehicle_code: v.code,
    plate_number: v.plate,
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    status: v.status,
    condition_status: v.condition,
    fuel_type: v.fuel,
    odometer_current: v.odometer,
    odometer_unit: "km",
    insurance_expiry: v.ins,
    registration_expiry: v.reg,
    inspection_expiry: v.insp,
  })
  if (error) console.error("vehicle insert error:", v.code, error.message)
  else console.log("vehicle ok:", v.code)
}

/* ── Link assigned drivers to vehicles + platforms ── */
const { data: vehicleRows } = await admin
  .from("vehicles")
  .select("id, vehicle_code")
  .eq("tenant_id", TENANT)

const vehicleId = (code) => vehicleRows?.find((v) => v.vehicle_code === code)?.id

const assignment = [
  { driver: "ED-1001", vehicle: "EDV-011", platform: "hungerstation" },
  { driver: "ED-1002", vehicle: "EDV-007", platform: "jahez" },
  { driver: "ED-1003", vehicle: "EDV-015", platform: "hungerstation" },
  { driver: "ED-1005", vehicle: "EDV-009", platform: "keeta" },
  { driver: "ED-1006", vehicle: "EDV-019", platform: "jahez" },
  { driver: "ED-1008", vehicle: "EDV-005", platform: "toyou" },
  { driver: "ED-1009", vehicle: "EDV-017", platform: "hungerstation" },
  { driver: "ED-1011", vehicle: "EDV-013", platform: "mrsool" },
  { driver: "ED-1012", vehicle: "EDV-021", platform: "ninja" },
]

for (const a of assignment) {
  const driver = driverRows.find((d) => d.code === a.driver)
  if (!driver) continue
  const { error } = await admin
    .from("drivers")
    .update({
      current_vehicle_id: vehicleId(a.vehicle),
      primary_platform_id: platformId(a.platform),
      dispatch_eligible: true,
    })
    .eq("id", driver.id)
  if (error) console.error("assign error:", a.driver, error.message)
  else console.log("assigned:", a.driver, "->", a.vehicle, "/", a.platform)
}

console.log("\nSeed complete.")
