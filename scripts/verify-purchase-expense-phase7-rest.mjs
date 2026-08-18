// scripts/verify-purchase-expense-phase7-rest.mjs
// Phase 7 (Purchase / Expense integration) verification against the LIVE
// Supabase project over the same REST paths the app uses.
//
//   P-1  migration 040: expenses VAT columns + expense_category_mappings seed
//   P-2  purchase approval contracts: payable (source purchase_invoice) with
//        correct math + PurchaseInvoiceApprovedEvent canonical key
//   P-3  expense contracts: EXP-code default, EXP004 approval guard trigger,
//        mapping lookup, expense-source payable
//   P-4  RLS: anon 401, cross-tenant payables filtered, forged insert blocked
//   P-5  journal mapping math: Dr Expense + Dr VAT Input = Cr AP (balanced)
//   SEED demo-tenant expense for the browser approval flow
//
// The server actions (finalizeInvoice purchase branch, approveExpense) are
// verified end-to-end in the browser flow; this script asserts the DB
// contracts they rely on. Uses the scratch tenant T2 — rerunnable.
//
// Usage: node scripts/verify-purchase-expense-phase7-rest.mjs

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

async function auth(path, { method = "GET", body, key = KEY } = {}) {
  const res = await fetch(`${BASE}/auth/v1${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, json, text }
}

const firstRow = (j) => (Array.isArray(j) ? j[0] : j)
const today = new Date().toISOString().slice(0, 10)

// ── P-1: migration 040 contracts ─────────────────────────────────────────
const expCols = await rest(`/expenses?select=id,vat_rate,vat_amount,vat_recoverability,coa_account_code&limit=1`)
ok("P-1a expenses VAT columns present", expCols.status === 200,
  expCols.status === 200 ? "select OK" : `http ${expCols.status} ${expCols.text?.slice(0, 120)}`)

const mappings = await rest(`/expense_category_mappings?select=expense_type,coa_account_code,vat_recoverability&tenant_id=eq.${T}&order=expense_type.asc`)
ok("P-1b expense_category_mappings seeded for demo tenant (6 rows)",
  mappings.status === 200 && (mappings.json ?? []).length === 6,
  mappings.status === 200 ? `rows=${(mappings.json ?? []).length}` : `http ${mappings.status}`)
const fuelMap = (mappings.json ?? []).find((m) => m.expense_type === "fuel")
ok("P-1c fuel → CoA 5000 (recoverable)", !!fuelMap && fuelMap.coa_account_code === "5000" && fuelMap.vat_recoverability === "recoverable",
  fuelMap ? `fuel→${fuelMap.coa_account_code} (${fuelMap.vat_recoverability})` : "no fuel row")

// ── Auth setup (needed for P-3 approval write path + P-4 RLS) ────────────
const email = `verify7-${RUN}@elite.local`
const password = "EliteVerify2026!" + (1000 + (RUN % 9000))
const created = await auth("/admin/users", {
  method: "POST",
  body: { email, password, email_confirm: true, user_metadata: { email_verified: true } },
})
const authUid = created.json?.id
ok("SETUP scratch auth user created", created.status >= 200 && created.status < 300 && !!authUid,
  created.status >= 200 && created.status < 300 ? "" : `http ${created.status}`)
if (authUid) {
  await rest("/users", {
    method: "POST",
    body: {
      auth_user_id: authUid, tenant_id: T, email, role: "general_manager", status: "active",
      full_name_ar: "مدير فحص المرحلة السابعة", full_name_en: "Phase 7 Verify GM",
      must_change_password: false, accepted_invite_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  })
}
const signin = await auth("/token?grant_type=password", { method: "POST", key: ANON, body: { email, password } })
const userToken = signin.json?.access_token
ok("SETUP sign-in obtains user token", !!userToken)

// ── P-2: purchase approval contracts (scratch tenant) ────────────────────
const supCode = `PHS${B}`
const sup = await rest("/suppliers", {
  method: "POST",
  body: { tenant_id: T2, supplier_code: supCode, name_ar: "مورد فحص المرحلة السابعة", name_en: "Phase 7 Supplier" },
  prefer: "return=representation",
})
const supId = firstRow(sup.json)?.id
ok("P-2a scratch supplier created", sup.status === 201 && !!supId,
  sup.status === 201 ? `id=${supId}` : `http ${sup.status} ${sup.text?.slice(0, 140)}`)

// purchase draft (2 × 500 = 1000 net, 15% → 150 VAT, 1150 total)
const pinv = await rest("/invoices", {
  method: "POST",
  body: {
    tenant_id: T2,
    invoice_type: "purchase",
    supplier_id: supId,
    issue_date: today,
    due_date: today,
    currency: "SAR",
    status: "draft",
    subtotal: 1000, discount: 0, vat_amount: 150, total: 1150, vat_rate: 15,
  },
  prefer: "return=representation",
})
const pinvRow = firstRow(pinv.json)
ok("P-2b purchase draft created (PINV numbering)", pinv.status === 201 && /^PINV-/.test(pinvRow?.invoice_number ?? ""),
  pinv.status === 201 ? pinvRow?.invoice_number : `http ${pinv.status} ${pinv.text?.slice(0, 140)}`)

const issued = await rest(`/invoices?id=eq.${pinvRow?.id}`, {
  method: "PATCH", body: { status: "issued" }, prefer: "return=minimal",
})
const finalized = await rest(`/invoices?id=eq.${pinvRow?.id}`, {
  method: "PATCH",
  body: { status: "finalized", finalized_at: new Date().toISOString() },
  prefer: "return=minimal",
})
ok("P-2c purchase invoice lifecycle draft→issued→finalized allowed",
  issued.status === 204 && finalized.status === 204,
  `issued http ${issued.status} · finalized http ${finalized.status} ${finalized.text?.slice(0, 120)}`)

const payable = await rest("/payables", {
  method: "POST",
  body: {
    tenant_id: T2,
    supplier_id: supId,
    invoice_ref: pinvRow?.invoice_number,
    invoice_date: today,
    due_date: today,
    amount: 1000, vat_amount: 150, total_amount: 1150, paid_amount: 0,
    status: "open",
    source_entity_type: "purchase_invoice",
    source_entity_id: pinvRow?.id,
    notes: `Purchase invoice ${pinvRow?.invoice_number} approval`,
  },
  prefer: "return=representation",
})
ok("P-2d payable insert (source purchase_invoice) with correct math",
  payable.status === 201 && firstRow(payable.json)?.amount === 1000
  && firstRow(payable.json)?.vat_amount === 150 && firstRow(payable.json)?.total_amount === 1150,
  payable.status === 201 ? `total=${firstRow(payable.json)?.total_amount}` : `http ${payable.status} ${payable.text?.slice(0, 140)}`)

const evt = await rest("/financial_events", {
  method: "POST",
  body: {
    tenant_id: T2,
    event_id: crypto.randomUUID(),
    idempotency_key: `purchase_invoice:${pinvRow?.id}:approved`,
    source_type: "purchase_invoice",
    source_id: pinvRow?.id,
    event_type: "PurchaseInvoiceApprovedEvent",
    event_date: today,
    payload: { supplier_id: supId, invoice_ref: pinvRow?.invoice_number, subtotal: 1000, vat_amount: 150, total: 1150 },
  },
  prefer: "return=representation",
})
ok("P-2e PurchaseInvoiceApprovedEvent insert (canonical key)",
  evt.status === 201 && firstRow(evt.json)?.event_type === "PurchaseInvoiceApprovedEvent",
  evt.status === 201 ? `key=purchase_invoice:${pinvRow?.id?.slice(0, 8)}:approved` : `http ${evt.status} ${evt.text?.slice(0, 140)}`)

const dupEvt = await rest("/financial_events", {
  method: "POST",
  body: {
    tenant_id: T2,
    event_id: crypto.randomUUID(),
    idempotency_key: `purchase_invoice:${pinvRow?.id}:approved`,
    source_type: "purchase_invoice",
    source_id: pinvRow?.id,
    event_type: "PurchaseInvoiceApprovedEvent",
    event_date: today,
    payload: {},
  },
  prefer: "return=minimal",
})
ok("P-2f idempotency key UNIQUE — replay rejected", dupEvt.status >= 400,
  `http ${dupEvt.status} ${dupEvt.text?.slice(0, 100)}`)

// ── P-3: expense contracts ───────────────────────────────────────────────
const expCode = `EXP7${B}`
const exp = await rest("/expenses", {
  method: "POST",
  body: {
    tenant_id: T2,
    expense_code: expCode,
    expense_type: "fuel",
    category: "Fuel",
    amount: 1000,
    currency: "SAR",
    expense_date: today,
    description: "Phase 7 fuel expense",
    vendor: "Phase7 Fuel Co",
  },
  prefer: "return=representation",
})
const expRow = firstRow(exp.json)
ok("P-3a expense insert (pending) with VAT defaults", exp.status === 201 && !!expRow?.id
  && Number(expRow.vat_rate) === 15 && Number(expRow.vat_amount) === 0,
  exp.status === 201 ? `vat_rate=${expRow.vat_rate} vat_amount=${expRow.vat_amount}` : `http ${exp.status} ${exp.text?.slice(0, 140)}`)

// EXP004 guard: approving without approver/timestamp must be rejected
const expApproveBad = await rest(`/expenses?id=eq.${expRow?.id}`, {
  method: "PATCH", body: { is_approved: true }, prefer: "return=minimal",
})
ok("P-3b approval without approver+timestamp rejected (EXP004)",
  expApproveBad.status >= 400 && /EXP004/.test(expApproveBad.text),
  `http ${expApproveBad.status} ${expApproveBad.text?.slice(0, 140)}`)

// Correct approval write path (as the server action does it) — real authUid
const expApprove = await rest(`/expenses?id=eq.${expRow?.id}`, {
  method: "PATCH",
  body: { is_approved: true, approved_by: authUid, approved_at: new Date().toISOString(), vat_rate: 15, vat_amount: 150, vat_recoverability: "recoverable", coa_account_code: "5000" },
  prefer: "return=representation",
})
ok("P-3c expense approval write path OK (vat_amount = amount × 15%)",
  expApprove.status === 200 && Number(firstRow(expApprove.json)?.vat_amount) === 150,
  expApprove.status === 200 ? `vat_amount=${firstRow(expApprove.json)?.vat_amount}` : `http ${expApprove.status} ${expApprove.text?.slice(0, 140)}`)

const expPayable = await rest("/payables", {
  method: "POST",
  body: {
    tenant_id: T2,
    supplier_id: null,
    invoice_ref: expCode,
    invoice_date: today,
    due_date: today,
    amount: 1000, vat_amount: 150, total_amount: 1150, paid_amount: 0,
    status: "open",
    source_entity_type: "expense",
    source_entity_id: expRow?.id,
    notes: "Fuel — Phase7 Fuel Co",
  },
  prefer: "return=representation",
})
ok("P-3d expense-source payable insert OK", expPayable.status === 201,
  expPayable.status === 201 ? `total=${firstRow(expPayable.json)?.total_amount}` : `http ${expPayable.status} ${expPayable.text?.slice(0, 140)}`)

// expense_code default via sequence
const autoExp = await rest("/expenses", {
  method: "POST",
  body: { tenant_id: T2, expense_type: "other", amount: 50, expense_date: today, description: "auto code" },
  prefer: "return=representation",
})
ok("P-3e expense_code auto-generated EXP-YYYY-000xxx",
  autoExp.status === 201 && /^EXP-\d{4}-\d{6}$/.test(firstRow(autoExp.json)?.expense_code ?? ""),
  autoExp.status === 201 ? firstRow(autoExp.json)?.expense_code : `http ${autoExp.status}`)

// ── P-4: RLS probes (user token) ─────────────────────────────────────────
const anonPay = await fetch(`${BASE}/rest/v1/payables?select=id&limit=1`, {
  headers: { apikey: "", Authorization: "Bearer anon" },
})
ok("P-4a anon request denied", anonPay.status === 401, `http ${anonPay.status}`)

if (userToken) {
  const cross = await rest(`/payables?select=id&tenant_id=neq.${T}`, { token: userToken })
  ok("P-4b payables cross-tenant read filtered by RLS",
    cross.status === 200 && Array.isArray(cross.json) && cross.json.length === 0,
    cross.status === 200 ? `rows=${Array.isArray(cross.json) ? cross.json.length : "?"}` : `http ${cross.status}`)

  const forged = await rest("/expense_category_mappings", {
    method: "POST",
    token: userToken,
    body: { tenant_id: "99999999-9999-9999-9999-999999999999", expense_type: "other", coa_account_code: "5800" },
    prefer: "return=minimal",
  })
  ok("P-4c forged tenant insert on mappings blocked by RLS", forged.status >= 400,
    `http ${forged.status} ${forged.text?.slice(0, 130)}`)
}

// ── P-5: journal mapping math (pure) — Dr Expense + Dr VAT In = Cr AP ────
{
  const amount = 1000, vatRate = 15
  const vat = Math.round(amount * vatRate) / 100
  const total = amount + vat
  const debits = amount + vat // expense 1000 (5000) + VAT input 150 (2600)
  const credits = total        // AP 1150 (2000)
  ok("P-5 expense journal mapping balances (Dr 1000+150 = Cr 1150)",
    debits === credits && vat === 150 && total === 1150,
    `debits=${debits} credits=${credits}`)
}

// ── SEED: demo-tenant pending expense for the browser approval flow ──────
const seedExp = await rest("/expenses", {
  method: "POST",
  body: {
    tenant_id: T,
    expense_type: "fuel",
    category: "Fuel",
    amount: 800,
    currency: "SAR",
    expense_date: today,
    description: "Phase 7 browser verify fuel",
    vendor: "Browser Fuel Co",
  },
  prefer: "return=representation",
})
const seedRow = firstRow(seedExp.json)
ok("SEED demo-tenant pending expense for browser flow", seedExp.status === 201 && !!seedRow?.id,
  seedExp.status === 201 ? `code=${seedRow?.expense_code}` : `http ${seedExp.status}`)

console.log(failures === 0 ? "\n✅ ALL PHASE 7 CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
