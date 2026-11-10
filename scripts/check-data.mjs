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

const tables = ["drivers", "vehicles", "delivery_platforms", "users", "orders", "payroll_runs", "expenses", "attendance"]
for (const t of tables) {
  const { count, error } = await admin.from(t).select("*", { count: "exact", head: true })
  console.log(t.padEnd(20), count ?? `ERR: ${error?.message}`)
}
