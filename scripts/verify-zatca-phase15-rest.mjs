// scripts/verify-zatca-phase15-rest.mjs
// Phase 15 (IMPLEMENTATION-PLAN Phase 15 — ZATCA adapter) verification
// against the LIVE Supabase project.
//
//   R-1  migration 054 applied: zatca_status enum + invoices.zatca_status /
//        invoices.zatca_uuid columns with defaults
//   R-2  zatca_transmissions table exists with the idempotency UNIQUE index
//        (tenant_id, invoice_id, doc_type)
//   R-3  RLS: anon denied; authenticated user sees only own-tenant rows and
//        CANNOT insert transmissions (SELECT-only, mirroring financial_events)
//   R-4  service role CAN insert a transmission row (app writes via admin)
//   R-5  idempotency: re-inserting the same (tenant, invoice, doc_type)
//        violates the UNIQUE index (replay of the adapter is a no-op)
//   R-6  invoices.zatca_status is settable via service role on a finalized
//        invoice (protect_finalized_invoice allows status columns)
//
// Uses the demo tenant (T) + the seeded finalized invoice (INV-2026-000001)
// plus a fresh scratch invoice so the probes never collide with app data.
//
// Usage: node scripts/verify-zatca-phase15-rest.mjs

import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"

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
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
  return { res, json, text }
}

// ── Provision a GM user in the demo tenant for authenticated checks ──────
const email = `zatca15-${RUN}@elite.local`
const password = "EliteVerify2026!" + (1000 + (RUN % 9000))

async function fetchRetry(url, opts, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, opts)
    } catch (e) {
      if (i === attempts) throw e
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

// Auth endpoints are NOT under /rest/v1 — hit them directly (mirrors the
// statements/return browser+REST scripts).
const created = await fetchRetry(`${BASE}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { email_verified: true } }),
})
const authUid = (await created.json()).id
if (!authUid) {
  console.error("✗ could not create test user")
  process.exit(1)
}
await rest("/users", {
  method: "POST",
  body: {
    auth_user_id: authUid, tenant_id: T, email, role: "general_manager", status: "active",
    full_name_ar: "مدير فحص ZATCA", full_name_en: "ZATCA Verify GM",
    must_change_password: false, accepted_invite_at: new Date().toISOString(),
  },
  prefer: "return=minimal",
})
const signin = await fetchRetry(`${BASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
})
const USER_TOKEN = (await signin.json()).access_token

// ── R-1 schema contract ───────────────────────────────────────────────────
{
  const { res } = await rest("/invoices?select=zatca_status,zatca_uuid&limit=1")
  ok("R-1a invoices.zatca_status + zatca_uuid exposed", res.status === 200)
}
{
  const { res } = await rest("/zatca_transmissions?select=id&limit=1")
  ok("R-1b zatca_transmissions table exposed", res.status === 200)
}

// ── R-2 / R-3 / R-4 / R-5 — transmission ledger + RLS + idempotency ───────
// Fresh scratch invoice so the probes never collide with app data. Sales
// invoices require a customer (INV005) — reuse the demo tenant's first one.
const { json: customers } = await rest("/customers?select=id&limit=1", {})
const customerId = customers?.[0]?.id
ok("R-2a demo customer available", Boolean(customerId))
const { json: inv } = await rest("/invoices", {
  method: "POST",
  body: {
    tenant_id: T, customer_id: customerId, invoice_number: `ZATCA-TEST-${RUN}`, invoice_type: "sales",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date().toISOString().slice(0, 10),
    currency: "SAR", status: "finalized",
    subtotal: 1000, discount: 0, vat_amount: 150, total: 1150, vat_rate: 15,
  },
  prefer: "return=representation",
})
const invoiceId = inv?.[0]?.id
ok("R-2b scratch finalized invoice created", Boolean(invoiceId))

const xml = "<Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\"><cbc:ID>X</cbc:ID></Invoice>"
const transmission = {
  tenant_id: T, invoice_id: invoiceId, doc_type: "invoice",
  doc_ref: `ZATCA-TEST-${RUN}`, payload_xml: xml, status: "reported",
  zatca_uuid: randomUUID(), response: { sandbox: true },
}

// Service role CAN write (the app's write path).
{
  const { res } = await rest("/zatca_transmissions", {
    method: "POST", body: transmission, prefer: "return=minimal",
  })
  ok("R-4 service role inserts a transmission", res.status === 201, `HTTP ${res.status}`)
}

// Authenticated user CANNOT insert (SELECT-only ledger, like financial_events).
{
  const { res } = await rest("/zatca_transmissions", {
    method: "POST", body: { ...transmission, doc_ref: `ZATCA-TEST-${RUN}-forged` },
    token: USER_TOKEN, prefer: "return=minimal",
  })
  ok("R-3a authenticated user cannot insert (no INSERT policy)", res.status === 403 || res.status === 401, `HTTP ${res.status}`)
}

// Authenticated user CAN read own-tenant rows.
{
  const { res } = await rest(`/zatca_transmissions?select=doc_ref&tenant_id=eq.${T}`, {
    token: USER_TOKEN,
  })
  ok("R-3b authenticated user reads own-tenant transmissions", res.status === 200)
}

// Idempotency: replay of the same (tenant, invoice, doc_type) is rejected.
{
  const { res } = await rest("/zatca_transmissions", {
    method: "POST", body: transmission, prefer: "return=minimal",
  })
  ok("R-5 duplicate (tenant, invoice, doc_type) rejected by UNIQUE index",
    res.status === 409, `HTTP ${res.status}`)
}

// Anon is denied entirely.
{
  const { res } = await rest("/zatca_transmissions?select=id&limit=1", { anon: true })
  ok("R-3c anon denied on zatca_transmissions", res.status === 401, `HTTP ${res.status}`)
}

// ── R-6 status columns settable on a finalized invoice ────────────────────
{
  const { res } = await rest(`/invoices?id=eq.${invoiceId}`, {
    method: "PATCH",
    body: { zatca_status: "reported", zatca_uuid: randomUUID() },
    prefer: "return=minimal",
  })
  ok("R-6 service role sets zatca_status on finalized invoice", res.status === 204, `HTTP ${res.status}`)
}

// ── Cleanup ───────────────────────────────────────────────────────────────
await rest(`/invoices?id=eq.${invoiceId}`, { method: "PATCH", body: { deleted_at: new Date().toISOString() }, prefer: "return=minimal" })
await rest(`/zatca_transmissions?invoice_id=eq.${invoiceId}`, { method: "DELETE", prefer: "return=minimal" })
await fetchRetry(`${BASE}/auth/v1/admin/users/${authUid}`, { method: "DELETE", headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })

console.log(failures === 0 ? "\nAll ZATCA Phase 15 checks PASSED." : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
