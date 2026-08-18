// scripts/verify-invoice-phase6-rest.mjs
// Phase 6 (Invoice documents: PDF/print/QR) verification against the LIVE
// Supabase project over the same REST paths the app uses.
//
//   M-1  storage bucket `invoice-documents` exists (migration 039)
//   M-2  generated_documents.invoice_id column added (migration 039)
//   M-3  generated_documents insert with template_id NULL + invoice_id FK
//   M-4  anon request denied (no API key)
//   R-1  customers RLS: cross-tenant read → 0 rows, own read → rows
//   R-2  customers RLS: forged tenant_id INSERT → blocked
//   R-3  invoices / financial_events cross-tenant reads → 0 rows
//   S-1  storage RLS: user upload into own tenant folder → allowed
//   S-2  storage RLS: user upload into foreign tenant folder → blocked
//
// The HTML/QR generation itself runs through the `invoices:print` server
// action (generateInvoiceDocument) and is verified in the browser flow; this
// script asserts the DB + storage contracts it relies on.
//
// Self-provisions a scratch GM auth user per run. Re-runnable.
//
// Usage: node scripts/verify-invoice-phase6-rest.mjs

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
if (!BASE || !KEY || !ANON) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local")
  process.exit(1)
}

const T = "00000000-0000-0000-0000-000000000001" // demo tenant
const T2 = "00000000-0000-0000-0000-0000000c0a2a" // scratch tenant (phase5)
const RUN = Date.now()
let failures = 0

function ok(name, pass, detail = "") {
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

async function rest(path, { method = "GET", body, token, anon = false, prefer } = {}) {
  const res = await fetch(`${BASE}/rest/v1${path}`, {
    method,
    headers: {
      apikey: anon ? "" : KEY,
      Authorization: anon ? "Bearer anon" : `Bearer ${token ?? KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, json, text }
}

async function auth(path, { method = "GET", body, token, key = KEY } = {}) {
  const res = await fetch(`${BASE}/auth/v1${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, json, text }
}

async function storage(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}/storage/v1${path}`, {
    method,
    headers: {
      apikey: token ? ANON : KEY,
      Authorization: `Bearer ${token ?? KEY}`,
      ...(body ? { "Content-Type": "application/octet-stream" } : {}),
    },
    body,
  })
  const text = await res.text()
  return { status: res.status, text }
}

const firstRow = (j) => (Array.isArray(j) ? j[0] : j)

// ── M: migration 039 contracts ───────────────────────────────────────────
const bucket = await fetch(`${BASE}/storage/v1/bucket/invoice-documents`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
ok("M-1 storage bucket invoice-documents exists", bucket.status === 200,
  `http ${bucket.status}`)

const gd = await rest(`/generated_documents?select=id,invoice_id,doc_number&limit=1`)
ok("M-2 generated_documents.invoice_id column present", gd.status === 200,
  gd.status === 200 ? "select OK" : `http ${gd.status} ${gd.text?.slice(0, 120)}`)

const seedInv = firstRow((await rest(
  `/invoices?select=id&tenant_id=eq.${T}&invoice_number=eq.INV-2026-000001&deleted_at=is.null`
)).json)

const docNumber = `VER6-${RUN}`
const gdIns = await rest("/generated_documents", {
  method: "POST",
  body: {
    tenant_id: T,
    doc_number: docNumber,
    invoice_id: seedInv?.id ?? null,
    generated_data: { kind: "invoice", invoice_number: "INV-2026-000001" },
    status: "generated",
  },
  prefer: "return=representation",
})
ok("M-3 generated_documents insert with NULL template_id + invoice_id FK",
  gdIns.status === 201 && !!firstRow(gdIns.json)?.id,
  gdIns.status === 201 ? `id=${firstRow(gdIns.json)?.id}` : `http ${gdIns.status} ${gdIns.text?.slice(0, 160)}`)
const gdId = firstRow(gdIns.json)?.id
if (gdId) {
  await rest(`/generated_documents?id=eq.${gdId}`, { method: "DELETE", prefer: "return=minimal" })
}

const anonProbe = await fetch(`${BASE}/rest/v1/generated_documents?select=id&limit=1`, {
  headers: { apikey: "", Authorization: "Bearer anon" },
})
ok("M-4 anon request denied (no API key)", anonProbe.status === 401,
  `http ${anonProbe.status}`)

// ── Scratch GM user (self-provisioned, unique per run) ───────────────────
const email = `verify6-${RUN}@elite.local`
const password = "EliteVerify2026!" + (1000 + (RUN % 9000))
const created = await auth("/admin/users", {
  method: "POST",
  body: { email, password, email_confirm: true, user_metadata: { email_verified: true } },
})
const authUid = created.json?.id
ok("SETUP scratch auth user created", created.status >= 200 && created.status < 300 && !!authUid,
  created.status >= 200 && created.status < 300 ? "" : `http ${created.status} ${created.text?.slice(0, 160)}`)

if (authUid) {
  await rest("/users", {
    method: "POST",
    body: {
      auth_user_id: authUid,
      tenant_id: T,
      email,
      role: "general_manager",
      status: "active",
      full_name_ar: "مدير فحص المرحلة السادسة",
      full_name_en: "Phase 6 Verify GM",
      must_change_password: false,
      accepted_invite_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  })
}

// Sign in to obtain a real user token (RLS role = authenticated).
const signin = await auth("/token?grant_type=password", {
  method: "POST",
  key: ANON,
  body: { email, password },
})
const userToken = signin.json?.access_token
ok("SETUP sign-in obtains user token", !!userToken,
  userToken ? "" : `http ${signin.status} ${signin.text?.slice(0, 160)}`)

// ── R: RLS probes (user token) ───────────────────────────────────────────
if (userToken) {
  const cross = await rest(`/customers?select=id&tenant_id=neq.${T}`, { token: userToken })
  ok("R-1a customers cross-tenant read filtered by RLS",
    cross.status === 200 && Array.isArray(cross.json) && cross.json.length === 0,
    cross.status === 200 ? `rows=${Array.isArray(cross.json) ? cross.json.length : "?"}` : `http ${cross.status}`)

  const own = await rest(`/customers?select=id&limit=5`, { token: userToken })
  ok("R-1b customers own-tenant read succeeds",
    own.status === 200 && Array.isArray(own.json) && own.json.length > 0,
    own.status === 200 ? `rows=${Array.isArray(own.json) ? own.json.length : "?"}` : `http ${own.status}`)

  const forged = await rest("/customers", {
    method: "POST",
    token: userToken,
    body: {
      tenant_id: "99999999-9999-9999-9999-999999999999",
      customer_code: `RLS${RUN % 100000}`,
      name_ar: "RLS Probe",
    },
    prefer: "return=minimal",
  })
  ok("R-2 forged tenant_id INSERT blocked by RLS", forged.status >= 400,
    `http ${forged.status} ${forged.text?.slice(0, 140)}`)

  for (const t of ["invoices", "financial_events"]) {
    const r = await rest(`/${t}?select=id&tenant_id=neq.${T}`, { token: userToken })
    ok(`R-3 ${t} cross-tenant read filtered by RLS`,
      r.status === 200 && Array.isArray(r.json) && r.json.length === 0,
      r.status === 200 ? `rows=${Array.isArray(r.json) ? r.json.length : "?"}` : `http ${r.status}`)
  }

  // ── S: storage RLS probes ─────────────────────────────────────────────
  const probeFile = `probe-${RUN}.txt`
  const ownUpload = await storage(`/object/invoice-documents/${T}/${probeFile}`, {
    method: "POST",
    token: userToken,
    body: "phase6 storage probe",
  })
  ok("S-1 user upload into own tenant folder allowed", ownUpload.status >= 200 && ownUpload.status < 300,
    `http ${ownUpload.status}`)

  const foreignUpload = await storage(`/object/invoice-documents/${T2}/${probeFile}`, {
    method: "POST",
    token: userToken,
    body: "phase6 storage probe",
  })
  // Storage wraps the RLS rejection as HTTP 400 with statusCode 403 + message.
  ok("S-2 user upload into foreign tenant folder blocked by RLS",
    foreignUpload.status >= 400 && /row-level security/i.test(foreignUpload.text),
    `http ${foreignUpload.status} ${foreignUpload.text.slice(0, 140)}`)

  // cleanup probe file
  await storage(`/object/invoice-documents/${T}/${probeFile}`, { method: "DELETE" })
}

console.log(failures === 0 ? "\n✅ ALL PHASE 6 CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
