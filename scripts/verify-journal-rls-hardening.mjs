// scripts/verify-journal-rls-hardening.mjs
// Live verification of migration 036 (journal RLS hardening) against the
// remote project. Uses the SAME paths an attacker would use:
//
//   RLS-1  authenticated user CANNOT INSERT journal_approvals(status='approved')
//          (self-approval chain cut at the source)
//   RLS-2  authenticated user CANNOT PATCH journal_entries.status → 'posted'
//          (direct posting bypass cut — proven via return=representation: 0 rows)
//   RLS-3  authenticated user CANNOT INSERT journal_entry_lines with a
//          foreign-tenant account (cross-tenant line injection cut)
//   RLS-4  authenticated user CANNOT UPDATE journal_entry_lines (line tamper cut)
//   RLS-5  authenticated SELECT still works (reads unaffected)
//   RLS-6  anon (unauthenticated) CANNOT INSERT journal_approvals
//   TRG-1  ACC001 period-open trigger fires on a direct service-role INSERT
//          of a 'posted' entry into a CLOSED period (defense-in-depth,
//          independent of RPC checks)
//   TRG-2  same trigger ALLOWS posting into an open period (no false positive)
//   REG-1  service-role RPC post_journal_entry still works (no regression)
//   REG-2  approve_journal_entry still works (no regression)
//
// Usage: node scripts/verify-journal-rls-hardening.mjs

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const envRaw = readFileSync(".env.local", "utf8")
const env = {}
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!BASE || !KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const T2 = "00000000-0000-0000-0000-0000000c0a2a" // scratch tenant
const RUN = Date.now()
let failures = 0

// token defaults to the service-role key (app/attacker-with-admin path);
// RLS tests pass the authenticated user token explicitly.
async function api(path, { method = "GET", body, token = KEY, prefer } = {}) {
  const headers = {
    apikey: token === KEY ? KEY : (ANON ?? KEY),
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(prefer ? { Prefer: prefer } : {}),
  }
  const res = await fetch(`${BASE}/rest/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, json, text }
}
function apiPost(path, body, token) { return api(path, { method: "POST", body, token }) }
function ok(name, pass, detail = "") {
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

// ── Setup: ensure scratch tenant + CoA (idempotent) ───────────────────────
await apiPost("/tenants", {
  id: T2, name_ar: "منشأة فحص المرحلة الثالثة", name_en: "Phase 3 Verify Tenant",
  country: "SA", status: "active", plan: "single_tenant",
})
await apiPost("/rpc/ensure_default_chart_of_accounts", { p_tenant_id: T2 })

const acct = await api(`/chart_of_accounts?select=id,account_code&tenant_id=eq.${T2}&account_code=in.(1000,3000)`)
const byCode = Object.fromEntries((acct.json ?? []).map((a) => [a.account_code, a.id]))
const cash = byCode["1000"]
const capital = byCode["3000"]

// ── Create a real authenticated user session (attacker path) ──────────────
const admin = createClient(BASE, KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const email = `rls-hardening-${RUN}@elite.local`
const password = "RlsHarden2026!" + Math.floor(1000 + Math.random() * 9000)
const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { email_verified: true },
})
if (authErr || !authUser?.user) {
  console.error("✗ could not create test auth user:", authErr?.message ?? "no user")
  process.exit(1)
}
const { error: usersErr } = await admin.from("users").insert({
  auth_user_id: authUser.user.id,
  tenant_id: T2,
  email,
  role: "accountant",
  status: "active",
  full_name_ar: "مدقق RLS",
  full_name_en: "RLS Hardening Tester",
  must_change_password: false,
  accepted_invite_at: new Date().toISOString(),
})
if (usersErr) {
  console.error("✗ could not insert users row:", usersErr.message)
  process.exit(1)
}
const { data: signIn, error: signInErr } = await admin.auth.signInWithPassword({ email, password })
if (signInErr || !signIn?.session?.access_token) {
  console.error("✗ could not sign in test user:", signInErr?.message ?? "no session")
  process.exit(1)
}
const userToken = signIn.session.access_token
console.log(`  test user ${email} (tenant ${T2.slice(0, 8)}…) signed in`)

// ── Seed a real draft + line for the authenticated PATCH probes ───────────
// (created via service-role RPC; the attacker then tries to mutate them)
const seedDraft = await apiPost("/rpc/create_journal_draft", {
  p_tenant_id: T2,
  p_entry_date: new Date().toISOString().slice(0, 10),
  p_description_ar: "Verify RLS-2 seed draft",
  p_lines: [
    { account_id: cash, debit: 30.0, credit: 0 },
    { account_id: capital, debit: 0, credit: 30.0 },
  ],
})
const seedDraftId = seedDraft.status === 200
  ? (Array.isArray(seedDraft.json) ? seedDraft.json[0]?.out_entry_id : seedDraft.json?.out_entry_id)
  : null
const seedLine = seedDraftId
  ? await api(`/journal_entry_lines?select=id&journal_entry_id=eq.${seedDraftId}&limit=1`)
  : { json: [] }
const seedLineId = seedLine.json?.[0]?.id

// ── RLS-1..5: authenticated user's direct table access ────────────────────
{
  // RLS-1: self-approval INSERT must be denied
  const r1 = await apiPost("/journal_approvals", {
    tenant_id: T2,
    journal_entry_id: "00000000-0000-0000-0000-000000000000",
    status: "approved",
    comment: "self-approve attempt",
  }, userToken)
  ok("RLS-1 authenticated INSERT journal_approvals denied", r1.status >= 400,
    `http ${r1.status}: ${r1.text?.slice(0, 110)}`)

  // RLS-2: direct status PATCH must touch ZERO rows (RLS filters the update)
  const r2 = seedDraftId
    ? await api(`/journal_entries?id=eq.${seedDraftId}&status=eq.draft`, {
        method: "PATCH", body: { status: "posted" }, token: userToken, prefer: "return=representation",
      })
    : { status: -1, json: null }
  ok("RLS-2 authenticated PATCH journal_entries affects 0 rows",
    r2.status === 200 && Array.isArray(r2.json) && r2.json.length === 0,
    `http ${r2.status}, rows=${Array.isArray(r2.json) ? r2.json.length : "?"}`)
  // …and the entry is still a draft
  const r2b = seedDraftId
    ? await api(`/journal_entries?select=status&id=eq.${seedDraftId}`, { token: userToken })
    : { json: [] }
  ok("RLS-2 entry remains draft after attacker PATCH",
    r2b.json?.[0]?.status === "draft", `status=${r2b.json?.[0]?.status}`)

  // RLS-3: foreign-account line injection must be denied
  const r3 = await apiPost("/journal_entry_lines", {
    tenant_id: T2,
    journal_entry_id: seedDraftId ?? "00000000-0000-0000-0000-000000000000",
    account_id: "11111111-0000-0000-0000-000000000001", // foreign tenant's account
    debit_amount: 1,
    credit_amount: 0,
  }, userToken)
  ok("RLS-3 authenticated INSERT journal_entry_lines denied", r3.status >= 400,
    `http ${r3.status}: ${r3.text?.slice(0, 110)}`)

  // RLS-4: line UPDATE must touch ZERO rows
  const r4 = seedLineId
    ? await api(`/journal_entry_lines?id=eq.${seedLineId}`, {
        method: "PATCH", body: { debit_amount: 999 }, token: userToken, prefer: "return=representation",
      })
    : { status: -1, json: null }
  ok("RLS-4 authenticated UPDATE journal_entry_lines affects 0 rows",
    r4.status === 200 && Array.isArray(r4.json) && r4.json.length === 0,
    `http ${r4.status}, rows=${Array.isArray(r4.json) ? r4.json.length : "?"}`)

  // RLS-5: SELECT still works (reads unaffected by hardening)
  const r5 = await api(`/chart_of_accounts?select=account_code&tenant_id=eq.${T2}&limit=1`, { token: userToken })
  ok("RLS-5 authenticated SELECT still works", r5.status === 200, `http ${r5.status}`)
}

// ── RLS-6: anon (no session) must be denied too ───────────────────────────
{
  const r6 = await apiPost("/journal_approvals", {
    tenant_id: T2,
    journal_entry_id: "00000000-0000-0000-0000-000000000000",
    status: "submitted",
  }, ANON)
  ok("RLS-6 anon INSERT journal_approvals denied", r6.status >= 400,
    `http ${r6.status}: ${r6.text?.slice(0, 110)}`)
}

// ── TRG-1/2: ACC001 period-open trigger (service-role direct writes) ──────
// Migration 036 adds a BEFORE INSERT OR UPDATE trigger on journal_entries
// raising ACC001 whenever a row lands in 'posted' against a closed period —
// even for service-role direct writes that skip RLS.
{
  const y = 2000 + (RUN % 700)
  const m = (RUN % 12) + 1
  const closed = await apiPost("/accounting_periods", {
    tenant_id: T2, period_year: y, period_month: m, status: "closed",
  })
  const closedPeriodId = Array.isArray(closed.json) ? closed.json[0]?.id : closed.json?.id

  // TRG-1: service-role direct INSERT of a 'posted' entry into the closed period
  const t1 = await apiPost("/journal_entries", {
    tenant_id: T2,
    entry_date: `${y}-${String(m).padStart(2, "0")}-10`,
    period_id: closedPeriodId,
    status: "posted",
    description_ar: "TRG-1 direct post into closed period",
  })
  ok("TRG-1 posted entry into closed period rejected (ACC001)",
    t1.status >= 400 && /ACC001/.test(t1.text),
    t1.status >= 400 ? t1.text?.match(/ACC\d+/)?.[0] ?? t1.text?.slice(0, 90) : `unexpected ${t1.status}`)

  // TRG-2: open period → direct 'posted' INSERT allowed (no false positive)
  const open = await apiPost("/accounting_periods", {
    tenant_id: T2, period_year: y, period_month: (m % 12) + 1, status: "open",
  })
  const openPeriodId = Array.isArray(open.json) ? open.json[0]?.id : open.json?.id
  const t2 = await apiPost("/journal_entries", {
    tenant_id: T2,
    entry_date: `${y}-${String((m % 12) + 1).padStart(2, "0")}-10`,
    period_id: openPeriodId,
    status: "posted",
    description_ar: "TRG-2 direct post into open period",
  })
  ok("TRG-2 posted entry into open period allowed",
    t2.status === 200 || t2.status === 201,
    `http ${t2.status}`)
}

// ── REG-1/2: RPC paths unaffected (no regression) ─────────────────────────
{
  const reg1 = await apiPost("/rpc/post_journal_entry", {
    p_tenant_id: T2,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify REG-1 post",
    p_lines: [
      { account_id: cash, debit: 12.0, credit: 0 },
      { account_id: capital, debit: 0, credit: 12.0 },
    ],
  })
  ok("REG-1 post_journal_entry still works", reg1.status === 200,
    reg1.status === 200 ? "posted" : `http ${reg1.status}: ${reg1.text?.slice(0, 120)}`)

  // draft → submit → approve (full approval path still functional)
  const draft = await apiPost("/rpc/create_journal_draft", {
    p_tenant_id: T2,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify REG-2 draft",
    p_lines: [
      { account_id: cash, debit: 8.0, credit: 0 },
      { account_id: capital, debit: 0, credit: 8.0 },
    ],
  })
  const draftId = draft.status === 200 ? (Array.isArray(draft.json) ? draft.json[0]?.out_entry_id : draft.json?.out_entry_id) : null
  if (draftId) {
    await apiPost("/rpc/submit_journal_entry", { p_tenant_id: T2, p_entry_id: draftId })
    const appr = await apiPost("/rpc/approve_journal_entry", { p_tenant_id: T2, p_entry_id: draftId, p_comment: "ok" })
    ok("REG-2 approve_journal_entry still works", appr.status === 200,
      appr.status === 200 ? "posted" : `http ${appr.status}: ${appr.text?.slice(0, 120)}`)
  } else {
    ok("REG-2 approve_journal_entry still works", false, `draft failed http ${draft.status}`)
  }
}

console.log(failures === 0 ? "\n═══ RESULT: ALL HARDENING CHECKS PASSED ═══" : `\n═══ RESULT: ${failures} CHECK(S) FAILED ═══`)
process.exit(failures === 0 ? 0 : 1)
