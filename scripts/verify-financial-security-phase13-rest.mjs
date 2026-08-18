// scripts/verify-financial-security-phase13-rest.mjs
// Financial Phase 14 / IMPLEMENTATION-PLAN Phase 13 — Security & audit review.
//
// Pen-test-style checks against the LIVE Supabase project:
//
//   S1  RLS cross-tenant reads   — user in tenant T cannot read scratch
//                                 tenant T2 rows on any financial table/view
//   S2  RLS forged tenant_id     — user in T cannot INSERT/UPDATE with
//                                 tenant_id = T2 (WITH CHECK)
//   S3  Immutability             — posted journals, finalized invoices +
//                                 lines, notes, events, audit_log cannot be
//                                 mutated; DELETE is soft-delete only
//   S4  Anon denied              — no anonymous access to financial tables,
//                                 views, or engine RPCs
//   S5  Service-role boundary    — service role (app) can still read/write
//                                 (expected trust boundary)
//   S6  Audit coverage           — audit_log rows exist for financial
//                                 modules and are immutable
//   S7  financial_events append-only (migration 053): authenticated INSERT
//                                 into own-tenant events ledger is blocked
//   S8  Engine RPCs not exposed  — dispatcher/post_journal RPCs reject
//                                 authenticated callers
//
// Usage: node scripts/verify-financial-security-phase13-rest.mjs

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

const T = "00000000-0000-0000-0000-000000000001" // demo tenant (the user's tenant)
const RUN = Date.now()
const B = 1000 + (RUN % 9000)
const T2 = randomUUID() // scratch tenant the user must NOT see
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
const Y = 2100 + Math.floor((RUN % 10000) / 12)
const M = 1 + (RUN % 12)
const ref = `SEC13-${B}`
const monthY = Y, monthM = ((M % 12) + 1) // synthetic month for vat probes

// ── Provision: scratch tenant T2 with data ──────────────────────────────
const tenRes = await rest("/tenants", {
  method: "POST",
  body: {
    id: T2,
    name_ar: `فحص أمني ${B}`,
    name_en: `Security Probe ${B}`,
    vat_number: `31${String(B).padStart(12, "0")}`,
    email: `sec13-${B}@elite.local`,
  },
  prefer: "return=minimal",
})
ok("S0 scratch tenant created", tenRes.status === 201 || tenRes.status === 200, `http ${tenRes.status}`)
await fetch(`${BASE}/rest/v1/rpc/ensure_default_chart_of_accounts`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_tenant_id: T2 }),
})
// seed T2 with one row per core table so cross-tenant probes have data to hide
const sup2 = await rest("/suppliers", {
  method: "POST",
  body: {
    tenant_id: T2, supplier_code: `SUP${B}`, name_ar: "مورد أمني", name_en: "Security Supplier",
    tax_number: `31${String(B).padStart(13, "0")}`,
  },
  prefer: "return=representation",
})
const sup2Row = firstRow(sup2.json)
const inv2 = await rest("/invoices", {
  method: "POST",
  body: {
    tenant_id: T2, invoice_number: `PINV-${ref}`, invoice_type: "purchase",
    supplier_id: sup2Row?.id, issue_date: `${Y}-06-01`, due_date: `${Y}-07-01`,
    status: "draft", subtotal: 100, vat_amount: 15, total: 115,
  },
  prefer: "return=representation",
})
const inv2Row = firstRow(inv2.json)
const coa2 = await rest(`/chart_of_accounts?select=id&tenant_id=eq.${T2}&account_code=eq.4000&deleted_at=is.null`)
const coa2Acc = firstRow(coa2.json)
const jl2 = await rest("/journal_entries", {
  method: "POST",
  body: {
    tenant_id: T2, entry_date: `${Y}-06-15`, entry_type: "manual", status: "posted",
    description_ar: ref, description_en: ref, source_module: "probe", source_entity_type: "phase14", source_entity_id: randomUUID(),
  },
  prefer: "return=representation",
})
const jl2Row = firstRow(jl2.json)
if (jl2Row?.id && coa2Acc?.id) {
  await rest("/journal_entry_lines", {
    method: "POST",
    body: [
      { tenant_id: T2, journal_entry_id: jl2Row.id, account_id: coa2Acc.id, credit_amount: 50 },
      { tenant_id: T2, journal_entry_id: jl2Row.id, account_id: coa2Acc.id, debit_amount: 50 },
    ],
    prefer: "return=minimal",
  })
}
const ev2 = await rest("/financial_events", {
  method: "POST",
  body: {
    tenant_id: T2, event_id: randomUUID(), idempotency_key: `sec13-${ref}`, source_type: "invoice",
    source_id: inv2Row?.id ?? randomUUID(), event_type: "InvoiceFinalizedEvent", event_date: `${Y}-06-20`, payload: { ref },
  },
  prefer: "return=representation",
})
const ex2 = await rest("/expenses", {
  method: "POST",
  body: { tenant_id: T2, expense_type: "operational", amount: 50, expense_date: `${Y}-06-10`, description: ref },
  prefer: "return=representation",
})
await rest("/vat_periods", {
  method: "POST",
  body: { tenant_id: T2, period_year: monthY, period_month: monthM },
  prefer: "return=representation",
})

// ── Provision: GM user in tenant T (must not see T2) ────────────────────
const email = `sec13-${RUN}@elite.local`
const password = "EliteVerify2026!" + (1000 + (RUN % 9000))
async function fetchRetry(url, opts, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try { return await fetch(url, opts) } catch (e) {
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
      full_name_ar: "مدير فحص أمني", full_name_en: "Security Verify GM",
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
ok("S0 user token obtained", !!userToken)

// =====================================================================
// S1 — cross-tenant reads blocked
// =====================================================================
const readTables = [
  "invoices", "invoice_lines", "credit_notes", "debit_notes",
  "journal_entries", "journal_entry_lines", "chart_of_accounts",
  "customers", "suppliers", "receivables", "payables", "finance_payments",
  "payment_allocations", "bank_accounts", "vat_output_ledger", "vat_input_ledger",
  "vat_periods", "vat_adjustments", "financial_events",
  "expenses", "expense_category_mappings", "generated_documents",
]
for (const tbl of readTables) {
  const r = await rest(`/${tbl}?select=id&tenant_id=eq.${T2}`, { token: userToken })
  const blocked = r.status === 200 && (r.json ?? []).length === 0
  const denied = r.status === 403 || r.status === 401
  ok(`S1 read ${tbl} cross-tenant blocked`, blocked || denied,
    r.status === 200 ? `rows=${(r.json ?? []).length}` : `http ${r.status}`)
}
// views
for (const v of ["profit_loss", "balance_sheet", "cash_flow", "vat_reconciliation"]) {
  const r = await rest(`/${v}?select=tenant_id&tenant_id=eq.${T2}`, { token: userToken })
  ok(`S1 read view ${v} cross-tenant blocked`, r.status === 200 && (r.json ?? []).length === 0,
    r.status === 200 ? `rows=${(r.json ?? []).length}` : `http ${r.status}`)
}

// =====================================================================
// S2 — forged tenant_id INSERT blocked (WITH CHECK)
// =====================================================================
const forgedInserts = [
  {
    name: "invoices",
    body: {
      tenant_id: T2, invoice_number: `FORGED-${ref}`, invoice_type: "purchase",
      supplier_id: sup2Row?.id, issue_date: `${Y}-08-01`, due_date: `${Y}-08-15`,
      status: "draft", subtotal: 0, vat_amount: 0, total: 0,
    },
  },
  {
    name: "journal_entries",
    body: { tenant_id: T2, entry_date: `${Y}-08-10`, entry_type: "manual", status: "draft", description_ar: ref },
  },
  {
    name: "chart_of_accounts",
    body: { tenant_id: T2, account_code: `9999`, name_ar: "مزور", name_en: "Forged", account_type: "asset", normal_balance: "debit" },
  },
  {
    name: "financial_events",
    body: {
      tenant_id: T2, event_id: randomUUID(), idempotency_key: `forged-${ref}`, source_type: "invoice",
      source_id: randomUUID(), event_type: "InvoiceFinalizedEvent", event_date: `${Y}-08-12`, payload: { forged: true },
    },
  },
  {
    name: "expenses",
    body: { tenant_id: T2, expense_type: "operational", amount: 10, expense_date: `${Y}-08-10` },
  },
  {
    name: "vat_periods",
    body: { tenant_id: T2, period_year: 2099, period_month: 11 },
  },
  {
    name: "customers",
    body: { tenant_id: T2, customer_code: `CUS-FORGED`, name_ar: "مزور", name_en: "Forged" },
  },
]
for (const probe of forgedInserts) {
  const r = await rest(`/${probe.name}`, { method: "POST", body: probe.body, token: userToken, prefer: "return=minimal" })
  ok(`S2 forged tenant INSERT ${probe.name} blocked`, r.status === 403,
    `http ${r.status} ${r.text.slice(0, 120)}`)
}
// UPDATE with forged tenant_id must not reach T2 rows (silently 0 rows)
const upd = await rest(`/invoices?tenant_id=eq.${T2}&select=id`, {
  method: "PATCH",
  body: { notes: "tamper" },
  token: userToken,
  prefer: "return=representation",
})
ok("S2 forged tenant UPDATE affects 0 T2 rows", upd.status === 200 && (upd.json ?? []).length === 0,
  upd.status === 200 ? `rows=${(upd.json ?? []).length}` : `http ${upd.status}`)

// =====================================================================
// S7 — financial_events append-only for authenticated users (053)
// =====================================================================
const ownEvt = await rest("/financial_events", {
  method: "POST",
  body: {
    tenant_id: T, event_id: randomUUID(), idempotency_key: `own-${ref}`, source_type: "invoice",
    source_id: randomUUID(), event_type: "InvoiceFinalizedEvent", event_date: `${Y}-08-12`, payload: { forged: true },
  },
  token: userToken,
  prefer: "return=minimal",
})
ok("S7 authenticated INSERT into own financial_events blocked (053)",
  ownEvt.status === 403, `http ${ownEvt.status} ${ownEvt.text.slice(0, 120)}`)

// =====================================================================
// S3 — immutability of posted/finalized/immutable records
// =====================================================================
// find a posted journal + finalized invoice + audit row in tenant T
const postedJe = await rest(`/journal_entries?select=id,status&tenant_id=eq.${T}&status=eq.posted&limit=1`, { token: userToken })
const postedJeRow = firstRow(postedJe.json)
if (postedJeRow?.id) {
  // journal mutations are service-role-RPC-only since 036 — the user PATCH
  // must affect 0 rows (RLS), and even the SERVICE ROLE must be stopped by
  // the immutability trigger (JRN001).
  const mutUser = await rest(`/journal_entries?id=eq.${postedJeRow.id}`, {
    method: "PATCH", body: { description_ar: "tamper" }, token: userToken, prefer: "return=representation",
  })
  const mutSr = await rest(`/journal_entries?id=eq.${postedJeRow.id}`, {
    method: "PATCH", body: { description_ar: "tamper-sr" }, prefer: "return=minimal",
  })
  ok("S3 posted journal immutable (user RLS blocks; trigger blocks service role)",
    (mutUser.status === 200 && (mutUser.json ?? []).length === 0) &&
    (mutSr.status === 400 || mutSr.status === 403),
    `user http ${mutUser.status} rows=${(mutUser.json ?? []).length}; service http ${mutSr.status} ${mutSr.text.slice(0, 80)}`)
} else {
  ok("S3 posted journal immutable (user RLS blocks; trigger blocks service role)", false, "no posted journal found in tenant T")
}
const finInv = await rest(`/invoices?select=id,status&tenant_id=eq.${T}&status=neq.draft&limit=1`, { token: userToken })
const finInvRow = firstRow(finInv.json)
if (finInvRow?.id) {
  const mut = await rest(`/invoices?id=eq.${finInvRow.id}`, {
    method: "PATCH", body: { subtotal: 1 }, token: userToken, prefer: "return=minimal",
  })
  ok("S3 finalized invoice amount immutable", mut.status === 400 || mut.status === 403,
    `http ${mut.status} ${mut.text.slice(0, 100)}`)
} else {
  ok("S3 finalized invoice amount immutable", false, "no non-draft invoice found in tenant T")
}
// financial_events has no UPDATE policy → authenticated PATCH affects 0 rows
const evT = await rest(`/financial_events?select=id&tenant_id=eq.${T}&limit=1`, { token: userToken })
const evTRow = firstRow(evT.json)
if (evTRow?.id) {
  const mut = await rest(`/financial_events?id=eq.${evTRow.id}`, {
    method: "PATCH", body: { processing_status: "processed" }, token: userToken, prefer: "return=representation",
  })
  ok("S3 financial_events not user-mutable via RLS (no UPDATE policy)",
    mut.status === 200 && (mut.json ?? []).length === 0,
    `http ${mut.status} rows=${(mut.json ?? []).length}`)
} else {
  ok("S3 financial_events not user-mutable via RLS", false, "no event found in tenant T")
}
// audit_log immutable (trigger) — via service role so only the trigger can block
const auditRow = await rest(`/audit_log?select=id&limit=1`)
const auditRowRow = firstRow(auditRow.json)
if (auditRowRow?.id) {
  const mut = await rest(`/audit_log?id=eq.${auditRowRow.id}`, {
    method: "PATCH", body: { action: "tamper" }, prefer: "return=minimal",
  })
  ok("S3 audit_log immutable (trigger)", mut.status === 400 || mut.status === 403,
    `http ${mut.status} ${mut.text.slice(0, 100)}`)
} else {
  ok("S3 audit_log immutable (trigger)", false, "no audit row found")
}
// DELETE is soft-delete only: as user, DELETE on own invoice must not hard-delete
const del = await rest(`/invoices?tenant_id=eq.${T}&select=id&limit=1`, { method: "DELETE", token: userToken, prefer: "return=representation" })
ok("S3 DELETE on invoices yields 0 hard-deleted rows (soft-delete only)",
  del.status === 200 && (del.json ?? []).length === 0,
  del.status === 200 ? `deleted=${(del.json ?? []).length}` : `http ${del.status}`)

// =====================================================================
// S4 — anon denied on tables, views, RPCs
// =====================================================================
for (const tbl of ["invoices", "journal_entries", "financial_events", "vat_periods", "expenses"]) {
  const r = await rest(`/${tbl}?select=id&limit=1`, { anon: true })
  ok(`S4 anon read ${tbl} denied`, r.status === 401, `http ${r.status}`)
}
for (const v of ["profit_loss", "vat_reconciliation"]) {
  const r = await rest(`/${v}?select=tenant_id&limit=1`, { anon: true })
  ok(`S4 anon read view ${v} denied`, r.status === 401, `http ${r.status}`)
}
for (const rpc of ["dispatch_pending_events", "post_journal_entry", "ensure_default_chart_of_accounts"]) {
  const r = await rest(`/rpc/${rpc}`, { method: "POST", body: {}, anon: true })
  ok(`S4 anon rpc ${rpc} denied`, r.status === 401 || r.status === 403 || r.status === 404, `http ${r.status}`)
}

// =====================================================================
// S8 — engine RPCs not exposed to authenticated users
// =====================================================================
for (const rpc of ["dispatch_pending_events", "post_journal_entry"]) {
  const r = await rest(`/rpc/${rpc}`, { method: "POST", body: {}, token: userToken })
  ok(`S8 authenticated rpc ${rpc} denied`, r.status === 403 || r.status === 404 || r.status === 401, `http ${r.status}`)
}

// =====================================================================
// S5 — service-role boundary (expected trust)
// =====================================================================
const srEv = await rest(`/financial_events?select=id&tenant_id=eq.${T2}&limit=1`)
ok("S5 service role reads events (app trust boundary)", srEv.status === 200 && (srEv.json ?? []).length > 0,
  srEv.status === 200 ? `rows=${(srEv.json ?? []).length}` : `http ${srEv.status}`)
const srInv = await rest(`/invoices?select=id&tenant_id=eq.${T2}&limit=1`)
ok("S5 service role reads cross-tenant (app trust boundary)", srInv.status === 200 && (srInv.json ?? []).length > 0,
  srInv.status === 200 ? `rows=${(srInv.json ?? []).length}` : `http ${srInv.status}`)

// =====================================================================
// S6 — audit coverage for financial modules
// =====================================================================
const audit = await rest(
  `/audit_log?select=module,action&module=in.(accounting,invoices,expenses,reports)&limit=5&order=created_at.desc`
)
const auditRows = audit.json ?? []
ok("S6 audit_log has financial-module entries", audit.status === 200 && auditRows.length > 0,
  audit.status === 200 ? `rows=${auditRows.length}` : `http ${audit.status}`)

console.log(failures === 0 ? "\n✅ ALL SECURITY CHECKS PASSED" : `\n❌ ${failures} SECURITY CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
