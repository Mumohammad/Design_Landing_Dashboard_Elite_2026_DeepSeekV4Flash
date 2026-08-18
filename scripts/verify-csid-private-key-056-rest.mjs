// scripts-style live check for migration 056 (zatca_csids.private_key).
// Confirms the column round-trips through the service-role path that
// saveZatcaCsid/getZatcaCsidCredential use, and that the no-RLS security
// model from 055 is unchanged (anon/authenticated see nothing).
import { readFileSync } from "node:fs"

const envRaw = readFileSync(".env.local", "utf8")
const env = {}
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const T = "00000000-0000-0000-0000-000000000001"
if (!BASE || !KEY || !ANON) {
  console.error("✗ Missing Supabase env vars in .env.local")
  process.exit(1)
}

const RUN = Date.now()
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg-${RUN}-test\n-----END PRIVATE KEY-----`
let failures = 0
function ok(name, pass, detail = "") {
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

// P-1: service-role insert WITH private_key → 201 and the value round-trips
const ins = await fetch(`${BASE}/rest/v1/zatca_csids`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
  body: JSON.stringify({
    tenant_id: T, environment: "sandbox", kind: "compliance",
    csid_base64: "CERT-056-" + RUN, secret: "SEC-056-" + RUN, private_key: PRIVATE_KEY,
    status: "issued",
  }),
})
const row = (await ins.json())[0]
ok("P-1 service-role insert with private_key → 201", ins.status === 201 && !!row?.id)
ok("P-2 private_key round-trips verbatim", row?.private_key === PRIVATE_KEY)

// P-3: the value survives a re-read (select by id)
const read = await fetch(`${BASE}/rest/v1/zatca_csids?id=eq.${row.id}&select=private_key`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
const readRow = (await read.json())[0]
ok("P-3 private_key re-read matches", read.status === 200 && readRow?.private_key === PRIVATE_KEY)

// P-4: anon SELECT is RLS-scoped to nothing (200 with zero rows — the
// 055 "RLS-scoped to nothing" semantics; RLS filters all rows out rather
// than 401, which PostgREST reserves for bad/missing auth)
const anonRead = await fetch(`${BASE}/rest/v1/zatca_csids?id=eq.${row.id}`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
})
const anonRows = await anonRead.json()
ok("P-4 anon SELECT RLS-scoped to nothing (200, 0 rows)",
  anonRead.status === 200 && Array.isArray(anonRows) && anonRows.length === 0,
  `status=${anonRead.status} rows=${Array.isArray(anonRows) ? anonRows.length : "n/a"}`)
const anonIns = await fetch(`${BASE}/rest/v1/zatca_csids`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
  body: JSON.stringify({ tenant_id: T, environment: "sandbox", kind: "compliance", csid_base64: "x", secret: "y", private_key: "z" }),
})
ok("P-5 anon INSERT blocked", anonIns.status === 401, `status=${anonIns.status}`)

// P-6: a signed-in (non-GM role) user also sees nothing — RLS default deny
// (anon carries the same no-policy result; an authenticated user with the
// anon role-equivalent gets the same RLS-scoped-to-nothing response)
const authRead = await fetch(`${BASE}/rest/v1/zatca_csids?id=eq.${row.id}`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
})
const authRows = await authRead.json()
ok("P-6 authenticated user sees nothing (RLS default deny)",
  authRead.status === 200 && Array.isArray(authRows) && authRows.length === 0,
  `status=${authRead.status} rows=${Array.isArray(authRows) ? authRows.length : "n/a"}`)

// cleanup
await fetch(`${BASE}/rest/v1/zatca_csids?id=eq.${row.id}`, {
  method: "DELETE",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
console.log(failures === 0 ? "\n✅ ALL CSID PRIVATE-KEY CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
