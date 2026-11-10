// scripts/verify-statements-phase13-rest.mjs
// Phase 13 (IMPLEMENTATION-PLAN Phase 12 — Financial statements)
// verification against the LIVE Supabase project.
//
//   R-1  migration 052: profit_loss, balance_sheet, cash_flow views exposed
//   R-2  P&L math: income − expense accounts from POSTED entries only
//        (drafts excluded; posted entries included) — net profit = income − expenses
//   R-3  Balance Sheet: Assets = Liabilities + Equity on seeded journals
//   R-4  Cash Flow: cash account (1000/1100) movement by entry_type
//   R-5  RLS: anon denied; authenticated user sees only own-tenant rows
//
// Uses the scratch tenant T2 with a synthetic period keyed on RUN (year
// 2100+) so probes never collide with real data or earlier phases' leftovers.
//
// Usage: node scripts/verify-statements-phase13-rest.mjs

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
const B = 1000 + (RUN % 9000)
// Fresh scratch tenant PER RUN — the balance_sheet view is cumulative, so a
// shared scratch tenant's leftover journals from earlier phases would break
// the exact balance assertions. randomUUID avoids ID collisions across runs.
const T2 = randomUUID()
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

const firstRow = (j) => (Array.isArray(j) ? j[0] : j)
const now = new Date()
// Synthetic periods keyed on RUN (year 2100+) — never collide with real data.
const Y = 2100 + Math.floor((RUN % 10000) / 12)
const M = 1 + (RUN % 12)
const M2 = M === 12 ? 1 : M + 1
const Y2 = M === 12 ? Y + 1 : Y
const ref = `STMT13-${B}`

// ── R-1: views exposed ──────────────────────────────────────────────────
for (const view of ["profit_loss", "balance_sheet", "cash_flow"]) {
  const sel = await rest(`/${view}?select=*&limit=1`)
  ok(`R-1 ${view} view exposed`, sel.status === 200, `http ${sel.status}`)
}

// ── Seed the scratch tenant + its CoA ──────────────────────────────────
const tenRes = await rest("/tenants", {
  method: "POST",
  body: {
    id: T2,
    name_ar: `فحص القوائم ${B}`,
    name_en: `Statements Probe ${B}`,
    vat_number: `31${String(B).padStart(12, "0")}`,
    email: `stmt13-${B}@elite.local`,
  },
  prefer: "return=minimal",
})
ok("R-1b scratch tenant created", tenRes.status === 201 || tenRes.status === 200,
  `http ${tenRes.status} ${tenRes.status >= 400 ? tenRes.text.slice(0, 160) : ""}`)
const coaSeed = await fetch(`${BASE}/rest/v1/rpc/ensure_default_chart_of_accounts`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_tenant_id: T2 }),
})
ok("R-1c scratch CoA seeded", coaSeed.status === 200 || coaSeed.status === 204, `http ${coaSeed.status}`)

// ── Seed journals in T2: posted + draft ────────────────────────────────
// Period 1 (P&L / cash-flow tests):
//   income journal  Dr 1000 cash 50,000 · Cr 4000 revenue 50,000
//   expense journal Dr 5800 expense 20,000 · Cr 1000 cash 20,000
//   one DRAFT journal (99,999) — must be excluded everywhere
// Period 2 (balance-sheet test — balance sheet is CUMULATIVE, so the
// opening + closing entries must live in a later period than the P&L ones
// for Assets = Liab + Equity to hold):
//   opening journal  Dr 1000 cash 80,000 · Cr 3000 capital 80,000
//   closing revenue  Dr 4000 50,000 · Cr 3100 retained earnings 50,000
//   closing expense  Dr 3100 retained earnings 20,000 · Cr 5800 20,000
const incomeCoa = await rest(
  `/chart_of_accounts?select=id&tenant_id=eq.${T2}&account_code=eq.4000&deleted_at=is.null`
)
const incomeAcc = firstRow(incomeCoa.json)
const expenseCoa = await rest(
  `/chart_of_accounts?select=id&tenant_id=eq.${T2}&account_code=eq.5800&deleted_at=is.null`
)
const expenseAcc = firstRow(expenseCoa.json)
const cashCoa = await rest(
  `/chart_of_accounts?select=id&tenant_id=eq.${T2}&account_code=eq.1000&deleted_at=is.null`
)
const cashAcc = firstRow(cashCoa.json)
const capitalCoa = await rest(
  `/chart_of_accounts?select=id&tenant_id=eq.${T2}&account_code=eq.3000&deleted_at=is.null`
)
const capitalAcc = firstRow(capitalCoa.json)
const retainedCoa = await rest(
  `/chart_of_accounts?select=id&tenant_id=eq.${T2}&account_code=eq.3100&deleted_at=is.null`
)
const retainedAcc = firstRow(retainedCoa.json)

async function postJournal(description, lines, { status = "posted", year = Y, month = M, type = "manual" } = {}) {
  const entry = await rest("/journal_entries", {
    method: "POST",
    body: {
      tenant_id: T2, entry_date: `${year}-${String(month).padStart(2, "0")}-15`,
      entry_type: type, status, description_ar: description, description_en: description,
      source_module: "probe", source_entity_type: "phase13", source_entity_id: randomUUID(),
    },
    prefer: "return=representation",
  })
  const entryRow = firstRow(entry.json)
  if (!entryRow?.id) return { status: entry.status, text: entry.text }
  // JRN004 (balance) is a DEFERRABLE INITIALLY DEFERRED trigger, so all lines
  // must land in ONE transaction — PostgREST multi-row insert = single INSERT
  // statement, checked at COMMIT.
  const linesRes = await rest("/journal_entry_lines", {
    method: "POST",
    body: lines.map((l) => ({
      tenant_id: T2,
      journal_entry_id: entryRow.id,
      account_id: l.account,
      debit_amount: l.debit ?? 0,
      credit_amount: l.credit ?? 0,
    })),
    prefer: "return=minimal",
  })
  if (linesRes.status >= 400) {
    return { status: linesRes.status, text: linesRes.text }
  }
  return { status: 201, id: entryRow.id }
}

const postedIncome = await postJournal(ref, [
  { account: incomeAcc.id, credit: 50000 },
  { account: cashAcc.id, debit: 50000 },
])
ok("R-2a posted income journal (50,000)", postedIncome.status === 201, `http ${postedIncome.status}`)

const postedExpense = await postJournal(`${ref}-E`, [
  { account: expenseAcc.id, debit: 20000 },
  { account: cashAcc.id, credit: 20000 },
])
ok("R-2b posted expense journal (20,000)", postedExpense.status === 201, `http ${postedExpense.status}`)

// Draft journal: income 99,999 — must NOT appear in statements.
await postJournal(`${ref}-DRAFT`, [
  { account: incomeAcc.id, credit: 99999 },
  { account: cashAcc.id, debit: 99999 },
], { status: "draft" })

// Period 2 balance-sheet scaffolding.
await postJournal(`${ref}-OPEN`, [
  { account: cashAcc.id, debit: 80000 },
  { account: capitalAcc.id, credit: 80000 },
], { year: Y2, month: M2, type: "opening" })
await postJournal(`${ref}-CLOSE-R`, [
  { account: incomeAcc.id, debit: 50000 },
  { account: retainedAcc.id, credit: 50000 },
], { year: Y2, month: M2 })
await postJournal(`${ref}-CLOSE-E`, [
  { account: retainedAcc.id, debit: 20000 },
  { account: expenseAcc.id, credit: 20000 },
], { year: Y2, month: M2 })

const pl = await rest(
  `/profit_loss?select=account_code,account_type,normal_balance,total_debit,total_credit,net_balance&tenant_id=eq.${T2}&period_year=eq.${Y}&period_month=eq.${M}`
)
const plRows = (pl.json ?? [])
ok("R-2c P&L rows present", pl.status === 200 && plRows.length >= 2, `rows=${plRows.length}`)
const incomeRow = plRows.find((r) => r.account_type === "income")
const expenseRow = plRows.find((r) => r.account_type === "expense")
ok("R-2d income row = 50,000 (credit, net +50,000)",
  !!incomeRow && Number(incomeRow.net_balance) === 50000,
  incomeRow ? `net=${incomeRow.net_balance}` : "no income row")
ok("R-2e expense row = 20,000 (debit, net −20,000)",
  !!expenseRow && Number(expenseRow.net_balance) === -20000,
  expenseRow ? `net=${expenseRow.net_balance}` : "no expense row")
// Draft (99,999) must NOT leak — total income stays 50,000.
ok("R-2f draft entries excluded (income still 50,000)",
  !!incomeRow && Number(incomeRow.net_balance) === 50000)

// Balance sheet AS OF period 2 end (cumulative): cash 30,000 + opening 80,000
// = 110,000; equity = capital 80,000 + retained (50,000 − 20,000) 30,000.
const bs = await rest(
  `/balance_sheet?select=account_code,account_type,normal_balance,balance&tenant_id=eq.${T2}&period_year=eq.${Y2}&period_month=eq.${M2}`
)
const bsRows = (bs.json ?? [])
const bsAssets = bsRows.filter((r) => r.account_type === "asset").reduce((s, r) => s + Number(r.balance), 0)
const bsLiab = bsRows.filter((r) => r.account_type === "liability").reduce((s, r) => s + Number(r.balance), 0)
const bsEquity = bsRows.filter((r) => r.account_type === "equity").reduce((s, r) => s + Number(r.balance), 0)
ok("R-3a balance sheet rows present", bs.status === 200 && bsRows.length > 0, `rows=${bsRows.length}`)
ok("R-3b Assets = Liabilities + Equity",
  Math.abs(bsAssets - (bsLiab + bsEquity)) < 0.01,
  `assets=${bsAssets} liab=${bsLiab} equity=${bsEquity}`)
ok("R-3c cash asset balance = 110,000 (30,000 net + 80,000 opening)",
  bsRows.find((r) => r.account_code === "1000" && Math.abs(Number(r.balance) - 110000) < 0.01) !== undefined,
  bsRows.filter((r) => r.account_code === "1000").map((r) => `bal=${r.balance}`).join(" ") || "no 1000 row")

const cf = await rest(
  `/cash_flow?select=entry_type,entry_count,cash_in,cash_out,net_cash_flow&tenant_id=eq.${T2}&period_year=eq.${Y}&period_month=eq.${M}`
)
const cfRows = (cf.json ?? [])
const cfNet = cfRows.reduce((s, r) => s + Number(r.net_cash_flow), 0)
ok("R-4a cash flow rows present", cf.status === 200 && cfRows.length > 0, `rows=${cfRows.length}`)
ok("R-4b cash flow net = 30,000 (50,000 in − 20,000 out)",
  Math.abs(cfNet - 30000) < 0.01, `net=${cfNet}`)
ok("R-4c draft journal not in cash flow (2 entries)",
  cfRows.reduce((s, r) => s + Number(r.entry_count), 0) === 2,
  `entries=${cfRows.reduce((s, r) => s + Number(r.entry_count), 0)}`)

// ── R-5: RLS ─────────────────────────────────────────────────────────────
const anonView = await fetch(`${BASE}/rest/v1/profit_loss?select=id&limit=1`, {
  headers: { apikey: "", Authorization: "Bearer anon" },
})
ok("R-5a anon request denied", anonView.status === 401, `http ${anonView.status}`)

const email = `verify13-${RUN}@elite.local`
const password = "EliteVerify2026!" + (1000 + (RUN % 9000))
async function fetchRetry(url, opts, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, opts)
    } catch (e) {
      if (i === attempts) throw e
      await new Promise((r) => setTimeout(r, 1500 * i))
    }
  }
}
const created = await fetchRetry(`${BASE}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { email_verified: true } }),
})
const authUid = (await created.json()).id
if (authUid) {
  await rest("/users", {
    method: "POST",
    body: {
      auth_user_id: authUid, tenant_id: T, email, role: "general_manager", status: "active",
      full_name_ar: "مدير فحص المرحلة الثالثة عشرة", full_name_en: "Phase 13 Verify GM",
      must_change_password: false, accepted_invite_at: now.toISOString(),
    },
    prefer: "return=minimal",
  })
}
const signin = await fetchRetry(`${BASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
})
const userToken = (await signin.json()).access_token
ok("R-5b sign-in obtains user token", !!userToken)

if (userToken) {
  const own = await rest(`/profit_loss?select=tenant_id&tenant_id=eq.${T}`, { token: userToken })
  const cross = await rest(`/profit_loss?select=tenant_id&tenant_id=neq.${T}`, { token: userToken })
  ok("R-5c user sees own-tenant P&L rows",
    own.status === 200 && (own.json ?? []).length > 0,
    own.status === 200 ? `rows=${(own.json ?? []).length}` : `http ${own.status}`)
  ok("R-5d cross-tenant P&L rows filtered by RLS",
    cross.status === 200 && (cross.json ?? []).length === 0,
    cross.status === 200 ? `rows=${(cross.json ?? []).length}` : `http ${cross.status}`)
}

console.log(failures === 0 ? "\n✅ ALL PHASE 13 CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
