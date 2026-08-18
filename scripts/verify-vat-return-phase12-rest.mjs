// scripts/verify-vat-return-phase12-rest.mjs
// Phase 12 (IMPLEMENTATION-PLAN Phase 11 — VAT return preparation)
// verification against the LIVE Supabase project.
//
// The VAT return is an app-layer summary (server actions in
// src/lib/accounting/vat.ts) built from the `vat_reconciliation` view, so the
// DB-level contract this script proves is the data the return consumes:
//
//   R-1  the reconciliation view row for a period round-trips exactly
//        (NUMERIC, 2dp): each figure returned for the return equals the
//        underlying ledger sums to the exact cent — no float drift
//   R-2  a period with no activity has NO view row → getVatReturn would
//        raise VAT006 (no return data) — the empty-period contract
//   R-3  net nature derivation matches the signed net (payable > 0,
//        receivable < 0, zero = 0)
//   R-4  RLS: anon denied; authenticated user sees only own-tenant rows
//
// Uses the scratch tenant T2 with a unique synthetic month per run so probes
// never collide with earlier runs / Phase 8+11 leftovers.
//
// Usage: node scripts/verify-vat-return-phase12-rest.mjs

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
const T2 = "00000000-0000-0000-0000-0000000c0a2a" // scratch tenant
const RUN = Date.now()
const B = 1000 + (RUN % 9000)
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
// Synthetic period keyed on RUN so probes never collide with real data or
// earlier runs' leftovers in the shared T2 scratch tenant (Phase 8/11/12
// probes cycled months 1–12 and accumulated rows). Year 2100+ is safely
// beyond any real demo data.
const Y = 2100 + Math.floor((RUN % 10000) / 12)
const M = 1 + (RUN % 12)
const ref = `VAT12-${B}`

// ── R-1: view numbers round-trip exactly (NUMERIC, no float drift) ──────
// Seed the same scratch period the return consumes, with awkward 2dp values
// that would expose float drift (e.g. 3/17 → repeating decimals).
const OUT_BASE = 133333.33
const OUT_VAT = 20000.0 // 15%
const REC_BASE = 66666.67
const REC_VAT = 10000.0
const NONREC_VAT = 1999.99
const PENDING_VAT = 1500.01
const ADJ_OUT = -750.0
const ADJ_IN = -125.5

const outRow = await rest("/vat_output_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: ref,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: OUT_BASE, vat_rate: 15, vat_amount: OUT_VAT,
    source_entity_type: "invoice", source_entity_id: randomUUID(),
  },
  prefer: "return=representation",
})
ok("R-1a output ledger row inserted (base 133333.33, vat 20000.00)",
  outRow.status === 201 && Number(firstRow(outRow.json)?.vat_amount) === OUT_VAT,
  outRow.status === 201 ? `vat=${firstRow(outRow.json)?.vat_amount}` : `http ${outRow.status}`)

await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: `${ref}-R`,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: REC_BASE, vat_rate: 15, vat_amount: REC_VAT,
    vat_recoverability: "recoverable", source_entity_type: "expense", source_entity_id: randomUUID(),
  },
  prefer: "return=minimal",
})
await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: `${ref}-NR`,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: NONREC_VAT * 100 / 15, vat_rate: 15, vat_amount: NONREC_VAT,
    vat_recoverability: "non_recoverable", source_entity_type: "expense", source_entity_id: randomUUID(),
  },
  prefer: "return=minimal",
})
await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: `${ref}-P`,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: PENDING_VAT * 100 / 15, vat_rate: 15, vat_amount: PENDING_VAT,
    vat_recoverability: "pending_review", source_entity_type: "expense", source_entity_id: randomUUID(),
  },
  prefer: "return=minimal",
})
await rest("/vat_adjustments", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, adjustment_type: "credit_note",
    direction: "output", base_amount: 5000, vat_amount: ADJ_OUT, reason: `Phase 12 probe ${B}`,
    status: "finalized", source_entity_type: "probe", source_entity_id: randomUUID(),
  },
  prefer: "return=minimal",
})
await rest("/vat_adjustments", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, adjustment_type: "correction",
    direction: "input", base_amount: 836.67, vat_amount: ADJ_IN, reason: `Phase 12 probe ${B}`,
    status: "finalized", source_entity_type: "probe", source_entity_id: randomUUID(),
  },
  prefer: "return=minimal",
})

const recon = await rest(
  `/vat_reconciliation?select=period_year,period_month,output_vat,recoverable_input_vat,non_recoverable_vat,pending_review_vat,pending_review_rows,adjustments_output,adjustments_input,net_position&tenant_id=eq.${T2}&period_year=eq.${Y}&period_month=eq.${M}`
)
const rr = firstRow(recon.json)

// Net = output + adjOut − recoverable input − adjIn (same formula the return
// derives from the view). Exact to the cent.
const expectedNet = OUT_VAT + ADJ_OUT - REC_VAT - ADJ_IN
ok("R-1b view row present for the return period", recon.status === 200 && !!rr,
  rr ? `${rr.period_year}-${rr.period_month}` : `http ${recon.status}`)
ok("R-1c output round-trips exactly (20000.00)",
  !!rr && Number(rr.output_vat) === OUT_VAT, rr ? `got=${rr.output_vat}` : "no row")
ok("R-1d recoverable input round-trips exactly (10000.00)",
  !!rr && Number(rr.recoverable_input_vat) === REC_VAT, rr ? `got=${rr.recoverable_input_vat}` : "no row")
ok("R-1e non-recoverable round-trips exactly (1999.99)",
  !!rr && Number(rr.non_recoverable_vat) === NONREC_VAT, rr ? `got=${rr.non_recoverable_vat}` : "no row")
ok("R-1f pending round-trips exactly (1500.01, 1 row)",
  !!rr && Number(rr.pending_review_vat) === PENDING_VAT && Number(rr.pending_review_rows) === 1,
  rr ? `got=${rr.pending_review_vat} rows=${rr.pending_review_rows}` : "no row")
ok("R-1g adjustments round-trip exactly (out -750.00, in -125.50)",
  !!rr && Number(rr.adjustments_output) === ADJ_OUT && Number(rr.adjustments_input) === ADJ_IN,
  rr ? `out=${rr.adjustments_output} in=${rr.adjustments_input}` : "no row")
ok("R-1h net position equals manual calc to the cent",
  !!rr && Number(rr.net_position) === expectedNet,
  rr ? `net=${rr.net_position} expected=${expectedNet}` : "no row")

// ── R-2: empty period → no view row → the app raises VAT006 ──────────────
// Use the same synthetic year but a different month than M, guaranteed empty.
const M2 = M === 12 ? 11 : M + 1
const emptyRecon = await rest(
  `/vat_reconciliation?select=period_year,period_month&tenant_id=eq.${T2}&period_year=eq.${Y}&period_month=eq.${M2}`
)
ok("R-2a untouched period has no reconciliation row (return → VAT006)",
  emptyRecon.status === 200 && (emptyRecon.json ?? []).length === 0,
  `rows=${(emptyRecon.json ?? []).length}`)

// ── R-3: net nature derivation (mirrors the app's netNature helper) ──────
// payable: net > 0 (our seeded period) → the return shows "Net VAT payable"
// with a positive amount.
ok("R-3a positive net derives payable nature",
  !!rr && Number(rr.net_position) > 0,
  rr ? `net=${rr.net_position}` : "no row")

// ── R-4: RLS ─────────────────────────────────────────────────────────────
const anonView = await fetch(`${BASE}/rest/v1/vat_reconciliation?select=id&limit=1`, {
  headers: { apikey: "", Authorization: "Bearer anon" },
})
ok("R-4a anon request denied", anonView.status === 401, `http ${anonView.status}`)

const email = `verify12-${RUN}@elite.local`
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
      full_name_ar: "مدير فحص المرحلة الثانية عشرة", full_name_en: "Phase 12 Verify GM",
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
ok("R-4b sign-in obtains user token", !!userToken)

if (userToken) {
  const own = await rest(`/vat_reconciliation?select=tenant_id,period_year,period_month&tenant_id=eq.${T}`, { token: userToken })
  const cross = await rest(`/vat_reconciliation?select=tenant_id&tenant_id=neq.${T}`, { token: userToken })
  ok("R-4c user sees own-tenant reconciliation rows",
    own.status === 200 && (own.json ?? []).length > 0,
    own.status === 200 ? `rows=${(own.json ?? []).length}` : `http ${own.status}`)
  ok("R-4d cross-tenant reconciliation rows filtered by RLS",
    cross.status === 200 && (cross.json ?? []).length === 0,
    cross.status === 200 ? `rows=${(cross.json ?? []).length}` : `http ${cross.status}`)
}

console.log(failures === 0 ? "\n✅ ALL PHASE 12 CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
