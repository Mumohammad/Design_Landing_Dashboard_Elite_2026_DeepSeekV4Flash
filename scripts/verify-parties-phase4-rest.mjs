// scripts/verify-parties-phase4-rest.mjs
// Phase 4 verification against the LIVE Supabase project, using the same
// service-role REST path the app uses (admin.from). Covers:
//
//   SANITY  demo seed rows exist for the demo tenant (CUST-0001..3, SUPP-0001..3)
//   P-1     create customer with explicit code works, code preserved
//   P-2     create customer without code → DB sequence assigns the code
//   P-3     duplicate customer code → unique violation (23505)
//   P-4     invalid tax number (14 digits) → CUS002
//   P-5     negative credit limit → CUS004
//   P-6     malformed code (too short) → CUS003
//   P-7     update customer (name + credit limit) works
//   P-8     soft-delete → row hidden from active list, deleted_at set
//   P-9     supplier create + SUP002 (tax number) + SUP004 (credit limit)
//   P-10    anon request denied (no API key)
//
// Uses a scratch tenant (T2) for create/validate checks so the demo tenant's
// records are never polluted. Re-runnable: codes are run-unique.
//
// Usage: node scripts/verify-parties-phase4-rest.mjs

import { readFileSync } from "node:fs"

const envRaw = readFileSync(".env.local", "utf8")
const env = {}
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!BASE || !KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const T = "00000000-0000-0000-0000-000000000001" // default tenant (demo)
const T2 = "00000000-0000-0000-0000-0000000c0a2a" // scratch tenant for party tests
const RUN = Date.now()
const B = 9000 + (RUN % 900)
const CUS = `PV${B}`   // e.g. PV9034 — run-unique, passes the 3-12 char code rule
const SUP = `PS${B}`
let failures = 0

async function api(path, { method = "GET", body, anon = false } = {}) {
  const res = await fetch(`${BASE}/rest/v1${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(method === "POST" ? { Prefer: "return=representation" } : {}),
      ...(method === "PATCH" || method === "DELETE" ? { Prefer: "return=minimal" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, json, text }
}

function firstRow(j) {
  return Array.isArray(j) ? j[0] : j
}

function ok(name, pass, detail = "") {
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

// ── SANITY: demo seed present for the demo tenant ─────────────────────────
const seed = await api(`/customers?select=customer_code,name_ar&tenant_id=eq.${T}&customer_code=in.(CUST-0001,CUST-0002,CUST-0003)&deleted_at=is.null`)
const seedSupp = await api(`/suppliers?select=supplier_code,name_ar&tenant_id=eq.${T}&supplier_code=in.(SUPP-0001,SUPP-0002,SUPP-0003)&deleted_at=is.null`)
ok("SANITY demo customers seeded (3 rows)", seed.status === 200 && (seed.json ?? []).length === 3,
  seed.status === 200 ? `found ${(seed.json ?? []).length}` : `http ${seed.status}`)
ok("SANITY demo suppliers seeded (3 rows)", seedSupp.status === 200 && (seedSupp.json ?? []).length === 3,
  seedSupp.status === 200 ? `found ${(seedSupp.json ?? []).length}` : `http ${seedSupp.status}`)

// Ensure the scratch tenant exists (FK on customers/suppliers).
await api("/tenants", {
  method: "POST",
  body: {
    id: T2,
    name_ar: "منشأة فحص المرحلة الرابعة",
    name_en: "Phase 4 Verify Tenant",
    country: "SA",
    status: "active",
    plan: "single_tenant",
  },
})

// ── P-1: create customer with explicit code ───────────────────────────────
const c1 = await api("/customers", {
  method: "POST",
  body: {
    tenant_id: T2, customer_code: CUS, name_ar: "عميل فحص", name_en: "Verify Customer",
    phone: "+966500001111", email: "verify@phase4.sa", tax_number: "310122993400009",
    credit_limit: 15000.5,
  },
})
const c1Id = firstRow(c1.json)?.id
ok("P-1 create customer with explicit code", c1.status === 201 && c1Id,
  c1.status === 201 ? `code=${firstRow(c1.json)?.customer_code}` : `http ${c1.status}: ${c1.text?.slice(0, 140)}`)

// ── P-2: create customer without code → DB sequence assigns ──────────────
const c2 = await api("/customers", {
  method: "POST",
  body: { tenant_id: T2, name_ar: "عميل بدون رمز", name_en: "No Code Customer" },
})
const c2Code = firstRow(c2.json)?.customer_code
ok("P-2 code auto-assigned by sequence", c2.status === 201 && /^\d{6,12}$/.test(c2Code ?? ""),
  c2.status === 201 ? `code=${c2Code}` : `http ${c2.status}: ${c2.text?.slice(0, 140)}`)

// ── P-3: duplicate code rejected ──────────────────────────────────────────
const dup = await api("/customers", {
  method: "POST",
  body: { tenant_id: T2, customer_code: CUS, name_ar: "مكرر", name_en: "Duplicate" },
})
ok("P-3 duplicate customer code rejected (unique)", dup.status === 409 || (dup.status >= 400 && /duplicate|already exists/i.test(dup.text)),
  `http ${dup.status}`)

// ── P-4: invalid tax number → CUS002 ──────────────────────────────────────
const badTax = await api("/customers", {
  method: "POST",
  body: { tenant_id: T2, customer_code: `${CUS}X`, name_ar: "ضريبة خاطئة", tax_number: "31012299340000" }, // 14 digits
})
ok("P-4 14-digit tax number rejected (CUS002)", badTax.status >= 400 && /CUS002/.test(badTax.text),
  badTax.status >= 400 ? badTax.text?.match(/CUS\d+/)?.[0] ?? "error" : "unexpected 201")

// ── P-5: negative credit limit → CUS004 ───────────────────────────────────
const negLimit = await api("/customers", {
  method: "POST",
  body: { tenant_id: T2, customer_code: `${CUS}Y`, name_ar: "حد سالب", credit_limit: -10 },
})
ok("P-5 negative credit limit rejected (CUS004)", negLimit.status >= 400 && /CUS004/.test(negLimit.text),
  negLimit.status >= 400 ? negLimit.text?.match(/CUS\d+/)?.[0] ?? "error" : "unexpected 201")

// ── P-6: malformed code → CUS003 ──────────────────────────────────────────
const badCode = await api("/customers", {
  method: "POST",
  body: { tenant_id: T2, customer_code: "AB", name_ar: "رمز قصير" }, // 2 chars
})
ok("P-6 2-char code rejected (CUS003)", badCode.status >= 400 && /CUS003/.test(badCode.text),
  badCode.status >= 400 ? badCode.text?.match(/CUS\d+/)?.[0] ?? "error" : "unexpected 201")

// ── P-7: update customer (name + credit limit) ────────────────────────────
const upd = await api(`/customers?id=eq.${c1Id}`, {
  method: "PATCH",
  body: { name_ar: "عميل فحص محدث", credit_limit: 20000, updated_by: null },
})
ok("P-7 update customer name + credit limit", upd.status === 204 || upd.status === 200,
  `http ${upd.status}`)

// ── P-8: soft-delete → hidden from active list ────────────────────────────
const del = await api(`/customers?id=eq.${c1Id}`, {
  method: "PATCH",
  body: { deleted_at: new Date().toISOString() },
})
const afterDel = await api(`/customers?select=id,customer_code,deleted_at&id=eq.${c1Id}&deleted_at=is.null`)
const afterDelAll = await api(`/customers?select=id,customer_code,deleted_at&id=eq.${c1Id}`)
ok("P-8 soft-delete hides row from active list", del.status === 204 && (afterDel.json ?? []).length === 0,
  del.status === 204 ? `remaining active rows: ${(afterDel.json ?? []).length}` : `http ${del.status}`)
ok("P-8 soft-deleted row keeps deleted_at set", (afterDelAll.json ?? [])[0]?.deleted_at != null,
  afterDelAll.json?.[0]?.deleted_at ? "deleted_at present" : "missing deleted_at")

// ── P-9: supplier create + validation ─────────────────────────────────────
const s1 = await api("/suppliers", {
  method: "POST",
  body: { tenant_id: T2, supplier_code: SUP, name_ar: "مورد فحص", name_en: "Verify Supplier", credit_limit: 50000 },
})
ok("P-9 create supplier with code + credit limit", s1.status === 201 && firstRow(s1.json)?.id,
  s1.status === 201 ? `code=${firstRow(s1.json)?.supplier_code}` : `http ${s1.status}: ${s1.text?.slice(0, 140)}`)

const sBadTax = await api("/suppliers", {
  method: "POST",
  body: { tenant_id: T2, supplier_code: `${SUP}X`, name_ar: "ضريبة مورد خاطئة", tax_number: "12345" },
})
ok("P-9 supplier bad tax number rejected (SUP002)", sBadTax.status >= 400 && /SUP002/.test(sBadTax.text),
  sBadTax.status >= 400 ? sBadTax.text?.match(/SUP\d+/)?.[0] ?? "error" : "unexpected 201")

const sNeg = await api("/suppliers", {
  method: "POST",
  body: { tenant_id: T2, supplier_code: `${SUP}Y`, name_ar: "حد مورد سالب", credit_limit: -5 },
})
ok("P-9 supplier negative credit limit rejected (SUP004)", sNeg.status >= 400 && /SUP004/.test(sNeg.text),
  sNeg.status >= 400 ? sNeg.text?.match(/SUP\d+/)?.[0] ?? "error" : "unexpected 201")

// ── P-10: anon request denied ─────────────────────────────────────────────
const anon = await fetch(`${BASE}/rest/v1/customers?select=id&limit=1`, { headers: { apikey: "anon-invalid" } })
ok("P-10 invalid/anon key denied", anon.status === 401, `http ${anon.status}`)

// ── Summary ───────────────────────────────────────────────────────────────
console.log(failures === 0 ? "\n═══ RESULT: ALL PHASE 4 CHECKS PASSED ═══" : `\n═══ RESULT: ${failures} CHECK(S) FAILED ═══`)
process.exit(failures === 0 ? 0 : 1)
