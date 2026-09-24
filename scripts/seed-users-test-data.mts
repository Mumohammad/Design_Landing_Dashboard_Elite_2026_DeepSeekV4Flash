// Real-data test path for the Users module (Module 14).
//
// Seeds deterministic, marked test users (employee codes ED-SEED-USERS-*,
// emails ED-SEED-USERS-*) into the linked Supabase project so every users
// surface renders from real DB rows:
//   - 1 active GM-profile viewer, 1 active supervisor, 1 pending_invite,
//     1 locked, 1 inactive
//   - employee codes issued through next_employee_code() where missing
//   - user_consents rows (terms/privacy) so the PDPL gate has a true case
//     and an unconsented user exercises the masking path
//
// Idempotent: keyed on email; re-runs top up missing rows only. Users carry
// auth.users rows (required FK) created with admin.createUser and marked via
// user_metadata._users_seed = true.
//
// GUARDED: refuses to run unless NODE_ENV !== "production" AND SEED_ALLOW=true.
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
const MARK = "ED-SEED-USERS"

/* ── fixed dates (idempotency) ── */
const D = {
  invitedAt: "2026-09-01T08:00:00Z",
  acceptedAt: "2026-09-02T09:00:00Z",
  lastLogin: "2026-09-20T12:30:00Z",
}

type UserSpec = {
  slug: string
  email: string
  ar: string
  en: string
  role: string
  status: "active" | "inactive" | "locked" | "pending_invite"
  phone: string | null
  code: string
  consents: boolean
}

const SPECS: UserSpec[] = [
  {
    slug: "viewer",
    email: `${MARK}-viewer@test.local`,
    ar: "مشاهدة المستخدمين (بذرة)",
    en: "Users Seed Viewer",
    role: "readonly_auditor",
    status: "active",
    phone: "+966559002001",
    code: `${MARK}-CODE-1`,
    consents: true,
  },
  {
    slug: "supervisor",
    email: `${MARK}-supervisor@test.local`,
    ar: "مشرف المستخدمين (بذرة)",
    en: "Users Seed Supervisor",
    role: "supervisor",
    status: "active",
    phone: "+966559002002",
    code: `${MARK}-CODE-2`,
    consents: true,
  },
  {
    slug: "pending",
    email: `${MARK}-pending@test.local`,
    ar: "دعوة معلقة (بذرة)",
    en: "Users Seed Pending",
    role: "operations_officer",
    status: "pending_invite",
    phone: null,
    code: `${MARK}-CODE-3`,
    consents: false,
  },
  {
    slug: "locked",
    email: `${MARK}-locked@test.local`,
    ar: "حساب مقفل (بذرة)",
    en: "Users Seed Locked",
    role: "accountant",
    status: "locked",
    phone: "+966559002004",
    code: null,
    consents: false,
  },
  {
    slug: "inactive",
    email: `${MARK}-inactive@test.local`,
    ar: "حساب غير نشط (بذرة)",
    en: "Users Seed Inactive",
    role: "hr_officer",
    status: "inactive",
    phone: "+966559002005",
    code: null,
    consents: false,
  },
]

async function ensureAuthUser(email: string): Promise<string> {
  // Look up by email via the public users table first (idempotent re-runs).
  const { data: existingProfile } = await admin
    .from("users")
    .select("auth_user_id")
    .eq("email", email)
    .maybeSingle()
  if (existingProfile?.auth_user_id) return existingProfile.auth_user_id as string

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Seed-${crypto.randomUUID().slice(0, 16)}`,
    email_confirm: true,
    user_metadata: { full_name: email, _users_seed: true },
  })
  if (error) throw new Error(`auth.createUser(${email}): ${error.message}`)
  if (!data.user) throw new Error(`auth.createUser(${email}) returned no user`)
  return data.user.id
}

async function count(t: string): Promise<number> {
  const r = await admin.from(t).select("id", { count: "exact", head: true })
  return r.count ?? 0
}

const before = { users: await count("users"), user_consents: await count("user_consents") }

let created = 0
let updated = 0
const consentRows: { tenant_id: string; user_id: string; consent_type: string; version: string; accepted: boolean; accepted_at: string }[] = []

for (const s of SPECS) {
  const authUserId = await ensureAuthUser(s.email)

  const { data: existing } = await admin
    .from("users")
    .select("id, employee_code")
    .eq("auth_user_id", authUserId)
    .maybeSingle()

  const payload = {
    tenant_id: TENANT,
    email: s.email,
    role: s.role,
    status: s.status,
    full_name_ar: s.ar,
    full_name_en: s.en,
    phone: s.phone,
    invited_at: D.invitedAt,
    accepted_invite_at: s.status === "pending_invite" ? null : D.acceptedAt,
    last_login_at: s.status === "active" ? D.lastLogin : null,
  }

  if (!existing) {
    const { data, error } = await admin
      .from("users")
      .insert({ ...payload, auth_user_id: authUserId, employee_code: s.code })
      .select("id")
      .single()
    if (error) {
      console.error("users insert error:", s.email, error.message)
      process.exit(1)
    }
    consentRowsSeed(data.id, s)
    created++
    console.log("user ok:", s.email)
  } else {
    const { error } = await admin.from("users").update(payload).eq("id", existing.id)
    if (error) {
      console.error("users update error:", s.email, error.message)
      process.exit(1)
    }
    if (!existing.employee_code && s.code) {
      await admin.from("users").update({ employee_code: s.code }).eq("id", existing.id)
    }
    consentRowsSeed(existing.id, s)
    updated++
    console.log("user ok (existing):", s.email)
  }
}

/* consent rows go through the same idempotent UNIQUE key (tenant,user,type,version) */
function consentRowsSeed(userId: string, s: UserSpec) {
  if (!s.consents) return
  for (const type of ["terms", "privacy"]) {
    consentRows.push({
      tenant_id: TENANT,
      user_id: userId,
      consent_type: type,
      // version 2 outranks the seed.sql per-tenant consent (version 1) so
      // has_user_pdpl_consent() (latest-version gate) opens for these users
      version: "2",
      accepted: true,
      accepted_at: D.acceptedAt,
    })
  }
}

let consents = 0
for (const row of consentRows) {
  const { error } = await admin.from("user_consents").upsert(row, {
    onConflict: "tenant_id,user_id,consent_type,version",
    ignoreDuplicates: true,
  })
  if (error) {
    console.error("user_consents error:", row.user_id, row.consent_type, error.message)
    process.exit(1)
  }
  consents++
}
if (consents) console.log("user_consents ok:", consents, "(upserted/verified)")

const after = { users: await count("users"), user_consents: await count("user_consents") }

console.log("\nRow counts (before → after):")
console.log(`  users          ${String(before.users).padStart(5)} → ${String(after.users).padStart(5)}`)
console.log(`  user_consents  ${String(before.user_consents).padStart(5)} → ${String(after.user_consents).padStart(5)}`)

console.log("\nSeed complete. Users created:", created, "| refreshed:", updated)
