// One-off dev helper: create a GM test user for browser verification.
// Creates an auth.users row (email-confirmed) + the custom `users` row
// (role=general_manager, status=active) so middleware/authz accept the login.
// Credentials are written to /tmp/gm-test-creds.txt (mode 0600).
// Usage: node scripts/create-gm-test-user.mjs
import { readFileSync, writeFileSync, chmodSync } from "node:fs"
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
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const email = `final-verify-${Date.now()}@elite.local`
const password = "EliteVerify2026!" + Math.floor(1000 + Math.random() * 9000)
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { email_verified: true },
})
if (authErr || !authUser?.user) {
  console.error("auth.admin.createUser failed:", authErr?.message ?? "no user")
  process.exit(1)
}

// Tenant row for the default tenant + tenant_membership for completeness
const tenantId = "00000000-0000-0000-0000-000000000001"
const { error: usersErr } = await admin.from("users").insert({
  auth_user_id: authUser.user.id,
  tenant_id: tenantId,
  email,
  role: "general_manager",
  status: "active",
  full_name_ar: "مدير عام (تحقق)",
  full_name_en: "Verify GM",
  must_change_password: false,
  accepted_invite_at: new Date().toISOString(),
})
if (usersErr) {
  console.error("users insert failed:", usersErr.message)
  process.exit(1)
}

const { error: tmErr } = await admin.from("tenant_memberships").insert({
  tenant_id: tenantId,
  user_id: authUser.user.id,
  role: "general_manager",
}).maybeSingle()
if (tmErr) console.warn("tenant_memberships insert warning:", tmErr.message)

const creds = `email: ${email}\npassword: ${password}\nurl: ${url}\n`
writeFileSync("/tmp/gm-test-creds.txt", creds, { mode: 0o600 })
console.log("Created GM test user:")
console.log("  email:", email)
console.log("  password:", password)
console.log("  auth_user_id:", authUser.user.id)
console.log("Credentials saved to /tmp/gm-test-creds.txt")
