// scripts/verify-event-dispatcher-phase9-rest.mjs
// Phase 9 (Event Dispatcher) verification against the LIVE Supabase project.
//
//   P-1  RPC surface: dispatch_pending_events callable by service role;
//        anon denied
//   P-2  Chart of Accounts seeded for the scratch tenant (dispatcher needs
//        1200/2000/2500/2600/4000/5800)
//   P-3  Sales invoice finalized → journal Dr AR / Cr Revenue / Cr VAT Out
//        (balanced, per-account amounts) + vat_output_ledger + receivables
//   P-4  Replay idempotency: reset the event to pending → re-dispatch →
//        skipped_duplicate, journal count unchanged (no double-post)
//   P-5  Purchase invoice approved → journal Dr 5800 + Dr 2600 / Cr 2000 +
//        vat_input_ledger (recoverable)
//   P-6  Expense approved (CoA 5000, recoverable) → journal + classified
//        vat_input_ledger
//   P-7  Credit note → reversal journal + vat_adjustments (output −) +
//        reference receivable reduced to zero
//   P-8  Cancelled sales invoice → reversal journal + vat_adjustments +
//        receivable voided
//   P-9  Demo-tenant reconciliation: no failed events after the run; the
//        038 seed event for INV-2026-000001 was consumed (replay-safe)
//
// Uses the scratch tenant T2 — rerunnable (per-run numbers/ids).
//
// Usage: node scripts/verify-event-dispatcher-phase9-rest.mjs

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
const today = new Date().toISOString().slice(0, 10)
const Y = new Date().getFullYear()
const M = new Date().getMonth() + 1
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

// Draft → issued → finalized (invoice_lines are immutable once finalized,
// so lines must be written while the invoice is still a draft — INV003).
async function finalizeInvoice(id) {
  // PostgREST PATCH with return=minimal responds 204 on success.
  const ok = (s) => s === 200 || s === 204
  const a = await rest(`/invoices?id=eq.${id}`, { method: "PATCH", body: { status: "issued" }, prefer: "return=minimal" })
  const b = await rest(`/invoices?id=eq.${id}`, { method: "PATCH", body: { status: "finalized" }, prefer: "return=minimal" })
  return ok(a.status) && ok(b.status)
}

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

// Fetch the CoA code map for the scratch tenant.
let CODE_BY_ID = new Map()
async function loadAccountMap() {
  const r = await rest(`/chart_of_accounts?select=id,account_code&tenant_id=eq.${T2}&deleted_at=is.null`)
  if (r.status === 200) {
    CODE_BY_ID = new Map((r.json ?? []).map((a) => [a.id, a.account_code]))
  }
  return r
}

// Fetch the journal entry (if any) for a source, with its lines.
async function journalFor(sourceType, sourceId) {
  const r = await rest(
    `/journal_entries?select=id,entry_ref,entry_type,status&source_entity_type=eq.${sourceType}&source_entity_id=eq.${sourceId}&limit=5`
  )
  const entry = firstRow(r.json)
  if (!entry) return null
  const lr = await rest(`/journal_entry_lines?select=account_id,debit_amount,credit_amount,description&journal_entry_id=eq.${entry.id}`)
  return { entry, lines: lr.json ?? [] }
}

const sumDebit = (j) => (j?.lines ?? []).reduce((s, l) => s + Number(l.debit_amount), 0)
const sumCredit = (j) => (j?.lines ?? []).reduce((s, l) => s + Number(l.credit_amount), 0)
const lineOf = (j, code) => (j?.lines ?? []).find((l) => CODE_BY_ID.get(l.account_id) === code)

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
ok("P-1b anon cannot execute the dispatcher",
  anonRpc.status >= 400,
  `http ${anonRpc.status}`)

// ── P-2: CoA for the scratch tenant ──────────────────────────────────────
const coaSeed = await rpc("ensure_default_chart_of_accounts", { p_tenant_id: T2 })
await loadAccountMap()
const needCodes = ["1200", "2000", "2500", "2600", "4000", "5000", "5800"]
const haveCodes = new Set([...CODE_BY_ID.values()])
ok("P-2 CoA seeded for scratch tenant (1200/2000/2500/2600/4000/5000/5800)",
  needCodes.every((c) => haveCodes.has(c)),
  `have=${[...haveCodes].sort().join(",")}`)

// ── P-3: sales invoice finalization ──────────────────────────────────────
const cust = await rest("/customers", {
  method: "POST",
  body: { tenant_id: T2, customer_code: `CUS9-${B}`, name_ar: "عميل فحص المرحلة التاسعة", name_en: "Phase 9 Customer" },
  prefer: "return=representation",
})
const customerId = firstRow(cust.json)?.id
ok("P-3a scratch customer created", cust.status === 201 && !!customerId, `id=${customerId?.slice(0, 8)}`)

const invNum = `INV9-${B}`
const inv = await rest("/invoices", {
  method: "POST",
  body: {
    tenant_id: T2, invoice_number: invNum, invoice_type: "sales", customer_id: customerId,
    issue_date: today, due_date: today, currency: "SAR", status: "draft",
    subtotal: 1000, discount: 0, vat_amount: 150, total: 1150, vat_rate: 15,
    notes: "Phase 9 sales probe",
  },
  prefer: "return=representation",
})
const invId = firstRow(inv.json)?.id
ok("P-3b sales invoice created (draft)", inv.status === 201 && !!invId,
  inv.status === 201 ? `id=${invId?.slice(0, 8)}` : `http ${inv.status} ${inv.text?.slice(0, 140)}`)

if (invId) {
  const linesIns = await rest("/invoice_lines", {
    method: "POST",
    body: {
      tenant_id: T2, invoice_id: invId, line_no: 1, description: "Phase 9 sales line",
      quantity: 2, unit_price: 500, discount: 0, amount: 1000, vat_rate: 15, vat_amount: 150,
    },
    prefer: "return=minimal",
  })
  ok("P-3c invoice lines inserted", linesIns.status === 201, `http ${linesIns.status}`)

  ok("P-3c2 invoice finalized (draft → issued → finalized)", await finalizeInvoice(invId))

  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: crypto.randomUUID(),
      idempotency_key: `invoice:${invId}:finalized`,
      source_type: "invoice", source_id: invId,
      event_type: "InvoiceFinalizedEvent", event_date: today,
      payload: {
        invoice_number: invNum, customer_id: customerId,
        subtotal: 1000, discount: 0, vat_amount: 150, total: 1150,
        currency: "SAR", period_year: Y, period_month: M,
      },
    },
    prefer: "return=minimal",
  })

  const d1 = await dispatch()
  const ev1 = await rest(`/financial_events?select=id,processing_status,error_message&idempotency_key=eq.invoice%3A${invId}%3Afinalized`)
  ok("P-3d sales finalized event processed",
    firstRow(ev1.json)?.processing_status === "processed",
    `status=${firstRow(ev1.json)?.processing_status}${firstRow(ev1.json)?.error_message ? ` err=${firstRow(ev1.json).error_message}` : ""}`)

  const j1 = await journalFor("invoice", invId)
  ok("P-3e sales journal posted + balanced",
    !!j1 && j1.entry.entry_type === "invoice" && j1.entry.status === "posted"
      && Math.abs(sumDebit(j1) - sumCredit(j1)) < 0.001 && sumDebit(j1) === 1150,
    j1 ? `ref=${j1.entry.entry_ref} Dr=${sumDebit(j1)} Cr=${sumCredit(j1)} lines=${j1.lines.length}` : "no journal")
  ok("P-3f sales journal lines: Dr AR 1150 / Cr Revenue 1000 / Cr VAT Out 150",
    !!j1
      && Number(lineOf(j1, "1200")?.debit_amount) === 1150
      && Number(lineOf(j1, "4000")?.credit_amount) === 1000
      && Number(lineOf(j1, "2500")?.credit_amount) === 150,
    j1 ? j1.lines.map((l) => `${CODE_BY_ID.get(l.account_id)}:${l.debit_amount}/${l.credit_amount}`).join(" ") : "no journal")

  const vatOut = await rest(`/vat_output_ledger?select=vat_base_amount,vat_rate,vat_amount,invoice_ref&source_entity_type=eq.invoice&source_entity_id=eq.${invId}`)
  ok("P-3g vat_output_ledger row written",
    firstRow(vatOut.json)?.vat_amount === 150 && Number(firstRow(vatOut.json)?.vat_base_amount) === 1000,
    `base=${firstRow(vatOut.json)?.vat_base_amount} vat=${firstRow(vatOut.json)?.vat_amount} ref=${firstRow(vatOut.json)?.invoice_ref}`)

  const ar = await rest(`/receivables?select=amount,vat_amount,total_amount,status&source_entity_type=eq.invoice&source_entity_id=eq.${invId}`)
  ok("P-3h receivable created for the invoice",
    Number(firstRow(ar.json)?.total_amount) === 1150 && firstRow(ar.json)?.status === "open",
    `total=${firstRow(ar.json)?.total_amount} status=${firstRow(ar.json)?.status}`)

  // ── P-4: replay idempotency ───────────────────────────────────────────
  const before = await journalFor("invoice", invId)
  await rest(`/financial_events?id=eq.${firstRow(ev1.json)?.id}`, {
    method: "PATCH", body: { processing_status: "pending", error_message: null }, prefer: "return=minimal",
  })
  const d2 = await dispatch()
  const ev1b = await rest(`/financial_events?select=id,processing_status&idempotency_key=eq.invoice%3A${invId}%3Afinalized`)
  const after = await journalFor("invoice", invId)
  ok("P-4a replayed event marked skipped_duplicate",
    firstRow(ev1b.json)?.processing_status === "skipped_duplicate",
    `status=${firstRow(ev1b.json)?.processing_status}`)
  ok("P-4b replay did NOT double-post the journal",
    (before?.entry?.id === after?.entry?.id) && (before?.lines?.length === after?.lines?.length),
    `same entry=${before?.entry?.id === after?.entry?.id} lines=${after?.lines?.length}`)

  // ── P-7: credit note reverses the sale ────────────────────────────────
  const cnNum = `CN9-${B}`
  const cn = await rest("/credit_notes", {
    method: "POST",
    body: {
      tenant_id: T2, credit_note_number: cnNum, reference_invoice_id: invId, customer_id: customerId,
      issue_date: today, currency: "SAR", status: "finalized",
      subtotal: 1000, discount: 0, vat_amount: 150, total: 1150, vat_rate: 15,
      reason: "Phase 9 credit probe", lines: [],
    },
    prefer: "return=representation",
  })
  const cnId = firstRow(cn.json)?.id
  ok("P-7a credit note created", cn.status === 201 && !!cnId, `id=${cnId?.slice(0, 8)}`)

  if (cnId) {
    await rest("/financial_events", {
      method: "POST",
      body: {
        tenant_id: T2, event_id: crypto.randomUUID(),
        idempotency_key: `credit_note:${cnId}:issued`,
        source_type: "credit_note", source_id: cnId,
        event_type: "CreditNoteIssuedEvent", event_date: today,
        payload: { credit_note_number: cnNum, reference_invoice_id: invId, subtotal: 1000, vat_amount: 150, total: 1150, reason: "Phase 9 credit probe" },
      },
      prefer: "return=minimal",
    })
    await dispatch()

    const jcn = await journalFor("credit_note", cnId)
    ok("P-7b credit-note reversal journal posted + balanced",
      !!jcn && jcn.entry.entry_type === "reversal" && Math.abs(sumDebit(jcn) - sumCredit(jcn)) < 0.001 && sumDebit(jcn) === 1150,
      jcn ? `ref=${jcn.entry.entry_ref} Dr=${sumDebit(jcn)} Cr=${sumCredit(jcn)}` : "no journal")
    ok("P-7c reversal lines: Cr AR 1150 / Dr Revenue 1000 / Dr VAT Out 150",
      !!jcn
        && Number(lineOf(jcn, "1200")?.credit_amount) === 1150
        && Number(lineOf(jcn, "4000")?.debit_amount) === 1000
        && Number(lineOf(jcn, "2500")?.debit_amount) === 150,
      jcn ? jcn.lines.map((l) => `${CODE_BY_ID.get(l.account_id)}:${l.debit_amount}/${l.credit_amount}`).join(" ") : "no journal")

    const adj = await rest(`/vat_adjustments?select=direction,base_amount,vat_amount,status&source_entity_type=eq.credit_note&source_entity_id=eq.${cnId}`)
    ok("P-7d vat_adjustments output −150 recorded",
      firstRow(adj.json)?.direction === "output" && Number(firstRow(adj.json)?.vat_amount) === -150
        && firstRow(adj.json)?.status === "finalized",
      `dir=${firstRow(adj.json)?.direction} vat=${firstRow(adj.json)?.vat_amount} status=${firstRow(adj.json)?.status}`)

    const arAfterCn = await rest(`/receivables?select=total_amount&source_entity_type=eq.invoice&source_entity_id=eq.${invId}`)
    ok("P-7e reference receivable reduced to zero",
      Number(firstRow(arAfterCn.json)?.total_amount) === 0,
      `total=${firstRow(arAfterCn.json)?.total_amount}`)
  }
}

// ── P-5: purchase invoice approval ────────────────────────────────────────
const sup = await rest("/suppliers", {
  method: "POST",
  body: { tenant_id: T2, supplier_code: `SUP9-${B}`, name_ar: "مورد فحص المرحلة التاسعة", name_en: "Phase 9 Supplier" },
  prefer: "return=representation",
})
const supplierId = firstRow(sup.json)?.id
ok("P-5a scratch supplier created", sup.status === 201 && !!supplierId, `id=${supplierId?.slice(0, 8)}`)

const pinvNum = `PINV9-${B}`
const pinv = await rest("/invoices", {
  method: "POST",
  body: {
    tenant_id: T2, invoice_number: pinvNum, invoice_type: "purchase", supplier_id: supplierId,
    issue_date: today, due_date: today, currency: "SAR", status: "finalized",
    subtotal: 800, discount: 0, vat_amount: 120, total: 920, vat_rate: 15,
    notes: "Phase 9 purchase probe",
  },
  prefer: "return=representation",
})
const pinvId = firstRow(pinv.json)?.id
ok("P-5b purchase invoice created (finalized)", pinv.status === 201 && !!pinvId,
  pinv.status === 201 ? `id=${pinvId?.slice(0, 8)}` : `http ${pinv.status} ${pinv.text?.slice(0, 140)}`)

if (pinvId) {
  await rest("/payables", {
    method: "POST",
    body: {
      tenant_id: T2, supplier_id: supplierId, invoice_ref: pinvNum, invoice_date: today, due_date: today,
      amount: 800, vat_amount: 120, total_amount: 920, paid_amount: 0, status: "open",
      source_entity_type: "purchase_invoice", source_entity_id: pinvId,
      notes: "Phase 9 purchase payable", created_by: null,
    },
    prefer: "return=minimal",
  })
  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: crypto.randomUUID(),
      idempotency_key: `purchase_invoice:${pinvId}:approved`,
      source_type: "purchase_invoice", source_id: pinvId,
      event_type: "PurchaseInvoiceApprovedEvent", event_date: today,
      payload: { supplier_id: supplierId, invoice_ref: pinvNum, subtotal: 800, vat_amount: 120, total: 920, currency: "SAR", period_year: Y, period_month: M },
    },
    prefer: "return=minimal",
  })
  await dispatch()

  const jp = await journalFor("purchase_invoice", pinvId)
  ok("P-5c purchase journal posted + balanced",
    !!jp && jp.entry.entry_type === "expense" && Math.abs(sumDebit(jp) - sumCredit(jp)) < 0.001 && sumDebit(jp) === 920,
    jp ? `ref=${jp.entry.entry_ref} Dr=${sumDebit(jp)} Cr=${sumCredit(jp)}` : "no journal")
  ok("P-5d purchase lines: Dr 5800 800 / Dr 2600 120 / Cr 2000 920",
    !!jp
      && Number(lineOf(jp, "5800")?.debit_amount) === 800
      && Number(lineOf(jp, "2600")?.debit_amount) === 120
      && Number(lineOf(jp, "2000")?.credit_amount) === 920,
    jp ? jp.lines.map((l) => `${CODE_BY_ID.get(l.account_id)}:${l.debit_amount}/${l.credit_amount}`).join(" ") : "no journal")

  const vatIn = await rest(`/vat_input_ledger?select=vat_base_amount,vat_amount,vat_recoverability&source_entity_type=eq.purchase_invoice&source_entity_id=eq.${pinvId}`)
  ok("P-5e vat_input_ledger row (recoverable) written",
    Number(firstRow(vatIn.json)?.vat_amount) === 120 && firstRow(vatIn.json)?.vat_recoverability === "recoverable",
    `vat=${firstRow(vatIn.json)?.vat_amount} rec=${firstRow(vatIn.json)?.vat_recoverability}`)
}

// ── P-6: expense approval (CoA 5000, recoverable) ────────────────────────
const exp = await rest("/expenses", {
  method: "POST",
  body: {
    tenant_id: T2, expense_type: "fuel", category: "Fuel", amount: 600, currency: "SAR",
    expense_date: today, description: "Phase 9 fuel probe",
    vat_rate: 15, vat_amount: 90, vat_recoverability: "recoverable", coa_account_code: "5000",
    is_approved: true,
  },
  prefer: "return=representation",
})
const expId = firstRow(exp.json)?.id
const expCode = firstRow(exp.json)?.expense_code ?? `EXP-${expId?.slice(0, 8).toUpperCase()}`
ok("P-6a expense created (approved)", exp.status === 201 && !!expId,
  exp.status === 201 ? `id=${expId?.slice(0, 8)} code=${expCode}` : `http ${exp.status} ${exp.text?.slice(0, 140)}`)

if (expId) {
  await rest("/payables", {
    method: "POST",
    body: {
      tenant_id: T2, supplier_id: null, invoice_ref: expCode, invoice_date: today, due_date: today,
      amount: 600, vat_amount: 90, total_amount: 690, paid_amount: 0, status: "open",
      source_entity_type: "expense", source_entity_id: expId, notes: "Phase 9 expense payable",
    },
    prefer: "return=minimal",
  })
  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: crypto.randomUUID(),
      idempotency_key: `expense:${expId}:approved`,
      source_type: "expense", source_id: expId,
      event_type: "ExpenseApprovedEvent", event_date: today,
      payload: { expense_id: expId, expense_code: expCode, expense_type: "fuel", category: "Fuel", amount: 600, vat_amount: 90, vat_rate: 15, vat_recoverability: "recoverable", coa_account_code: "5000" },
    },
    prefer: "return=minimal",
  })
  await dispatch()

  const je = await journalFor("expense", expId)
  ok("P-6b expense journal posted + balanced",
    !!je && je.entry.entry_type === "expense" && Math.abs(sumDebit(je) - sumCredit(je)) < 0.001 && sumDebit(je) === 690,
    je ? `ref=${je.entry.entry_ref} Dr=${sumDebit(je)} Cr=${sumCredit(je)}` : "no journal")
  ok("P-6c expense lines: Dr 5000 600 / Dr 2600 90 / Cr 2000 690 (CoA mapping respected)",
    !!je
      && Number(lineOf(je, "5000")?.debit_amount) === 600
      && Number(lineOf(je, "2600")?.debit_amount) === 90
      && Number(lineOf(je, "2000")?.credit_amount) === 690,
    je ? je.lines.map((l) => `${CODE_BY_ID.get(l.account_id)}:${l.debit_amount}/${l.credit_amount}`).join(" ") : "no journal")

  const vatInExp = await rest(`/vat_input_ledger?select=vat_base_amount,vat_amount,vat_recoverability,invoice_ref&source_entity_type=eq.expense&source_entity_id=eq.${expId}`)
  ok("P-6d classified vat_input_ledger row written",
    Number(firstRow(vatInExp.json)?.vat_amount) === 90 && firstRow(vatInExp.json)?.vat_recoverability === "recoverable",
    `vat=${firstRow(vatInExp.json)?.vat_amount} rec=${firstRow(vatInExp.json)?.vat_recoverability} ref=${firstRow(vatInExp.json)?.invoice_ref}`)
}

// ── P-8: cancelled sales invoice reverses the effect ──────────────────────
const inv2Num = `INV9-${B}-C`
const inv2 = await rest("/invoices", {
  method: "POST",
  body: {
    tenant_id: T2, invoice_number: inv2Num, invoice_type: "sales", customer_id: customerId,
    issue_date: today, due_date: today, currency: "SAR", status: "finalized",
    subtotal: 500, discount: 0, vat_amount: 75, total: 575, vat_rate: 15,
    notes: "Phase 9 cancel probe",
  },
  prefer: "return=representation",
})
const inv2Id = firstRow(inv2.json)?.id
ok("P-8a second sales invoice created", inv2.status === 201 && !!inv2Id, `id=${inv2Id?.slice(0, 8)}`)

if (inv2Id) {
  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: crypto.randomUUID(),
      idempotency_key: `invoice:${inv2Id}:finalized`,
      source_type: "invoice", source_id: inv2Id,
      event_type: "InvoiceFinalizedEvent", event_date: today,
      payload: { invoice_number: inv2Num, customer_id: customerId, subtotal: 500, vat_amount: 75, total: 575, currency: "SAR", period_year: Y, period_month: M },
    },
    prefer: "return=minimal",
  })
  await dispatch()
  const jPre = await journalFor("invoice", inv2Id)
  ok("P-8b finalized effect dispatched first",
    !!jPre && jPre.entry.entry_type === "invoice",
    jPre ? `ref=${jPre.entry.entry_ref}` : "no journal")

  await rest("/financial_events", {
    method: "POST",
    body: {
      tenant_id: T2, event_id: crypto.randomUUID(),
      idempotency_key: `invoice:${inv2Id}:cancelled`,
      source_type: "invoice", source_id: inv2Id,
      event_type: "InvoiceCancelledEvent", event_date: today,
      payload: { invoice_number: inv2Num, cancel_reason: "Phase 9 cancel probe" },
    },
    prefer: "return=minimal",
  })
  await dispatch()

  const jc = await journalFor("invoice", inv2Id)
  const jRev = await rest(`/journal_entries?select=id,entry_type&source_entity_type=eq.invoice&source_entity_id=eq.${inv2Id}&entry_type=eq.reversal`)
  ok("P-8c cancellation reversal journal posted",
    !!firstRow(jRev.json),
    firstRow(jRev.json) ? `id=${firstRow(jRev.json).id?.slice(0, 8)}` : "no reversal journal")

  const adjC = await rest(`/vat_adjustments?select=direction,vat_amount&source_entity_type=eq.invoice&source_entity_id=eq.${inv2Id}`)
  ok("P-8d cancellation vat_adjustments output −75 recorded",
    firstRow(adjC.json)?.direction === "output" && Number(firstRow(adjC.json)?.vat_amount) === -75,
    `dir=${firstRow(adjC.json)?.direction} vat=${firstRow(adjC.json)?.vat_amount}`)

  const arVoid = await rest(`/receivables?select=deleted_at&source_entity_type=eq.invoice&source_entity_id=eq.${inv2Id}`)
  ok("P-8e cancelled invoice receivable voided",
    firstRow(arVoid.json)?.deleted_at != null,
    `deleted_at=${firstRow(arVoid.json)?.deleted_at}`)

  // Sanity: exactly two entries for the invoice (finalize + reversal).
  const allJ = await rest(`/journal_entries?select=id,entry_type&source_entity_type=eq.invoice&source_entity_id=eq.${inv2Id}`)
  const types = (allJ.json ?? []).map((e) => e.entry_type).sort()
  ok("P-8f exactly two entries (invoice + reversal) for the cancelled invoice",
    types.length === 2 && types[0] === "invoice" && types[1] === "reversal",
    `types=${JSON.stringify(types)}`)
}

// ── P-9: demo-tenant reconciliation (replay-safe consumption) ────────────
const failedDemo = await rest(`/financial_events?select=id,idempotency_key,error_message&tenant_id=eq.${T}&processing_status=eq.failed`)
ok("P-9a no demo-tenant events failed after dispatch",
  (failedDemo.json ?? []).length === 0,
  (failedDemo.json ?? []).length === 0
    ? "0 failed"
    : `${failedDemo.json.length} failed: ${failedDemo.json.map((e) => `${e.idempotency_key}:${e.error_message}`).join(" | ").slice(0, 220)}`)

const seedInv = await rest(`/invoices?select=id&invoice_number=eq.INV-2026-000001&tenant_id=eq.${T}`)
const seedInvId = firstRow(seedInv.json)?.id
if (seedInvId) {
  const seedJournals = await rest(`/journal_entries?select=id,entry_type&source_entity_type=eq.invoice&source_entity_id=eq.${seedInvId}`)
  ok("P-9b seed invoice INV-2026-000001 was consumed (journal exists)",
    (seedJournals.json ?? []).length >= 1,
    `entries=${(seedJournals.json ?? []).length}`)
} else {
  ok("P-9b seed invoice INV-2026-000001 exists", false, "not found")
}

// ── Final statuses (informational) ────────────────────────────────────────
const statusCounts = await rest(`/financial_events?select=processing_status&tenant_id=eq.${T}`)
const counts = {}
for (const r of statusCounts.json ?? []) counts[r.processing_status] = (counts[r.processing_status] ?? 0) + 1
console.log(`   demo-tenant event statuses: ${JSON.stringify(counts)}`)

console.log(failures === 0 ? "\n✅ ALL PHASE 9 CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
