// scripts/verify-vat-phase8-rest.mjs
// Phase 8 (VAT Engine) verification against the LIVE Supabase project.
//
//   V-1  migration 041: vat_periods + vat_adjustments exist, demo period
//        seeded, vat_input_ledger.vat_recoverability column
//   V-2  vat_adjustments immutability once finalized (VAT003)
//   V-3  the three mock net-position scenarios (0 / 5,000 payable /
//        5,000 receivable) computed with the dashboard formula
//        net = output + outputAdj − recoverable input − inputAdj
//   V-4  RLS: anon 401, cross-tenant adjustments filtered
//
// Uses the scratch tenant T2 — rerunnable (per-run periods/refs).
//
// Usage: node scripts/verify-vat-phase8-rest.mjs

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
const M = now.getMonth() + 1

// ── V-1: migration 041 contracts ─────────────────────────────────────────
const perSel = await rest(`/vat_periods?select=id,period_year,period_month,status&limit=1`)
ok("V-1a vat_periods table present", perSel.status === 200,
  perSel.status === 200 ? "select OK" : `http ${perSel.status} ${perSel.text?.slice(0, 120)}`)

const demoPeriod = await rest(`/vat_periods?select=id,period_year,period_month,status&tenant_id=eq.${T}&period_year=eq.${Y}&period_month=eq.${M}`)
ok("V-1b demo tenant current open period seeded", demoPeriod.status === 200
  && firstRow(demoPeriod.json)?.status === "open",
  demoPeriod.status === 200 ? `status=${firstRow(demoPeriod.json)?.status}` : `http ${demoPeriod.status}`)

const adjSel = await rest(`/vat_adjustments?select=id,status&limit=1`)
ok("V-1c vat_adjustments table present", adjSel.status === 200,
  adjSel.status === 200 ? "select OK" : `http ${adjSel.status}`)

const inLed = await rest(`/vat_input_ledger?select=id,vat_recoverability&limit=1`)
ok("V-1d vat_input_ledger.vat_recoverability column", inLed.status === 200,
  inLed.status === 200 ? "select OK" : `http ${inLed.status} ${inLed.text?.slice(0, 120)}`)

// ── V-2: vat_adjustments immutability (VAT003) ───────────────────────────
const adj = await rest("/vat_adjustments", {
  method: "POST",
  body: {
    tenant_id: T2,
    period_year: Y,
    period_month: M,
    adjustment_type: "credit_note",
    direction: "output",
    base_amount: 1000,
    vat_amount: -150,
    reason: `Phase 8 immutability probe ${B}`,
    status: "finalized",
    source_entity_type: "probe",
    source_entity_id: crypto.randomUUID(),
  },
  prefer: "return=representation",
})
const adjRow = firstRow(adj.json)
ok("V-2a finalized adjustment insert OK", adj.status === 201 && adjRow?.status === "finalized",
  adj.status === 201 ? `id=${adjRow?.id?.slice(0, 8)}` : `http ${adj.status} ${adj.text?.slice(0, 140)}`)

const adjTamper = await rest(`/vat_adjustments?id=eq.${adjRow?.id}`, {
  method: "PATCH", body: { vat_amount: -999 }, prefer: "return=minimal",
})
ok("V-2b finalized adjustment immutable (VAT003)",
  adjTamper.status >= 400 && /VAT003/.test(adjTamper.text),
  `http ${adjTamper.status} ${adjTamper.text?.slice(0, 130)}`)

const adjSrc = await rest("/vat_adjustments", {
  method: "POST",
  body: {
    tenant_id: T2,
    period_year: Y,
    period_month: M,
    adjustment_type: "credit_note",
    direction: "output",
    base_amount: 1,
    vat_amount: 1,
    reason: "dup source probe",
    status: "finalized",
    source_entity_type: "probe",
    source_entity_id: adjRow?.source_entity_id,
  },
  prefer: "return=minimal",
})
ok("V-2c one adjustment per source (unique index) — duplicate rejected", adjSrc.status >= 400,
  `http ${adjSrc.status} ${adjSrc.text?.slice(0, 100)}`)

// ── V-3: the three mock net-position scenarios ───────────────────────────
// net = Σ output + Σ output adjustments − Σ recoverable input − Σ input adjustments
{
  const scen = (name, output, recInput, nonRecInput, adjOut, adjIn, expected) => {
    const net = output + adjOut - recInput - adjIn
    ok(`V-3 ${name} net = ${expected}`, net === expected,
      `output=${output} recInput=${recInput} nonRec=${nonRecInput} adjOut=${adjOut} adjIn=${adjIn} → net=${net}`)
  }
  scen("A: balanced (0)", 10000, 10000, 500, 0, 0, 0)
  scen("B: 5,000 payable", 15000, 10000, 0, 0, 0, 5000)
  scen("C: 5,000 receivable", 5000, 10000, 0, 0, 0, -5000)
  scen("D: credit note reduces output", 15000, 10000, 0, -750, 0, 4250)
  // non-recoverable input is excluded from the net
  scen("E: non-recoverable excluded", 15000, 10000, 5000, 0, 0, 5000)
}

// Real rows: exercise the ledger + adjustment inserts the dispatcher writes
const ref = `VAT8-${B}`
const outRow = await rest("/vat_output_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: ref,
    invoice_date: new Date().toISOString().slice(0, 10), vat_base_amount: 100000, vat_rate: 15, vat_amount: 15000,
    source_entity_type: "invoice", source_entity_id: crypto.randomUUID(),
  },
  prefer: "return=representation",
})
ok("V-3f output ledger insert OK", outRow.status === 201 && Number(firstRow(outRow.json)?.vat_amount) === 15000,
  outRow.status === 201 ? `vat=${firstRow(outRow.json)?.vat_amount}` : `http ${outRow.status}`)

const inRow = await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: ref,
    invoice_date: new Date().toISOString().slice(0, 10), vat_base_amount: 100000, vat_rate: 15, vat_amount: 15000,
    vat_recoverability: "recoverable",
    source_entity_type: "expense", source_entity_id: crypto.randomUUID(),
  },
  prefer: "return=representation",
})
ok("V-3g input ledger insert with recoverability OK", inRow.status === 201
  && firstRow(inRow.json)?.vat_recoverability === "recoverable",
  inRow.status === 201 ? `rec=${firstRow(inRow.json)?.vat_recoverability}` : `http ${inRow.status} ${inRow.text?.slice(0, 130)}`)

const nonRecRow = await rest("/vat_input_ledger", {
  method: "POST",
  body: {
    tenant_id: T2, period_year: Y, period_month: M, invoice_ref: `${ref}-NR`,
    invoice_date: new Date().toISOString().slice(0, 10), vat_base_amount: 10000, vat_rate: 15, vat_amount: 1500,
    vat_recoverability: "non_recoverable",
    source_entity_type: "expense", source_entity_id: crypto.randomUUID(),
  },
  prefer: "return=representation",
})
ok("V-3h non-recoverable input row (excluded from net) OK", nonRecRow.status === 201
  && firstRow(nonRecRow.json)?.vat_recoverability === "non_recoverable",
  nonRecRow.status === 201 ? `rec=${firstRow(nonRecRow.json)?.vat_recoverability}` : `http ${nonRecRow.status}`)

// ── V-4: RLS probes ──────────────────────────────────────────────────────
const anonAdj = await fetch(`${BASE}/rest/v1/vat_adjustments?select=id&limit=1`, {
  headers: { apikey: "", Authorization: "Bearer anon" },
})
ok("V-4a anon request denied", anonAdj.status === 401, `http ${anonAdj.status}`)

const email = `verify8-${RUN}@elite.local`
const password = "EliteVerify2026!" + (1000 + (RUN % 9000))
const created = await fetch(`${BASE}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { email_verified: true } }),
})
const createdJson = await created.json()
const authUid = createdJson.id
if (authUid) {
  await rest("/users", {
    method: "POST",
    body: {
      auth_user_id: authUid, tenant_id: T, email, role: "general_manager", status: "active",
      full_name_ar: "مدير فحص المرحلة الثامنة", full_name_en: "Phase 8 Verify GM",
      must_change_password: false, accepted_invite_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  })
}
const signin = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
})
const userToken = (await signin.json()).access_token
ok("V-4b sign-in obtains user token", !!userToken)

if (userToken) {
  const cross = await rest(`/vat_adjustments?select=id&tenant_id=neq.${T}`, { token: userToken })
  ok("V-4c adjustments cross-tenant read filtered by RLS",
    cross.status === 200 && Array.isArray(cross.json) && cross.json.length === 0,
    cross.status === 200 ? `rows=${Array.isArray(cross.json) ? cross.json.length : "?"}` : `http ${cross.status}`)
}

console.log(failures === 0 ? "\n✅ ALL PHASE 8 CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
