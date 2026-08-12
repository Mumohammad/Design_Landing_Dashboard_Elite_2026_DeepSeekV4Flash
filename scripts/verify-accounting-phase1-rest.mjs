// scripts/verify-accounting-phase1-rest.mjs
// Phase 1 verification against the LIVE Supabase project, using the same
// service-role path the app uses (admin.rpc / admin.from). Each REST request
// is its own DB transaction, so the DEFERRED constraint trigger fires at
// request commit — exactly as in production.
//
// Mirrors scripts/verify-accounting-phase1.sql (JRN-1..5, ACC-1, RLS-1, AUD-1)
// without needing direct psql access or the Supabase access token.
//
// NOTE: Unlike the SQL script, REST requests COMMIT immediately — there is no
// rollback. Re-runs accumulate test data (posted JRN-4 entries, an immutable
// AUD-1 audit row) and are otherwise safe: every check is self-contained and
// ACC-1 tolerates an already-existing closed period (409).
//
// Usage: node scripts/verify-accounting-phase1-rest.mjs
// (reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local)

import { readFileSync } from "node:fs"

// ── env ────────────────────────────────────────────────────────────────────
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
let failures = 0

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}/rest/v1${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      // POST returns the created row(s); PATCH/DELETE return minimal.
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

// ── SANITY: seeded chart of accounts ───────────────────────────────────────
const coa = await api("/chart_of_accounts?select=account_code&tenant_id=eq." + T + "&account_code=in.(1000,3000)")
ok("SANITY chart of accounts seeded (1000, 3000)", coa.status === 200 && Array.isArray(coa.json) && coa.json.length === 2,
  coa.status === 200 ? `found ${coa.json?.length} of 2` : `http ${coa.status}`)

// ── resolve account ids for tenant 1000/3000 (used by all checks) ────────
const acct = await api("/chart_of_accounts?select=id,account_code&tenant_id=eq." + T + "&account_code=in.(1000,3000)")
const byCode = Object.fromEntries((acct.json ?? []).map((a) => [a.account_code, a.id]))

// ── JRN-4: RPC posts a balanced entry ──────────────────────────────────────
const r4 = await api("/rpc/post_journal_entry", {
  method: "POST",
  body: {
    p_tenant_id: T,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify JRN-4 REST",
    p_lines: [
      { account_id: byCode["1000"], debit: 150.0, credit: 0 },
      { account_id: byCode["3000"], debit: 0, credit: 150.0 },
    ],
  },
})
let jrn4Id = null
if (r4.status === 200) {
  jrn4Id = Array.isArray(r4.json) ? r4.json[0]?.out_entry_id : r4.json?.out_entry_id
}
ok("JRN-4 post_journal_entry accepts balanced entry", r4.status === 200 && !!jrn4Id,
  r4.status === 200 ? `entry ${jrn4Id}` : `http ${r4.status}: ${r4.text?.slice(0, 120)}`)

// ── JRN-5: RPC rejects unbalanced entry ────────────────────────────────────
const r5 = await api("/rpc/post_journal_entry", {
  method: "POST",
  body: {
    p_tenant_id: T,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify JRN-5 REST",
    p_lines: [
      { account_id: byCode["1000"], debit: 300.0, credit: 0 },
      { account_id: byCode["3000"], debit: 0, credit: 100.0 },
    ],
  },
})
ok("JRN-5 post_journal_entry rejects unbalanced (JRN004)", r5.status >= 400 && /JRN004/.test(r5.text),
  r5.status >= 400 ? r5.text?.match(/JRN\d+/)?.[0] ?? "error" : `unexpected 200`)

// ── JRN-6: RPC requires ≥2 lines / account per line (JRN006/JRN008) ───────
const r6 = await api("/rpc/post_journal_entry", {
  method: "POST",
  body: {
    p_tenant_id: T,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify JRN-6 REST",
    p_lines: [{ account_id: byCode["1000"], debit: 100.0, credit: 0 }],
  },
})
ok("JRN-6 RPC rejects single line (JRN006)", r6.status >= 400 && /JRN006/.test(r6.text),
  r6.status >= 400 ? r6.text?.match(/JRN\d+/)?.[0] ?? "error" : "unexpected 200")

const r8 = await api("/rpc/post_journal_entry", {
  method: "POST",
  body: {
    p_tenant_id: T,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify JRN-8 REST",
    p_lines: [
      // random UUID not owned by the tenant
      { account_id: "11111111-1111-1111-1111-111111111111", debit: 100.0, credit: 0 },
      { account_id: byCode["3000"], debit: 0, credit: 100.0 },
    ],
  },
})
ok("JRN-8 RPC rejects foreign tenant account", r8.status >= 400 && /JRN008/.test(r8.text),
  r8.status >= 400 ? r8.text?.match(/JRN\d+/)?.[0] ?? "error" : "unexpected 200")

// ── JRN-1: posted entry rejects UPDATE (immutability trigger) ─────────────
let jrn1 = { status: -1 }
if (jrn4Id) {
  jrn1 = await api(`/journal_entries?id=eq.${jrn4Id}`, { method: "PATCH", body: { description_ar: "tampered" } })
}
ok("JRN-1 posted entry rejects UPDATE (JRN001)", jrn4Id ? jrn1.status >= 400 && /JRN001/.test(jrn1.text) : false,
  jrn1.status >= 400 ? jrn1.text?.match(/JRN\d+/)?.[0] ?? "error" : `http ${jrn1.status}`)

// ── JRN-2: posted entry rejects DELETE ─────────────────────────────────────
let jrn2 = { status: -1 }
if (jrn4Id) {
  jrn2 = await api(`/journal_entries?id=eq.${jrn4Id}`, { method: "DELETE" })
}
ok("JRN-2 posted entry rejects DELETE (JRN003)", jrn4Id ? jrn2.status >= 400 && /JRN003/.test(jrn2.text) : false,
  jrn2.status >= 400 ? jrn2.text?.match(/JRN\d+/)?.[0] ?? "error" : `http ${jrn2.status}`)

// ── JRN-3: DB trigger rejects unbalanced direct line insert ───────────────
// Insert a posted header (no lines) then a SINGLE debit line: each REST
// request commits, so the deferred check fires and must reject (200 vs 0).
let jrn3 = { status: -1 }
{
  const hdr = await api("/journal_entries", {
    method: "POST",
    body: { tenant_id: T, entry_date: new Date().toISOString().slice(0, 10), entry_type: "manual", status: "posted", description_ar: "Verify JRN-3 REST" },
  })
  if (hdr.status === 201) {
    const hdrRow = firstRow(hdr.json)
    const line = await api("/journal_entry_lines", {
      method: "POST",
      body: { tenant_id: T, journal_entry_id: hdrRow?.id, account_id: byCode["1000"], debit_amount: 200, credit_amount: 0 },
    })
    jrn3 = line
  }
}
ok("JRN-3 trigger rejects unbalanced posted entry (JRN004)", jrn3.status >= 400 && /JRN004/.test(jrn3.text),
  jrn3.status >= 400 ? jrn3.text?.match(/JRN\d+/)?.[0] ?? "error" : "unexpected 200")

// ── ACC-1: closed period rejects posting ───────────────────────────────────
// Create a closed period for a past month, then try posting into it.
// 409 (unique tenant_id+period_year+period_month) on re-runs means the period
// already exists from a previous run — that is fine, proceed.
let acc1 = { status: -1 }
{
  const period = await api("/accounting_periods", {
    method: "POST",
    body: { tenant_id: T, period_year: 2000, period_month: 1, status: "closed" },
  })
  if (period.status === 201 || period.status === 200 || period.status === 409) {
    acc1 = await api("/rpc/post_journal_entry", {
      method: "POST",
      body: {
        p_tenant_id: T,
        p_entry_date: "2000-01-15",
        p_description_ar: "Verify ACC-1 REST",
        p_lines: [
          { account_id: byCode["1000"], debit: 50.0, credit: 0 },
          { account_id: byCode["3000"], debit: 0, credit: 50.0 },
        ],
      },
    })
  }
}
ok("ACC-1 closed period rejects posting (ACC001)", acc1.status >= 400 && /ACC001/.test(acc1.text),
  acc1.status >= 400 ? acc1.text?.match(/ACC\d+/)?.[0] ?? "error" : `http ${acc1.status}`)

// ── RLS-1: get_my_tenant_id() callable ─────────────────────────────────────
const rls = await api("/rpc/get_my_tenant_id", { method: "POST", body: {} })
ok("RLS-1 get_my_tenant_id() callable", rls.status === 200, `returns ${JSON.stringify(rls.json)}`)

// ── AUD-1: audit_log rejects UPDATE/DELETE ─────────────────────────────────
let aud = { status: -1 }
{
  const ins = await api("/audit_log", {
    method: "POST",
    body: { tenant_id: T, module: "accounting", action: "verify_phase1_rest", entity_type: "journal_entries", new_values: { test: true } },
  })
  if (ins.status === 201) {
    const id = firstRow(ins.json)?.id
    const upd = await api(`/audit_log?id=eq.${id}`, { method: "PATCH", body: { new_values: {} } })
    const del = await api(`/audit_log?id=eq.${id}`, { method: "DELETE" })
    aud = upd.status >= 400 && del.status >= 400 ? upd : { status: 200 }
  }
}
ok("AUD-1 audit_log rejects UPDATE/DELETE (immutable)", aud.status >= 400,
  aud.status >= 400 ? "both blocked" : "mutation allowed")

// ── Summary ────────────────────────────────────────────────────────────────
console.log(failures === 0 ? "\n═══ RESULT: ALL PHASE 1 CHECKS PASSED ═══" : `\n═══ RESULT: ${failures} CHECK(S) FAILED ═══`)
process.exit(failures === 0 ? 0 : 1)
