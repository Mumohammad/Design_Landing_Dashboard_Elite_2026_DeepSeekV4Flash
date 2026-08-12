// scripts/verify-coa-phase2-rest.mjs
// Phase 2 verification against the LIVE Supabase project, using the same
// service-role path the app uses (admin.rpc / admin.from). Covers:
//
//   SANITY   is_contra column exists + 1610 marked contra
//   COA-1    create account (parent + contra) via table insert
//   COA-2    duplicate account code → unique violation
//   COA-3    type/normal-balance mismatch → COA003 (contra opt-out works)
//   COA-4    parent of a different type → COA002
//   COA-5    code/type/balance immutable once posted lines exist → COA004
//   COA-6    deactivation blocked with posted lines → COA005
//   COA-7    soft-delete of account with posted lines → COA005
//   JRN-9    unsupported journal type → JRN009
//   OB-1     opening balances posted as an 'opening' journal entry
//   DFLT-1   ensure_default_chart_of_accounts idempotent per-tenant seed
//
// Uses a scratch tenant (T2) for create/validate checks so the default
// tenant's chart is never polluted. Re-runnable: scratch rows accumulate but
// every assertion is self-contained.
//
// Usage: node scripts/verify-coa-phase2-rest.mjs

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

const T = "00000000-0000-0000-0000-000000000001" // default tenant
const T2 = "00000000-0000-0000-0000-0000000c0a2a" // scratch tenant for CoA tests
const RUN = Date.now()
// Run-unique code base (9000-9899 range avoids the seeded 1000-5800 codes and
// makes the script re-runnable — each run uses a fresh set of codes).
const B = 9000 + (RUN % 900)
let failures = 0

async function api(path, { method = "GET", body } = {}) {
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

// ── SANITY: is_contra column + seeded contra 1610 ─────────────────────────
const contra = await api("/chart_of_accounts?select=account_code,is_contra&tenant_id=eq." + T + "&account_code=eq.1610")
ok("SANITY 1610 marked is_contra=true", contra.status === 200 && contra.json?.[0]?.is_contra === true,
  contra.status === 200 ? `is_contra=${contra.json?.[0]?.is_contra}` : `http ${contra.status}`)

// Ensure the scratch tenant exists (FK on every chart_of_accounts row), then
// seed its default CoA so journal checks have a same-tenant 3000 account.
await api("/tenants", {
  method: "POST",
  body: {
    id: T2,
    name_ar: "منشأة فحص المرحلة الثانية",
    name_en: "Phase 2 Verify Tenant",
    country: "SA",
    status: "active",
    plan: "single_tenant",
  },
})
await api("/rpc/ensure_default_chart_of_accounts", { method: "POST", body: { p_tenant_id: T2 } })

// ── Resolve accounts used by journal checks (default tenant + scratch) ────
const acct = await api("/chart_of_accounts?select=id,account_code&tenant_id=eq." + T + "&account_code=in.(1000,3000)")
const byCode = Object.fromEntries((acct.json ?? []).map((a) => [a.account_code, a.id]))
const acct2 = await api("/chart_of_accounts?select=id,account_code&tenant_id=eq." + T2 + "&account_code=in.(1000,3000)")
const byCode2 = Object.fromEntries((acct2.json ?? []).map((a) => [a.account_code, a.id]))

// ── COA-1: create account with parent + contra (scratch tenant) ───────────
const parentRes = await api("/chart_of_accounts", {
  method: "POST",
  body: {
    tenant_id: T2, account_code: String(B), name_ar: "أصل فحص", name_en: "Verify Asset",
    account_type: "asset", normal_balance: "debit", is_contra: false,
    description: `verify-${RUN}`,
  },
})
const parentId = firstRow(parentRes.json)?.id
const childRes = await api("/chart_of_accounts", {
  method: "POST",
  body: {
    tenant_id: T2, account_code: String(B + 1), name_ar: "أصل فرعي", name_en: "Verify Sub Asset",
    account_type: "asset", normal_balance: "debit", parent_id: parentId, is_contra: false,
  },
})
ok("COA-1 create account with parent works", parentRes.status === 201 && childRes.status === 201,
  parentRes.status === 201 ? `parent ${parentId?.slice(0, 8)}` : `http ${parentRes.status}: ${parentRes.text?.slice(0, 120)}`)

const contraRes = await api("/chart_of_accounts", {
  method: "POST",
  body: {
    tenant_id: T2, account_code: String(B + 2), name_ar: "مقابل فحص", name_en: "Verify Contra",
    account_type: "asset", normal_balance: "credit", is_contra: true,
  },
})
ok("COA-1 contra account (asset/credit) accepted", contraRes.status === 201, `http ${contraRes.status}`)

// ── COA-2: duplicate code rejected ────────────────────────────────────────
const dupRes = await api("/chart_of_accounts", {
  method: "POST",
  body: {
    tenant_id: T2, account_code: String(B), name_ar: "مكرر", name_en: "Duplicate",
    account_type: "asset", normal_balance: "debit",
  },
})
ok("COA-2 duplicate account code rejected (unique)", dupRes.status === 409 || (dupRes.status >= 400 && /duplicate|already exists/i.test(dupRes.text)),
  `http ${dupRes.status}`)

// ── COA-3: type/balance mismatch → COA003; contra opt-out accepted ────────
const badBal = await api("/chart_of_accounts", {
  method: "POST",
  body: {
    tenant_id: T2, account_code: String(B + 3), name_ar: "إيراد خاطئ", name_en: "Bad Balance",
    account_type: "income", normal_balance: "debit", is_contra: false,
  },
})
ok("COA-3 income with debit balance rejected (COA003)", badBal.status >= 400 && /COA003/.test(badBal.text),
  badBal.status >= 400 ? badBal.text?.match(/COA\d+/)?.[0] ?? "error" : "unexpected 201")

// ── COA-4: parent of a different type → COA002 ────────────────────────────
const badParent = await api("/chart_of_accounts", {
  method: "POST",
  body: {
    tenant_id: T2, account_code: String(B + 4), name_ar: "طفل خاطئ", name_en: "Bad Child",
    account_type: "expense", normal_balance: "debit", parent_id: parentId, // parent is asset
  },
})
ok("COA-4 child with different-type parent rejected (COA002)", badParent.status >= 400 && /COA002/.test(badParent.text),
  badParent.status >= 400 ? badParent.text?.match(/COA\d+/)?.[0] ?? "error" : "unexpected 201")

// ── COA-5/6/7: post a journal line on the scratch asset, then try mutations ─
let lineAcctId = firstRow(contraRes.json)?.id ?? parentId
let postRes = { status: -1 }
if (lineAcctId && byCode2["3000"]) {
  postRes = await api("/rpc/post_journal_entry", {
    method: "POST",
    body: {
      p_tenant_id: T2,
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description_ar: "Verify COA-5 REST",
      p_lines: [
        { account_id: lineAcctId, debit: 100.0, credit: 0 },
        { account_id: byCode2["3000"], debit: 0, credit: 100.0 },
      ],
    },
  })
}
ok("COA-5 setup: posting works for scratch tenant", postRes.status === 200, `http ${postRes.status}: ${postRes.text?.slice(0, 120)}`)

let coa5 = { status: -1 }
if (lineAcctId && postRes.status === 200) {
  coa5 = await api(`/chart_of_accounts?id=eq.${lineAcctId}`, {
    method: "PATCH",
    body: { account_code: "9999" },
  })
}
ok("COA-5 code immutable with posted lines (COA004)", coa5.status >= 400 && /COA004/.test(coa5.text),
  coa5.status >= 400 ? coa5.text?.match(/COA\d+/)?.[0] ?? "error" : "unexpected 200")

let coa6 = { status: -1 }
if (lineAcctId && postRes.status === 200) {
  coa6 = await api(`/chart_of_accounts?id=eq.${lineAcctId}`, {
    method: "PATCH",
    body: { is_active: false },
  })
}
ok("COA-6 deactivation blocked with posted lines (COA005)", coa6.status >= 400 && /COA005/.test(coa6.text),
  coa6.status >= 400 ? coa6.text?.match(/COA\d+/)?.[0] ?? "error" : "unexpected 200")

let coa7 = { status: -1 }
if (lineAcctId && postRes.status === 200) {
  coa7 = await api(`/chart_of_accounts?id=eq.${lineAcctId}`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  })
}
ok("COA-7 soft-delete blocked with posted lines (COA005)", coa7.status >= 400 && /COA005/.test(coa7.text),
  coa7.status >= 400 ? coa7.text?.match(/COA\d+/)?.[0] ?? "error" : "unexpected 200")

// ── COA-8: name-only edit still allowed on an account with posted lines ────
let coa8 = { status: -1 }
if (lineAcctId && postRes.status === 200) {
  coa8 = await api(`/chart_of_accounts?id=eq.${lineAcctId}`, {
    method: "PATCH",
    body: { name_en: "Verify Contra Renamed" },
  })
}
ok("COA-8 name edit allowed on account with posted lines", coa8.status === 204 || coa8.status === 200, `http ${coa8.status}`)

// ── JRN-9: unsupported journal type rejected ──────────────────────────────
const j9 = await api("/rpc/post_journal_entry", {
  method: "POST",
  body: {
    p_tenant_id: T,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify JRN-9 REST",
    p_entry_type: "payroll",
    p_lines: [
      { account_id: byCode["1000"], debit: 10.0, credit: 0 },
      { account_id: byCode["3000"], debit: 0, credit: 10.0 },
    ],
  },
})
ok("JRN-9 unsupported journal type rejected (JRN009)", j9.status >= 400 && /JRN009/.test(j9.text),
  j9.status >= 400 ? j9.text?.match(/JRN\d+/)?.[0] ?? "error" : "unexpected 200")

// ── OB-1: opening balances posted as an 'opening' entry ───────────────────
const ob = await api("/rpc/post_journal_entry", {
  method: "POST",
  body: {
    p_tenant_id: T2,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "رصيد افتتاحي فحص",
    p_entry_type: "opening",
    p_lines: [
      { account_id: lineAcctId, debit: 500.0, credit: 0 },
      { account_id: byCode2["3000"], debit: 0, credit: 500.0 },
    ],
  },
})
const obEntryId = ob.status === 200 ? (Array.isArray(ob.json) ? ob.json[0]?.out_entry_id : ob.json?.out_entry_id) : null
ok("OB-1 opening balances posted (entry_type=opening)", ob.status === 200 && !!obEntryId,
  ob.status === 200 ? `entry ${obEntryId?.slice(0, 8)}` : `http ${ob.status}: ${ob.text?.slice(0, 140)}`)

if (obEntryId) {
  const ent = await api(`/journal_entries?select=entry_type,status,description_ar&id=eq.${obEntryId}`)
  ok("OB-1 journal row is entry_type=opening, status=posted",
    ent.status === 200 && ent.json?.[0]?.entry_type === "opening" && ent.json?.[0]?.status === "posted",
    ent.json?.[0] ? `type=${ent.json[0].entry_type}, status=${ent.json[0].status}` : `http ${ent.status}`)
}

// ── DFLT-1: per-tenant default CoA seed (idempotent) ──────────────────────
const d1 = await api("/rpc/ensure_default_chart_of_accounts", {
  method: "POST",
  body: { p_tenant_id: T2 },
})
const d1Count = Array.isArray(d1.json) ? d1.json[0] : d1.json
ok("DFLT-1 ensure_default_chart_of_accounts seeds (returns count)", d1.status === 200 && typeof d1Count === "number" && d1Count >= 0,
  d1.status === 200 ? `inserted=${JSON.stringify(d1Count)}` : `http ${d1.status}: ${d1.text?.slice(0, 120)}`)

const d2 = await api("/rpc/ensure_default_chart_of_accounts", {
  method: "POST",
  body: { p_tenant_id: T2 },
})
const d2Count = Array.isArray(d2.json) ? d2.json[0] : d2.json
ok("DFLT-1 re-run is idempotent (inserts 0)", d2.status === 200 && d2Count === 0,
  d2.status === 200 ? `inserted=${JSON.stringify(d2Count)}` : `http ${d2.status}`)

// ── Summary ────────────────────────────────────────────────────────────────
console.log(failures === 0 ? "\n═══ RESULT: ALL PHASE 2 CHECKS PASSED ═══" : `\n═══ RESULT: ${failures} CHECK(S) FAILED ═══`)
process.exit(failures === 0 ? 0 : 1)
