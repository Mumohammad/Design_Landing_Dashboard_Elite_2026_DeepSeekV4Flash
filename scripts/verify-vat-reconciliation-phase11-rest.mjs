// scripts/verify-vat-reconciliation-phase11-rest.mjs
// Phase 11 (VAT reconciliation) verification against the LIVE Supabase project.
//
//   R-1  migration 051: vat_reconciliation view exists + queryable, demo
//        tenant has a reconciliation row for the current period
//   R-2  net-position math equals a manual calculation on scratch data
//        (output + adjustments_output − recoverable input − adjustments_input)
//   R-3  non-recoverable and pending_review input are EXCLUDED from the net
//        but pending rows are surfaced (pending_review_rows count)
//   R-4  review-item lifecycle: pending_review row reclassifiable to
//        recoverable/non_recoverable; an already-classified row is locked
//        (VAT004 trigger)
//   R-5  RLS: anon denied; authenticated user sees only own-tenant rows
//
// Uses the scratch tenant T2 — rerunnable (per-run refs/rows).
//
// Usage: node scripts/verify-vat-reconciliation-phase11-rest.mjs

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
const Y = now.getFullYear()
// Scratch period: a unique synthetic month per run so probes never collide
// with earlier runs (or the Phase 8 leftovers) in the shared T2 tenant.
const M = 1 + (RUN % 12)
const ref = `VAT11-${B}`

// ── R-1: migration 051 view contract ─────────────────────────────────────
const viewSel = await rest(`/vat_reconciliation?select=period_year,period_month,net_position&limit=1`)
ok("R-1a vat_reconciliation view exposed", viewSel.status === 200,
  viewSel.status === 200 ? "select OK" : `http ${viewSel.status} ${viewSel.text?.slice(0, 120)}`)

// R-1b/c: read the demo tenant's actual seeded period, then verify the view
// carries that period with its status and a computed net position.
const demoPeriod = await rest(
  `/vat_periods?select=period_year,period_month,status&tenant_id=eq.${T}&limit=1&order=period_year.desc,period_month.desc`
)
const dp = firstRow(demoPeriod.json)
ok("R-1b demo tenant has a seeded vat_period", demoPeriod.status === 200 && !!dp,
  dp ? `${dp.period_year}-${dp.period_month} status=${dp.status}` : `http ${demoPeriod.status}`)

const demoRecon = dp
  ? await rest(
      `/vat_reconciliation?select=period_year,period_month,period_status,output_vat,recoverable_input_vat,net_position&tenant_id=eq.${T}&period_year=eq.${dp.period_year}&period_month=eq.${dp.period_month}`
    )
  : { status: 0, json: null, text: "no period" }
const demoRow = firstRow(demoRecon.json)
ok("R-1c demo period reconciliation row present in view", demoRecon.status === 200 && !!demoRow,
  demoRow ? `${demoRow.period_year}-${demoRow.period_month} net=${demoRow.net_position}` : "row missing")
ok("R-1d demo row carries the seeded period status", !!demoRow && !!dp && demoRow.period_status === dp.status,
  demoRow ? `status=${demoRow.period_status} (seeded ${dp?.status})` : "no status")

// ── R-2/R-3: net-position math on scratch data ───────────────────────────
// Output 20,000 · recoverable input 10,000 · non-recoverable 2,000 ·
// pending 1,500 · adjustments output -750 (credit note) · adjustments input 0
// net = 20,000 + (-750) − 10,000 − 0 = 9,250
const OUT_VAT = 20000
const REC_VAT = 10000
const NONREC_VAT = 2000
const PENDING_VAT = 1500
const ADJ_OUT = -750

const outRow = await rest("/vat_output_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: ref,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: OUT_VAT * 100 / 15, vat_rate: 15, vat_amount: OUT_VAT,
    source_entity_type: "invoice", source_entity_id: randomUUID(),
  },
  prefer: "return=representation",
})
ok("R-2a output ledger row inserted", outRow.status === 201 && Number(firstRow(outRow.json)?.vat_amount) === OUT_VAT,
  outRow.status === 201 ? `vat=${firstRow(outRow.json)?.vat_amount}` : `http ${outRow.status}`)

const recRow = await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: `${ref}-R`,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: REC_VAT * 100 / 15, vat_rate: 15, vat_amount: REC_VAT,
    vat_recoverability: "recoverable", source_entity_type: "expense", source_entity_id: randomUUID(),
  },
  prefer: "return=representation",
})
ok("R-2b recoverable input row inserted", recRow.status === 201, `http ${recRow.status}`)

const nonRecRow = await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: `${ref}-NR`,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: NONREC_VAT * 100 / 15, vat_rate: 15, vat_amount: NONREC_VAT,
    vat_recoverability: "non_recoverable", source_entity_type: "expense", source_entity_id: randomUUID(),
  },
  prefer: "return=representation",
})
ok("R-3a non-recoverable input row inserted", nonRecRow.status === 201, `http ${nonRecRow.status}`)

const pendRow = await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: `${ref}-P`,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: PENDING_VAT * 100 / 15, vat_rate: 15, vat_amount: PENDING_VAT,
    vat_recoverability: "pending_review", source_entity_type: "expense", source_entity_id: randomUUID(),
  },
  prefer: "return=representation",
})
const pendId = firstRow(pendRow.json)?.id
ok("R-3b pending_review input row inserted", pendRow.status === 201 && !!pendId, `http ${pendRow.status}`)

const adjRow = await rest("/vat_adjustments", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, adjustment_type: "credit_note",
    direction: "output", base_amount: 5000, vat_amount: ADJ_OUT, reason: `Phase 11 probe ${B}`,
    status: "finalized", source_entity_type: "probe", source_entity_id: randomUUID(),
  },
  prefer: "return=representation",
})
ok("R-2c adjustments row (credit note, −750) inserted", adjRow.status === 201 && Number(firstRow(adjRow.json)?.vat_amount) === ADJ_OUT,
  adjRow.status === 201 ? `vat=${firstRow(adjRow.json)?.vat_amount}` : `http ${adjRow.status}`)

const recon = await rest(
  `/vat_reconciliation?select=period_year,period_month,period_status,output_vat,recoverable_input_vat,non_recoverable_vat,pending_review_vat,pending_review_rows,adjustments_output,adjustments_input,net_position&tenant_id=eq.${T2}&period_year=eq.${Y}&period_month=eq.${M}`
)
const rr = firstRow(recon.json)
const expectedNet = OUT_VAT + ADJ_OUT - REC_VAT - 0 // 9,250
ok("R-2d reconciliation net equals manual calculation",
  recon.status === 200 && !!rr && Number(rr.net_position) === expectedNet,
  rr ? `net=${rr.net_position} expected=${expectedNet}` : `http ${recon.status} ${recon.text?.slice(0, 120)}`)
ok("R-2e output/input/adjustments totals surfaced",
  !!rr && Number(rr.output_vat) === OUT_VAT && Number(rr.recoverable_input_vat) === REC_VAT && Number(rr.adjustments_output) === ADJ_OUT,
  rr ? `out=${rr.output_vat} rec=${rr.recoverable_input_vat} adjOut=${rr.adjustments_output}` : "no row")
ok("R-3c non-recoverable shown but excluded from net",
  !!rr && Number(rr.non_recoverable_vat) === NONREC_VAT,
  rr ? `nonRec=${rr.non_recoverable_vat}` : "no row")
ok("R-3d pending rows surfaced and excluded from net",
  !!rr && Number(rr.pending_review_vat) === PENDING_VAT && Number(rr.pending_review_rows) === 1,
  rr ? `pending=${rr.pending_review_vat} rows=${rr.pending_review_rows}` : "no row")

// ── R-4: review-item lifecycle ────────────────────────────────────────────
// pending → recoverable (allowed by the trigger)
const resolveOK = await rest(`/vat_input_ledger?id=eq.${pendId}`, {
  method: "PATCH", body: { vat_recoverability: "recoverable" }, prefer: "return=representation",
})
ok("R-4a pending_review row reclassified to recoverable",
  resolveOK.status === 200 && firstRow(resolveOK.json)?.vat_recoverability === "recoverable",
  `http ${resolveOK.status} ${firstRow(resolveOK.json)?.vat_recoverability ?? resolveOK.text?.slice(0, 100)}`)

const pendId2 = firstRow((await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: `${ref}-P2`,
    invoice_date: now.toISOString().slice(0, 10), vat_base_amount: 1000, vat_rate: 15, vat_amount: 150,
    vat_recoverability: "pending_review", source_entity_type: "expense", source_entity_id: randomUUID(),
  },
  prefer: "return=representation",
})).json)?.id

// pending → non_recoverable (allowed)
const resolveNR = await rest(`/vat_input_ledger?id=eq.${pendId2}`, {
  method: "PATCH", body: { vat_recoverability: "non_recoverable" }, prefer: "return=representation",
})
ok("R-4b pending_review row reclassified to non_recoverable",
  resolveNR.status === 200 && firstRow(resolveNR.json)?.vat_recoverability === "non_recoverable",
  `http ${resolveNR.status} ${firstRow(resolveNR.json)?.vat_recoverability ?? resolveNR.text?.slice(0, 100)}`)

// now the same row is NOT pending — a second change must be rejected (VAT004)
const lockAttempt = await rest(`/vat_input_ledger?id=eq.${pendId2}`, {
  method: "PATCH", body: { vat_recoverability: "recoverable" }, prefer: "return=minimal",
})
ok("R-4c already-classified row locked (VAT004)",
  lockAttempt.status >= 400 && /VAT004/.test(lockAttempt.text),
  `http ${lockAttempt.status} ${lockAttempt.text?.slice(0, 130)}`)

// ── R-5: RLS ─────────────────────────────────────────────────────────────
const anonView = await fetch(`${BASE}/rest/v1/vat_reconciliation?select=id&limit=1`, {
  headers: { apikey: "", Authorization: "Bearer anon" },
})
ok("R-5a anon request denied", anonView.status === 401, `http ${anonView.status}`)

const email = `verify11-${RUN}@elite.local`
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
      full_name_ar: "مدير فحص المرحلة الحادية عشرة", full_name_en: "Phase 11 Verify GM",
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
  const own = await rest(`/vat_reconciliation?select=tenant_id,period_year,period_month&tenant_id=eq.${T}`, { token: userToken })
  const cross = await rest(`/vat_reconciliation?select=tenant_id&tenant_id=neq.${T}`, { token: userToken })
  ok("R-5c user sees own-tenant reconciliation rows",
    own.status === 200 && (own.json ?? []).length > 0,
    own.status === 200 ? `rows=${(own.json ?? []).length}` : `http ${own.status}`)
  ok("R-5d cross-tenant reconciliation rows filtered by RLS",
    cross.status === 200 && (cross.json ?? []).length === 0,
    cross.status === 200 ? `rows=${(cross.json ?? []).length}` : `http ${cross.status}`)
}

console.log(failures === 0 ? "\n✅ ALL PHASE 11 CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
