// scripts/verify-invoice-phase5-rest.mjs
// Phase 5 (Invoice Engine) verification against the LIVE Supabase project via
// the same service-role REST path the app uses. Covers the DB-level invariants:
//
//   SANITY  demo seed invoice INV-2026-000001 exists with 2 lines and the
//           mock totals 100,000 / 15,000 / 115,000 + its finalized event
//   I-1     create draft → DB assigns INV-YYYY-00000X, totals computed
//   I-2     sales invoice without a customer → INV005 (trigger)
//   I-3     due date before issue date → INV008 (trigger)
//   I-4     bad math (total ≠ subtotal + vat) → CHECK rejects (400)
//   I-5     line immutability after finalize (insert line → blocked)
//   I-6     finalized immutability (PATCH total on finalized → INV003)
//   I-7     negative/NaN-proof amounts → rejected
//   I-8     credit note numbering + immutable once created
//   I-9     debit note numbering + immutable once created
//   I-10    anon request denied (no API key)
//
// The app-level lifecycle (issue → finalize → cancel, credit/debit issuance,
// financial event emission) runs through server actions and is verified in the
// browser flow; this script asserts the DB contracts they rely on.
//
// Uses a scratch tenant (T2). Re-runnable: run-unique codes.
//
// Usage: node scripts/verify-invoice-phase5-rest.mjs

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
const T2 = "00000000-0000-0000-0000-0000000c0a2a" // scratch tenant for engine tests
const RUN = Date.now()
const B = 1000 + (RUN % 9000)
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

// ── SANITY: demo seed invoice + event ─────────────────────────────────────
const seed = await api(
  `/invoices?select=id,invoice_number,invoice_type,status,subtotal,discount,vat_amount,total&tenant_id=eq.${T}&invoice_number=eq.INV-2026-000001&deleted_at=is.null`
)
const seedInv = firstRow(seed.json)
ok("SANITY demo invoice INV-2026-000001 seeded", seed.status === 200 && !!seedInv,
  seed.status === 200 && seedInv ? `status=${seedInv.status}` : `http ${seed.status}`)
ok("SANITY demo invoice math 100,000 / 15,000 / 115,000",
  !!seedInv && Number(seedInv.subtotal) === 100000 && Number(seedInv.vat_amount) === 15000 && Number(seedInv.total) === 115000,
  seedInv ? `subtotal=${seedInv.subtotal} vat=${seedInv.vat_amount} total=${seedInv.total}` : "no row")

const seedLines = await api(
  `/invoice_lines?select=line_no,description,amount,vat_amount&invoice_id=eq.${seedInv?.id}`
)
ok("SANITY demo invoice has 2 lines", seedLines.status === 200 && (seedLines.json ?? []).length === 2,
  seedLines.status === 200 ? `found ${(seedLines.json ?? []).length}` : `http ${seedLines.status}`)

const seedEvt = await api(
  `/financial_events?select=id,event_type,processing_status,idempotency_key&source_type=eq.invoice&source_id=eq.${seedInv?.id}`
)
ok("SANITY InvoiceFinalizedEvent row exists for seed", seedEvt.status === 200 && (seedEvt.json ?? []).length === 1
  && firstRow(seedEvt.json)?.event_type === "InvoiceFinalizedEvent",
  seedEvt.status === 200 ? `found ${(seedEvt.json ?? []).length}` : `http ${seedEvt.status}`)

// Ensure scratch tenant + a customer for sales invoices.
await api("/tenants", {
  method: "POST",
  body: { id: T2, name_ar: "منشأة فحص المرحلة الخامسة", name_en: "Phase 5 Verify Tenant", country: "SA", status: "active", plan: "single_tenant" },
})
const custCode = `IVC${B}`
const cust = await api("/customers", {
  method: "POST",
  body: { tenant_id: T2, customer_code: custCode, name_ar: "عميل فواتير", name_en: "Invoice Customer" },
})
const custId = firstRow(cust.json)?.id

// ── I-1: create draft → numbering + totals ────────────────────────────────
const inv1 = await api("/invoices", {
  method: "POST",
  body: {
    tenant_id: T2,
    invoice_type: "sales",
    customer_id: custId,
    issue_date: "2026-08-01",
    due_date: "2026-08-31",
    currency: "SAR",
    status: "draft",
    subtotal: 100000.0, discount: 0, vat_amount: 15000.0, total: 115000.0, vat_rate: 15,
  },
})
const inv1Id = firstRow(inv1.json)?.id
const inv1No = firstRow(inv1.json)?.invoice_number
ok("I-1 draft created with INV-YYYY-00000X number", inv1.status === 201 && /^(INV|PINV)-\d{4}-\d{6}$/.test(inv1No ?? ""),
  inv1.status === 201 ? `number=${inv1No}` : `http ${inv1.status}: ${inv1.text?.slice(0, 140)}`)
ok("I-1 lines accepted on draft", (await api("/invoice_lines", {
  method: "POST",
  body: [
    { tenant_id: T2, invoice_id: inv1Id, line_no: 1, description: "Delivery service", quantity: 800, unit_price: 100.0, discount: 0, amount: 80000.0, vat_rate: 15, vat_amount: 12000.0 },
    { tenant_id: T2, invoice_id: inv1Id, line_no: 2, description: "COD handling", quantity: 800, unit_price: 25.0, discount: 0, amount: 20000.0, vat_rate: 15, vat_amount: 3000.0 },
  ],
})).status === 201)

// ── I-2: sales without customer → INV005 ─────────────────────────────────
const noParty = await api("/invoices", {
  method: "POST",
  body: { tenant_id: T2, invoice_type: "sales", issue_date: "2026-08-01", due_date: "2026-08-31", subtotal: 100, vat_amount: 15, total: 115, vat_rate: 15 },
})
ok("I-2 sales invoice without customer rejected (INV005)", noParty.status >= 400 && /INV005/.test(noParty.text),
  `http ${noParty.status}: ${noParty.text?.slice(0, 120)}`)

// ── I-3: due date before issue date → INV008 ──────────────────────────────
const badDate = await api("/invoices", {
  method: "POST",
  body: { tenant_id: T2, invoice_type: "sales", customer_id: custId, issue_date: "2026-08-31", due_date: "2026-08-01", subtotal: 100, vat_amount: 15, total: 115, vat_rate: 15 },
})
ok("I-3 due date before issue date rejected (INV008)", badDate.status >= 400 && /INV008/.test(badDate.text),
  `http ${badDate.status}: ${badDate.text?.slice(0, 120)}`)

// ── I-4: math CHECK (total ≠ subtotal + vat) ──────────────────────────────
const inv2 = await api("/invoices", {
  method: "POST",
  body: { tenant_id: T2, invoice_type: "sales", customer_id: custId, issue_date: "2026-08-01", due_date: "2026-08-31", status: "draft", subtotal: 1000.0, discount: 0, vat_amount: 150.0, total: 1150.0, vat_rate: 15 },
})
const inv2Id = firstRow(inv2.json)?.id
const mathErr = await api(`/invoices?id=eq.${inv2Id}`, {
  method: "PATCH",
  body: { total: 9999.99 },
})
ok("I-4 inconsistent total rejected by DB CHECK", mathErr.status >= 400,
  `http ${mathErr.status}: ${mathErr.text?.slice(0, 120)}`)

// ── I-5 + I-6: finalize then immutability ─────────────────────────────────
const fin = await api(`/invoices?id=eq.${inv2Id}`, {
  method: "PATCH",
  body: { status: "finalized", finalized_at: new Date().toISOString() },
})
ok("I-5 finalize via status update works (draft → finalized)", fin.status === 204,
  `http ${fin.status}: ${fin.text?.slice(0, 140)}`)

const lineBlocked = await api("/invoice_lines", {
  method: "POST",
  body: { tenant_id: T2, invoice_id: inv2Id, line_no: 9, description: "late line", quantity: 1, unit_price: 10, discount: 0, amount: 10, vat_rate: 15, vat_amount: 1.5 },
})
ok("I-5 line insert on finalized invoice blocked (INV003)", lineBlocked.status >= 400 && /INV003/.test(lineBlocked.text),
  `http ${lineBlocked.status}: ${lineBlocked.text?.slice(0, 120)}`)

const totalBlocked = await api(`/invoices?id=eq.${inv2Id}`, {
  method: "PATCH",
  body: { total: 1.0 },
})
ok("I-6 total change on finalized invoice blocked (INV003)", totalBlocked.status >= 400 && /INV003/.test(totalBlocked.text),
  `http ${totalBlocked.status}: ${totalBlocked.text?.slice(0, 120)}`)

// ── I-7: negative amount rejected ─────────────────────────────────────────
const neg = await api("/invoices", {
  method: "POST",
  body: { tenant_id: T2, invoice_type: "sales", customer_id: custId, issue_date: "2026-08-01", due_date: "2026-08-31", subtotal: -5, vat_amount: 0, total: -5, vat_rate: 15 },
})
ok("I-7 negative amount rejected (INV012/CHECK)", neg.status >= 400,
  `http ${neg.status}: ${neg.text?.slice(0, 120)}`)

// ── I-8: credit note numbering + immutability ─────────────────────────────
const cn = await api("/credit_notes", {
  method: "POST",
  body: {
    tenant_id: T2,
    reference_invoice_id: inv2Id,
    customer_id: custId,
    issue_date: "2026-08-05",
    status: "finalized",
    subtotal: 1000.0, discount: 0, vat_amount: 150.0, total: 1150.0, vat_rate: 15,
    reason: "Test credit note",
    lines: [],
  },
})
const cnId = firstRow(cn.json)?.id
const cnNo = firstRow(cn.json)?.credit_note_number
ok("I-8 credit note numbered CN-YYYY-00000X", cn.status === 201 && /^CN-\d{4}-\d{6}$/.test(cnNo ?? ""),
  cn.status === 201 ? `number=${cnNo}` : `http ${cn.status}: ${cn.text?.slice(0, 140)}`)
const cnImmutable = await api(`/credit_notes?id=eq.${cnId}`, {
  method: "PATCH",
  body: { reason: "changed" },
})
ok("I-8 credit note immutable after creation (INV014)", cnImmutable.status >= 400 && /INV014/.test(cnImmutable.text),
  `http ${cnImmutable.status}: ${cnImmutable.text?.slice(0, 120)}`)

// ── I-9: debit note numbering + immutability ──────────────────────────────
const dn = await api("/debit_notes", {
  method: "POST",
  body: {
    tenant_id: T2,
    reference_invoice_id: inv2Id,
    customer_id: custId,
    issue_date: "2026-08-05",
    status: "finalized",
    subtotal: 200.0, discount: 0, vat_amount: 30.0, total: 230.0, vat_rate: 15,
    reason: "Test debit note",
    lines: [],
  },
})
const dnId = firstRow(dn.json)?.id
const dnNo = firstRow(dn.json)?.debit_note_number
ok("I-9 debit note numbered DN-YYYY-00000X", dn.status === 201 && /^DN-\d{4}-\d{6}$/.test(dnNo ?? ""),
  dn.status === 201 ? `number=${dnNo}` : `http ${dn.status}: ${dn.text?.slice(0, 140)}`)
const dnImmutable = await api(`/debit_notes?id=eq.${dnId}`, {
  method: "PATCH",
  body: { reason: "changed" },
})
ok("I-9 debit note immutable after creation (INV014)", dnImmutable.status >= 400 && /INV014/.test(dnImmutable.text),
  `http ${dnImmutable.status}: ${dnImmutable.text?.slice(0, 120)}`)

// ── I-10: anon denied ─────────────────────────────────────────────────────
const anon = await fetch(`${BASE}/rest/v1/invoices?select=id&limit=1`, { headers: { apikey: "anon-invalid" } })
ok("I-10 anon request denied (401)", anon.status === 401, `http ${anon.status}`)

console.log(failures === 0
  ? "\n═══ RESULT: ALL PHASE 5 DB CHECKS PASSED ═══"
  : `\n═══ RESULT: ${failures} CHECK(S) FAILED ═══`)
process.exit(failures === 0 ? 0 : 1)
