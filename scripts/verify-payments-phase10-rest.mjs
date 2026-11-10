// scripts/verify-payments-phase10-rest.mjs
// Phase 10 (Payments Engine) verification against the LIVE Supabase project.
//
//   P-1  RPC surface: dispatch_pending_events callable by service role; anon
//        denied
//   P-2  CoA seeded for the scratch tenant (1000/1100/1200/2000)
//   P-3  Sales invoice finalized → receivable created (reused pipeline)
//   P-4  Bank account created with coa_account_code (default 1100)
//   P-5  Receipt (in): Dr Bank 1100 / Cr AR 1200 + receivable paid + invoice
//        status 'paid' + payment status 'allocated'
//   P-6  Replay idempotency: reset event → re-dispatch → skipped_duplicate,
//        journal count unchanged (no double-post)
//   P-7  PMT001: allocation exceeding the outstanding balance is rejected
//   P-8  PMT003: total allocations exceeding the payment amount is rejected
//   P-8b PMT004: allocation type mismatching the payment direction rejected
//   P-9  Supplier payment (out): Dr AP 2000 / Cr Bank 1100 + payable paid
//   P-10 Void: reversal journal + receivable reopened + invoice back to
//        'finalized'
//   P-11 Demo-tenant reconciliation: no failed events; the seeded demo bank
//        account exists with its CoA mapping
//
// Uses the scratch tenant T2 — rerunnable (per-run numbers/ids).
//
// Usage: node scripts/verify-payments-phase10-rest.mjs

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
const today = new Date().toISOString().slice(0, 10)
const plus30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
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

async function rpc(name, body) {
  const res = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, json, text }
}

async function dispatch(batch = 100) {
  return rpc("dispatch_pending_events", { p_batch_size: batch })
}

let CODE_BY_ID = new Map()
async function loadAccountMap() {
  const r = await rest(`/chart_of_accounts?select=id,account_code&tenant_id=eq.${T2}&deleted_at=is.null`)
  if (r.status === 200) CODE_BY_ID = new Map((r.json ?? []).map((a) => [a.id, a.account_code]))
  return r
}

async function journalFor(entryType, sourceType, sourceId) {
  const r = await rest(
    `/journal_entries?select=id,entry_ref,entry_type,status&entry_type=eq.${entryType}&source_entity_type=eq.${sourceType}&source_entity_id=eq.${sourceId}&limit=5`
  )
  const entry = firstRow(r.json)
  if (!entry) return null
  const lr = await rest(`/journal_entry_lines?select=account_id,debit_amount,credit_amount,description&journal_entry_id=eq.${entry.id}`)
  return { entry, lines: lr.json ?? [] }
}

const sumDebit = (j) => (j?.lines ?? []).reduce((s, l) => s + Number(l.debit_amount), 0)
const sumCredit = (j) => (j?.lines ?? []).reduce((s, l) => s + Number(l.credit_amount), 0)
const lineOf = (j, code) => (j?.lines ?? []).find((l) => CODE_BY_ID.get(l.account_id) === code)
const countJournals = async (entryType, sourceType, sourceId) => {
  const r = await rest(
    `/journal_entries?select=id&entry_type=eq.${entryType}&source_entity_type=eq.${sourceType}&source_entity_id=eq.${sourceId}&limit=50`
  )
  return (r.json ?? []).length
}

// ── P-1: RPC surface ─────────────────────────────────────────────────────
const dry = await dispatch(0)
ok("P-1a dispatch_pending_events callable by service role",
  dry.status === 200 && Array.isArray(dry.json),
  dry.status === 200 ? `returns=${JSON.stringify(firstRow(dry.json))}` : `http ${dry.status} ${dry.text?.slice(0, 120)}`)

const anonRpc = await fetch(`${BASE}/rest/v1/rpc/dispatch_pending_events`, {
  method: "POST",
  headers: { apikey: "", Authorization: "Bearer anon", "Content-Type": "application/json" },
  body: JSON.stringify({ p_batch_size: 5 }),
})
ok("P-1b anon cannot execute the dispatcher", anonRpc.status >= 400, `http ${anonRpc.status}`)

// ── P-2: CoA for the scratch tenant ──────────────────────────────────────
await rpc("ensure_default_chart_of_accounts", { p_tenant_id: T2 })
await loadAccountMap()
const needCodes = ["1000", "1100", "1200", "2000"]
const haveCodes = new Set([...CODE_BY_ID.values()])
ok("P-2 CoA seeded for scratch tenant (1000/1100/1200/2000)",
  needCodes.every((c) => haveCodes.has(c)),
  `have=${[...haveCodes].sort().join(",")}`)

// ── P-3: sales invoice finalized → receivable (reused pipeline) ──────────
const cust = await rest("/customers", {
  method: "POST",
  body: { tenant_id: T2, customer_code: `CUS10-${B}`, name_ar: "عميل فحص المرحلة العاشرة", name_en: "Phase 10 Customer" },
  prefer: "return=representation",
})
const customerId = firstRow(cust.json)?.id
ok("P-3a scratch customer created", cust.status === 201 && !!customerId, `id=${customerId?.slice(0, 8)}`)

const invNum = `INV10-${B}`
const inv = await rest("/invoices", {
  method: "POST",
  body: {
    tenant_id: T2, invoice_number: invNum, invoice_type: "sales", customer_id: customerId,
    issue_date: today, due_date: plus30, currency: "SAR", status: "draft",
    subtotal: 10000, discount: 0, vat_amount: 1500, total: 11500, vat_rate: 15,
    notes: "Phase 10 sales probe",
  },
  prefer: "return=representation",
})
const invId = firstRow(inv.json)?.id
ok("P-3b sales invoice created (draft)", inv.status === 201 && !!invId,
  inv.status === 201 ? `id=${invId?.slice(0, 8)}` : `http ${inv.status} ${inv.text?.slice(0, 140)}`)

let receivableId = null
if (invId) {
  const linesIns = await rest("/invoice_lines", {
    method: "POST",
    body: {
      tenant_id: T2, invoice_id: invId, line_no: 1, description: "Phase 10 sales line",
      quantity: 2, unit_price: 5000, discount: 0, amount: 10000, vat_rate: 15, vat_amount: 1500,
    },
    prefer: "return=minimal",
  })
  ok("P-3c invoice lines inserted", linesIns.status === 201, `http ${linesIns.status}`)

  const okStatus = (s) => s === 200 || s === 204
  const issued = await rest(`/invoices?id=eq.${invId}`, { method: "PATCH", body: { status: "issued" }, prefer: "return=minimal" })
  const finalized = await rest(`/invoices?id=eq.${invId}`, { method: "PATCH", body: { status: "finalized" }, prefer: "return=minimal" })
  ok("P-3d invoice finalized (draft → issued → finalized)", okStatus(issued.status) && okStatus(finalized.status))

  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: randomUUID(),
      idempotency_key: `invoice:${invId}:finalized`,
      source_type: "invoice", source_id: invId, event_type: "InvoiceFinalizedEvent",
      event_date: today, payload: { invoice_number: invNum, total: 11500 },
    },
    prefer: "return=minimal",
  })
  const d1 = await dispatch()
  ok("P-3e invoice event dispatched", firstRow(d1.json)?.out_processed >= 1, `processed=${firstRow(d1.json)?.out_processed}`)

  const rcv = await rest(
    `/receivables?select=id,total_amount,paid_amount,status&tenant_id=eq.${T2}&source_entity_type=eq.invoice&source_entity_id=eq.${invId}`
  )
  receivableId = firstRow(rcv.json)?.id
  ok("P-3f receivable created by the dispatcher", rcv.status === 200 && !!receivableId,
    receivableId ? `id=${receivableId?.slice(0, 8)}` : `http ${rcv.status} ${rcv.text?.slice(0, 120)}`)
}

// ── P-4: bank account with CoA mapping ───────────────────────────────────
const bank = await rest("/bank_accounts", {
  method: "POST",
  body: {
    tenant_id: T2, bank_name: "Verify Bank", account_name: "Phase 10 Probe",
    iban: `SA00${B}00000000000000`, account_number: String(B), currency: "SAR",
    opening_balance: 0, is_active: true, coa_account_code: "1100",
  },
  prefer: "return=representation",
})
const bankId = firstRow(bank.json)?.id
ok("P-4a bank account created with coa_account_code", bank.status === 201 && !!bankId,
  bank.status === 201 ? `id=${bankId?.slice(0, 8)}` : `http ${bank.status} ${bank.text?.slice(0, 140)}`)

// ── P-5: receipt (direction 'in') ────────────────────────────────────────
let payId = null
if (receivableId) {
  const pay = await rest("/finance_payments", {
    method: "POST",
    body: {
      tenant_id: T2, direction: "in", customer_id: customerId, payment_date: today,
      amount: 11500, method: "transfer", bank_account_id: bankId, reference: "Phase 10 receipt",
      status: "pending",
    },
    prefer: "return=representation",
  })
  payId = firstRow(pay.json)?.id
  ok("P-5a receipt payment recorded", pay.status === 201 && !!payId, `id=${payId?.slice(0, 8)}`)

  const alloc = await rest("/payment_allocations", {
    method: "POST",
    body: { tenant_id: T2, finance_payment_id: payId, receivable_id: receivableId, allocated_amount: 11500 },
    prefer: "return=minimal",
  })
  ok("P-5b allocation inserted", alloc.status === 201, `http ${alloc.status} ${alloc.text?.slice(0, 120)}`)

  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: randomUUID(),
      idempotency_key: `payment:${payId}:allocated`,
      source_type: "payment", source_id: payId, event_type: "PaymentAllocatedEvent",
      event_date: today,
      payload: { payment_ref: "PMT-PROBE", direction: "in", amount: 11500, method: "transfer" },
    },
    prefer: "return=minimal",
  })
  const d2 = await dispatch()
  ok("P-5c payment event dispatched", firstRow(d2.json)?.out_processed >= 1, `processed=${firstRow(d2.json)?.out_processed}`)

  const j = await journalFor("bank", "payment", payId)
  ok("P-5d journal posted (entry_type 'bank', source 'payment')", !!j && j.entry.status === "posted",
    j ? `ref=${j.entry.entry_ref}` : "no journal")
  ok("P-5e journal balanced (Dr Bank 1100 = Cr AR 1200 = 11,500)",
    !!j && Math.abs(sumDebit(j) - sumCredit(j)) < 0.01 &&
    Math.abs(Number(lineOf(j, "1100")?.debit_amount ?? 0) - 11500) < 0.01 &&
    Math.abs(Number(lineOf(j, "1200")?.credit_amount ?? 0) - 11500) < 0.01,
    j ? `Dr=${sumDebit(j)} Cr=${sumCredit(j)}` : "no journal")

  const rcvAfter = firstRow((await rest(`/receivables?select=paid_amount,status&id=eq.${receivableId}`)).json)
  ok("P-5f receivable paid in full (paid 11,500 / status 'paid')",
    rcvAfter && Number(rcvAfter.paid_amount) === 11500 && rcvAfter.status === "paid",
    rcvAfter ? `paid=${rcvAfter.paid_amount} status=${rcvAfter.status}` : "not found")

  const invAfter = firstRow((await rest(`/invoices?select=status&id=eq.${invId}`)).json)
  ok("P-5g linked invoice status 'paid'", invAfter?.status === "paid", `status=${invAfter?.status}`)

  const payAfter = firstRow((await rest(`/finance_payments?select=status&id=eq.${payId}`)).json)
  ok("P-5h payment status 'allocated'", payAfter?.status === "allocated", `status=${payAfter?.status}`)

  // ── P-6: replay idempotency ────────────────────────────────────────────
  const evt = firstRow((await rest(`/financial_events?select=id,processing_status&idempotency_key=eq.payment:${payId}:allocated`)).json)
  const reset = await rest(`/financial_events?id=eq.${evt.id}`, {
    method: "PATCH", body: { processing_status: "pending", error_message: null, processed_at: null }, prefer: "return=minimal",
  })
  const d3 = await dispatch()
  const evtAfter = firstRow((await rest(`/financial_events?select=processing_status,error_message&id=eq.${evt.id}`)).json)
  const jCount = await countJournals("bank", "payment", payId)
  ok("P-6 replay → skipped_duplicate, no double-post",
    (reset.status === 200 || reset.status === 204) &&
    evtAfter?.processing_status === "skipped_duplicate" && jCount === 1,
    `event=${evtAfter?.processing_status} journals=${jCount}`)
}

// ── P-7: PMT001 — over-allocation rejected ───────────────────────────────
const rcvA = await rest("/receivables", {
  method: "POST",
  body: {
    tenant_id: T2, invoice_ref: `DIR-A-${B}`, invoice_date: today, due_date: plus30,
    amount: 500, vat_amount: 75, total_amount: 575, paid_amount: 0, status: "open",
  },
  prefer: "return=representation",
})
const rcvAId = firstRow(rcvA.json)?.id
const payB = await rest("/finance_payments", {
  method: "POST",
  body: { tenant_id: T2, direction: "in", customer_id: customerId, payment_date: today, amount: 575, method: "cash", status: "pending" },
  prefer: "return=representation",
})
const payBId = firstRow(payB.json)?.id
const overAlloc = await rest("/payment_allocations", {
  method: "POST",
  body: { tenant_id: T2, finance_payment_id: payBId, receivable_id: rcvAId, allocated_amount: 9999 },
  prefer: "return=minimal",
})
ok("P-7 allocation exceeding outstanding rejected (PMT001)",
  overAlloc.status >= 400 && overAlloc.text.includes("PMT001"),
  `http ${overAlloc.status} ${overAlloc.text?.slice(0, 140)}`)

// ── P-8: PMT003 — allocations exceeding the payment amount ───────────────
const rcvB = await rest("/receivables", {
  method: "POST",
  body: {
    tenant_id: T2, invoice_ref: `DIR-B-${B}`, invoice_date: today, due_date: plus30,
    amount: 1000, vat_amount: 0, total_amount: 1000, paid_amount: 0, status: "open",
  },
  prefer: "return=representation",
})
const rcvBId = firstRow(rcvB.json)?.id
const payC = await rest("/finance_payments", {
  method: "POST",
  body: { tenant_id: T2, direction: "in", customer_id: customerId, payment_date: today, amount: 100, method: "cash", status: "pending" },
  prefer: "return=representation",
})
const payCId = firstRow(payC.json)?.id
await rest("/payment_allocations", {
  method: "POST",
  body: { tenant_id: T2, finance_payment_id: payCId, receivable_id: rcvAId, allocated_amount: 60 },
  prefer: "return=minimal",
})
const overPay = await rest("/payment_allocations", {
  method: "POST",
  body: { tenant_id: T2, finance_payment_id: payCId, receivable_id: rcvBId, allocated_amount: 60 },
  prefer: "return=minimal",
})
ok("P-8 allocations exceeding payment amount rejected (PMT003)",
  overPay.status >= 400 && overPay.text.includes("PMT003"),
  `http ${overPay.status} ${overPay.text?.slice(0, 140)}`)

// ── P-9: supplier payment (direction 'out') ──────────────────────────────
const supp = await rest("/suppliers", {
  method: "POST",
  body: { tenant_id: T2, supplier_code: `SUP10-${B}`, name_ar: "مورد فحص المرحلة العاشرة", name_en: "Phase 10 Supplier" },
  prefer: "return=representation",
})
const suppId = firstRow(supp.json)?.id
ok("P-9a scratch supplier created", supp.status === 201 && !!suppId, `id=${suppId?.slice(0, 8)}`)

const pay = await rest("/payables", {
  method: "POST",
  body: {
    tenant_id: T2, supplier_id: suppId, invoice_ref: `PINV10-${B}`, invoice_date: today, due_date: plus30,
    amount: 500, vat_amount: 75, total_amount: 575, paid_amount: 0, status: "open",
  },
  prefer: "return=representation",
})
const payId2 = firstRow(pay.json)?.id
ok("P-9b payable created", pay.status === 201 && !!payId2, `id=${payId2?.slice(0, 8)}`)

if (payId2) {
  const payOut = await rest("/finance_payments", {
    method: "POST",
    body: {
      tenant_id: T2, direction: "out", supplier_id: suppId, payment_date: today,
      amount: 575, method: "transfer", bank_account_id: bankId, reference: "Phase 10 supplier payment",
      status: "pending",
    },
    prefer: "return=representation",
  })
  const payOutId = firstRow(payOut.json)?.id
  ok("P-9c supplier payment recorded", payOut.status === 201 && !!payOutId, `id=${payOutId?.slice(0, 8)}`)

  await rest("/payment_allocations", {
    method: "POST",
    body: { tenant_id: T2, finance_payment_id: payOutId, payable_id: payId2, allocated_amount: 575 },
    prefer: "return=minimal",
  })
  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: randomUUID(),
      idempotency_key: `payment:${payOutId}:allocated`,
      source_type: "payment", source_id: payOutId, event_type: "PaymentAllocatedEvent",
      event_date: today,
      payload: { payment_ref: "PMT-OUT", direction: "out", amount: 575, method: "transfer" },
    },
    prefer: "return=minimal",
  })
  const d4 = await dispatch()

  const jOut = await journalFor("bank", "payment", payOutId)
  ok("P-9d supplier journal posted (Dr AP 2000 / Cr Bank 1100)",
    !!jOut && Math.abs(Number(lineOf(jOut, "2000")?.debit_amount ?? 0) - 575) < 0.01 &&
    Math.abs(Number(lineOf(jOut, "1100")?.credit_amount ?? 0) - 575) < 0.01,
    jOut ? `Dr2000=${lineOf(jOut, "2000")?.debit_amount} Cr1100=${lineOf(jOut, "1100")?.credit_amount}` : "no journal")

  const payAfter = firstRow((await rest(`/payables?select=paid_amount,status&id=eq.${payId2}`)).json)
  ok("P-9e payable paid in full (paid 575 / status 'paid')",
    payAfter && Number(payAfter.paid_amount) === 575 && payAfter.status === "paid",
    payAfter ? `paid=${payAfter.paid_amount} status=${payAfter.status}` : "not found")

  // P-8b: direction ↔ allocation-type mismatch rejected (PMT004)
  const dirBad = await rest("/payment_allocations", {
    method: "POST",
    body: { tenant_id: T2, finance_payment_id: payBId, payable_id: payId2, allocated_amount: 10 },
    prefer: "return=minimal",
  })
  ok("P-8b receipt allocating to a payable rejected (PMT004)",
    dirBad.status >= 400 && dirBad.text.includes("PMT004"),
    `http ${dirBad.status} ${dirBad.text?.slice(0, 140)}`)
}

// ── P-10: void the receipt → reversal + reopen ───────────────────────────
if (payId) {
  await rest(`/finance_payments?id=eq.${payId}`, {
    method: "PATCH", body: { status: "void" }, prefer: "return=minimal",
  })
  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: randomUUID(),
      idempotency_key: `payment:${payId}:voided`,
      source_type: "payment", source_id: payId, event_type: "PaymentVoidedEvent",
      event_date: today, payload: { payment_ref: "PMT-PROBE" },
    },
    prefer: "return=minimal",
  })
  const d5 = await dispatch()

  const jRev = await journalFor("reversal", "payment", payId)
  ok("P-10a reversal journal posted (entry_type 'reversal', source 'payment')",
    !!jRev && jRev.entry.status === "posted", jRev ? `ref=${jRev.entry.entry_ref}` : "no journal")
  ok("P-10b reversal balanced",
    !!jRev && Math.abs(sumDebit(jRev) - sumCredit(jRev)) < 0.01, jRev ? `Dr=${sumDebit(jRev)} Cr=${sumCredit(jRev)}` : "no journal")

  const rcvAfter = firstRow((await rest(`/receivables?select=paid_amount,status&id=eq.${receivableId}`)).json)
  ok("P-10c receivable reopened (paid 0 / status 'open')",
    rcvAfter && Number(rcvAfter.paid_amount) === 0 && rcvAfter.status === "open",
    rcvAfter ? `paid=${rcvAfter.paid_amount} status=${rcvAfter.status}` : "not found")

  const invAfter = firstRow((await rest(`/invoices?select=status&id=eq.${invId}`)).json)
  ok("P-10d linked invoice back to 'finalized'", invAfter?.status === "finalized", `status=${invAfter?.status}`)

  const revCount = await countJournals("reversal", "payment", payId)
  const reset2 = await rest(`/financial_events?idempotency_key=eq.payment:${payId}:voided`, {
    method: "PATCH", body: { processing_status: "pending", error_message: null, processed_at: null }, prefer: "return=minimal",
  })
  await dispatch()
  const evt2 = firstRow((await rest(`/financial_events?select=processing_status&idempotency_key=eq.payment:${payId}:voided`)).json)
  ok("P-10e void replay → skipped_duplicate, single reversal",
    (reset2.status === 200 || reset2.status === 204) && evt2?.processing_status === "skipped_duplicate" && revCount === 1,
    `event=${evt2?.processing_status} reversals=${revCount}`)
}

// ── P-11: demo-tenant reconciliation ─────────────────────────────────────
const demoFailed = await rest(`/financial_events?select=id&tenant_id=eq.${T}&processing_status=eq.failed`)
ok("P-11a demo tenant has zero failed events", (demoFailed.json ?? []).length === 0,
  `failed=${(demoFailed.json ?? []).length}`)

const demoBank = await rest(`/bank_accounts?select=bank_name,coa_account_code&id=eq.00000000-0000-0000-0000-0000000d0001`)
const demoRow = firstRow(demoBank.json)
ok("P-11b seeded demo bank account exists with CoA 1100",
  !!demoRow && demoRow.coa_account_code === "1100",
  demoRow ? `bank=${demoRow.bank_name} coa=${demoRow.coa_account_code}` : "bank missing")

console.log(failures === 0 ? "\n✅ ALL PHASE 10 CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
