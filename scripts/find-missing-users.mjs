#!/usr/bin/env node
// Quick diagnostic: find auth.users that have no matching row in the `users` table.
// Usage: node scripts/find-missing-users.mjs
// Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from "fs"
import { resolve } from "path"
import { createClient } from "@supabase/supabase-js"

// Parse .env.local manually (no dotenv dependency).
function loadEnv() {
  const raw = readFileSync(resolve(".env.local"), "utf-8")
  const env = {}
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return env
}

async function main() {
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
    process.exit(1)
  }

  const supabase = createClient(url, key)

  // 1. Get all auth users
  const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers()
  if (authError) {
    console.error("❌ Failed to list auth users:", authError.message)
    process.exit(1)
  }

  // 2. Get all users rows
  const { data: userRows, error: userError } = await supabase
    .from("users")
    .select("id, auth_user_id, email, role, status, full_name_en")
    .is("deleted_at", null)

  if (userError) {
    console.error("❌ Failed to query users table:", userError.message)
    process.exit(1)
  }

  const authUserIds = new Set(userRows.map((r) => r.auth_user_id))
  const missing = authUsers.users.filter((au) => !authUserIds.has(au.id))

  if (missing.length === 0) {
    console.log("✅ All auth users have a corresponding `users` row.")
    console.log(`   Total auth users: ${authUsers.users.length}`)
    console.log(`   Total users rows: ${userRows.length}`)
    return
  }

  console.log(`\n⚠️  Found ${missing.length} auth user(s) MISSING a \`users\` row:\n`)
  for (const au of missing) {
    console.log(`  auth_user_id : ${au.id}`)
    console.log(`  email        : ${au.email}`)
    console.log(`  confirmed_at : ${au.email_confirmed_at ?? "NOT confirmed"}`)
    console.log(`  created_at   : ${au.created_at}`)
    console.log(`  metadata     : ${JSON.stringify(au.user_metadata)}`)
    console.log()
  }

  // 3. Auto-provision missing users into the default tenant
  console.log("🔧 Auto-provisioning missing users...\n")

  const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001"

  for (const au of missing) {
    const email = au.email
    const name = au.user_metadata?.full_name ?? au.user_metadata?.name ?? email?.split("@")[0] ?? "User"

    // Insert users row
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        auth_user_id: au.id,
        tenant_id: DEFAULT_TENANT,
        email,
        role: "general_manager",
        full_name_ar: name,
        full_name_en: name,
        status: "active",
        must_change_password: false,
        two_factor_enabled: false,
        failed_login_attempts: 0,
        accepted_invite_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (insertError) {
      console.error(`  ❌ Failed to create users row for ${email}: ${insertError.message}`)
      continue
    }

    console.log(`  ✅ Created users row for ${email} (id: ${newUser.id})`)

    // Insert tenant_memberships row
    const { error: memError } = await supabase
      .from("tenant_memberships")
      .insert({ user_id: newUser.id, tenant_id: DEFAULT_TENANT })

    if (memError && !memError.message.includes("duplicate")) {
      console.error(`     ⚠️  tenant_memberships: ${memError.message}`)
    } else {
      console.log(`     ✅ tenant_memberships created`)
    }

    // Insert role assignment
    const { data: roleRow } = await supabase
      .from("roles")
      .select("id")
      .eq("name", "general_manager")
      .eq("tenant_id", DEFAULT_TENANT)
      .is("deleted_at", null)
      .single()

    if (roleRow) {
      const { error: roleError } = await supabase
        .from("user_role_assignments")
        .insert({ user_id: newUser.id, role_id: roleRow.id, tenant_id: DEFAULT_TENANT })

      if (roleError && !roleError.message.includes("duplicate")) {
        console.error(`     ⚠️  role_assignment: ${roleError.message}`)
      } else {
        console.log(`     ✅ role_assignment created`)
      }
    }

    console.log()
  }

  console.log("🎉 Done! Try logging in again.")
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
