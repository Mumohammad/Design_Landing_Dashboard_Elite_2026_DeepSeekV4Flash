// scripts/verify-journal-phase3-rest.mjs
// Phase 3 verification against the LIVE Supabase project, using the same
// service-role path the app uses (admin.rpc / admin.from). Covers:
//
//   REV-1    reversal of a posted entry → negated linked entry, original
//            marked 'reversed' with reversed_entry_id
//   REV-2    reversal lines exactly mirror the original (debit↔credit swap)
//   REV-3    reversing a draft → JRN012
//   REV-4    reversing an already-reversed entry → JRN011
//   APPR-1   draft (unbalanced OK) → submit → approve → posted
//   APPR-2   approve without submit → JRN013
//   APPR-3   approve an unbalanced draft → JRN004
//   APPR-4   reject a submitted entry → back to editable draft
//   PER-1    close period with pending drafts → ACC004
//   PER-2    close an open period → closed
//   PER-3    reopen requires reason → ACC006; reopen with reason → reopened
//   PER-4    posting into a closed period → ACC001
//   PER-5    closing an already-closed period → ACC005
//
// Uses the scratch tenant T2 (created by verify-coa-phase2-rest.mjs) plus a
// run-unique month for period tests. Re-runnable: run-unique codes/dates.
//
// Usage: node scripts/verify-journal-phase3-rest.mjs

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

const T2 = "00000000-0000-0000-0000-0000000c0a2a" // scratch tenant (from Phase 2 verify)
const RUN = Date.now()
let failures = 0

// Ensure the scratch tenant exists (idempotent).
await apiPost("/tenants", {
  id: T2, name_ar: "منشأة فحص المرحلة الثانية", name_en: "Phase 2 Verify Tenant",
  country: "SA", status: "active", plan: "single_tenant",
})
await apiPost("/rpc/ensure_default_chart_of_accounts", { p_tenant_id: T2 })

async function api(path, { method = "GET", body } = {}) {
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
function apiPost(path, body) { return api(path, { method: "POST", body }) }
function firstRow(j) { return Array.isArray(j) ? j[0] : j }
function ok(name, pass, detail = "") {
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

// Resolve accounts for T2 (1000 cash asset, 3000 capital equity).
const acct = await api(`/chart_of_accounts?select=id,account_code&tenant_id=eq.${T2}&account_code=in.(1000,3000)`)
const byCode = Object.fromEntries((acct.json ?? []).map((a) => [a.account_code, a.id]))
const cash = byCode["1000"]
const capital = byCode["3000"]

// ── REV-1/2: reversal of a posted entry ────────────────────────────────────
let rev = { status: -1 }
let originalId = null
{
  const posted = await apiPost("/rpc/post_journal_entry", {
    p_tenant_id: T2,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify REV-1 original",
    p_lines: [
      { account_id: cash, debit: 250.0, credit: 0 },
      { account_id: capital, debit: 0, credit: 250.0 },
    ],
  })
  originalId = posted.status === 200 ? (Array.isArray(posted.json) ? posted.json[0]?.out_entry_id : posted.json?.out_entry_id) : null
  rev = await apiPost("/rpc/reverse_journal_entry", {
    p_tenant_id: T2,
    p_entry_id: originalId,
    p_description_ar: "عكس فحص",
  })
}
const revId = rev.status === 200 ? (Array.isArray(rev.json) ? rev.json[0]?.out_entry_id : rev.json?.out_entry_id) : null
ok("REV-1 reversal creates a linked reversal entry", rev.status === 200 && !!revId,
  rev.status === 200 ? `reversal ${revId?.slice(0, 8)}` : `http ${rev.status}: ${rev.text?.slice(0, 140)}`)

if (revId && originalId) {
  const orig = await api(`/journal_entries?select=status,reversed_entry_id&id=eq.${originalId}`)
  ok("REV-1 original marked reversed with linkage",
    orig.status === 200 && orig.json?.[0]?.status === "reversed" && orig.json?.[0]?.reversed_entry_id === revId,
    orig.json?.[0] ? `status=${orig.json[0].status}` : `http ${orig.status}`)

  const revEntry = await api(`/journal_entries?select=entry_type,status,reversal_of_entry_id&id=eq.${revId}`)
  ok("REV-1 reversal entry is type=reversal, posted, linked back",
    revEntry.status === 200 && revEntry.json?.[0]?.entry_type === "reversal" && revEntry.json?.[0]?.status === "posted" && revEntry.json?.[0]?.reversal_of_entry_id === originalId,
    revEntry.json?.[0] ? `type=${revEntry.json[0].entry_type}` : `http ${revEntry.status}`)

  const lines = await api(`/journal_entry_lines?select=account_id,debit_amount,credit_amount&journal_entry_id=eq.${revId}`)
  const rows = lines.json ?? []
  const hasNegatedCash = rows.some((l) => l.account_id === cash && Number(l.credit_amount) === 250 && Number(l.debit_amount) === 0)
  const hasNegatedCapital = rows.some((l) => l.account_id === capital && Number(l.debit_amount) === 250 && Number(l.credit_amount) === 0)
  ok("REV-2 reversal lines mirror original (swapped)", rows.length === 2 && hasNegatedCash && hasNegatedCapital,
    rows.length === 2 ? `cash→credit, capital→debit` : `rows=${rows.length}`)
}

// ── REV-3: cannot reverse a draft ─────────────────────────────────────────
{
  const draft = await apiPost("/rpc/create_journal_draft", {
    p_tenant_id: T2,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify REV-3 draft",
    p_lines: [
      { account_id: cash, debit: 10.0, credit: 0 },
      { account_id: capital, debit: 0, credit: 10.0 },
    ],
  })
  const draftId = draft.status === 200 ? (Array.isArray(draft.json) ? draft.json[0]?.out_entry_id : draft.json?.out_entry_id) : null
  const r3 = draftId
    ? await apiPost("/rpc/reverse_journal_entry", { p_tenant_id: T2, p_entry_id: draftId, p_description_ar: "rev3" })
    : { status: -1 }
  ok("REV-3 reversing a draft rejected (JRN012)", r3.status >= 400 && /JRN012/.test(r3.text),
    r3.status >= 400 ? r3.text?.match(/JRN\d+/)?.[0] ?? "error" : "unexpected 200")
}

// ── REV-4: cannot reverse an already-reversed entry ───────────────────────
{
  // The original is now status='reversed', so the status check (JRN012) fires
  // before the linkage check (JRN011 — belt-and-braces for a race the atomic
  // RPC prevents). Either code proves the double-reversal is blocked.
  const r4 = originalId
    ? await apiPost("/rpc/reverse_journal_entry", { p_tenant_id: T2, p_entry_id: originalId, p_description_ar: "rev4" })
    : { status: -1 }
  ok("REV-4 double reversal blocked (JRN011/JRN012)",
    r4.status >= 400 && /JRN01[12]/.test(r4.text),
    r4.status >= 400 ? r4.text?.match(/JRN\d+/)?.[0] ?? "error" : "unexpected 200")
}

// ── APPR-1: draft → submit → approve → posted ─────────────────────────────
let apprEntryId = null
{
  // Unbalanced draft is allowed (lines 200 / 100).
  const draft = await apiPost("/rpc/create_journal_draft", {
    p_tenant_id: T2,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description_ar: "Verify APPR-1 draft",
    p_lines: [
      { account_id: cash, debit: 200.0, credit: 0 },
      { account_id: capital, debit: 0, credit: 100.0 },
    ],
  })
  const draftId = draft.status === 200 ? (Array.isArray(draft.json) ? draft.json[0]?.out_entry_id : draft.json?.out_entry_id) : null
  ok("APPR-1 unbalanced draft accepted", draft.status === 200 && !!draftId,
    draft.status === 200 ? `draft ${draftId?.slice(0, 8)}` : `http ${draft.status}: ${draft.text?.slice(0, 120)}`)
  apprEntryId = draftId

  // Try to approve WITHOUT submit → JRN013
  const r2 = draftId
    ? await apiPost("/rpc/approve_journal_entry", { p_tenant_id: T2, p_entry_id: draftId })
    : { status: -1 }
  ok("APPR-2 approve without submit rejected (JRN013)", r2.status >= 400 && /JRN013/.test(r2.text),
    r2.status >= 400 ? r2.text?.match(/JRN\d+/)?.[0] ?? "error" : "unexpected 200")

  // Submit → still unbalanced → approve must reject JRN004
  if (draftId) await apiPost("/rpc/submit_journal_entry", { p_tenant_id: T2, p_entry_id: draftId })
  const r3 = draftId
    ? await apiPost("/rpc/approve_journal_entry", { p_tenant_id: T2, p_entry_id: draftId })
    : { status: -1 }
  ok("APPR-3 approve of unbalanced draft rejected (JRN004)", r3.status >= 400 && /JRN004/.test(r3.text),
    r3.status >= 400 ? r3.text?.match(/JRN\d+/)?.[0] ?? "error" : "unexpected 200")

  // Reject → entry back to draft
  if (draftId) await apiPost("/rpc/submit_journal_entry", { p_tenant_id: T2, p_entry_id: draftId })
  const r4 = draftId
    ? await apiPost("/rpc/reject_journal_entry", { p_tenant_id: T2, p_entry_id: draftId, p_reason: "needs fixing" })
    : { status: -1 }
  ok("APPR-4 reject submitted entry works (returns to draft)", r4.status === 200,
    r4.status === 200 ? "rejected" : `http ${r4.status}: ${r4.text?.slice(0, 120)}`)
  if (draftId) {
    const st = await api(`/journal_entries?select=status&id=eq.${draftId}`)
    ok("APPR-4 entry back to draft after rejection", st.json?.[0]?.status === "draft",
      `status=${st.json?.[0]?.status}`)
  }

  // Re-submit and approve the FIXED (balanced) entry → posted.
  // The draft is 200/100; fix the credit line (capital) to 200 — scoped to
  // the single account so the debit line is untouched (single-side check).
  if (draftId) {
    await api(`/journal_entry_lines?journal_entry_id=eq.${draftId}&account_id=eq.${capital}`, { method: "PATCH", body: { credit_amount: 200 } })
    await apiPost("/rpc/submit_journal_entry", { p_tenant_id: T2, p_entry_id: draftId })
    const r5 = await apiPost("/rpc/approve_journal_entry", { p_tenant_id: T2, p_entry_id: draftId, p_comment: "ok" })
    ok("APPR-1 balanced entry approved → posted", r5.status === 200,
      r5.status === 200 ? "posted" : `http ${r5.status}: ${r5.text?.slice(0, 140)}`)
    const st = await api(`/journal_entries?select=status&id=eq.${draftId}`)
    ok("APPR-1 entry status is posted", st.json?.[0]?.status === "posted", `status=${st.json?.[0]?.status}`)
  }
}

// ── PER-1..5: period close / reopen ───────────────────────────────────────
// Run-unique (year, month) so every run targets a FRESH period (re-runs are
// not blocked by a previously-closed test period).
const testYear = 2000 + (RUN % 800)
const testMonth = (RUN % 12) + 1
const periodBody = { tenant_id: T2, period_year: testYear, period_month: testMonth, status: "open" }
const period = await apiPost("/accounting_periods", periodBody)
const periodId = firstRow(period.json)?.id
const periodExists = period.status === 201 || period.status === 409

if (periodId) {
  // PER-1: a draft in the period blocks close
  const draft = await apiPost("/rpc/create_journal_draft", {
    p_tenant_id: T2,
    p_entry_date: `${testYear}-${String(testMonth).padStart(2, "0")}-15`,
    p_description_ar: "Verify PER-1 draft",
    p_lines: [
      { account_id: cash, debit: 5.0, credit: 0 },
      { account_id: capital, debit: 0, credit: 5.0 },
    ],
  })
  const draftId = draft.status === 200 ? (Array.isArray(draft.json) ? draft.json[0]?.out_entry_id : draft.json?.out_entry_id) : null
  const c1 = await apiPost("/rpc/close_accounting_period", { p_tenant_id: T2, p_period_id: periodId })
  ok("PER-1 close blocked with pending drafts (ACC004)", c1.status >= 400 && /ACC004/.test(c1.text),
    c1.status >= 400 ? c1.text?.match(/ACC\d+/)?.[0] ?? "error" : "unexpected 200")

  // Resolve the draft (submit + approve — it is balanced) so PER-2 close works.
  if (draftId) {
    await apiPost("/rpc/submit_journal_entry", { p_tenant_id: T2, p_entry_id: draftId })
    await apiPost("/rpc/approve_journal_entry", { p_tenant_id: T2, p_entry_id: draftId })
  }

  // PER-2: close works once no drafts remain
  const c2 = await apiPost("/rpc/close_accounting_period", { p_tenant_id: T2, p_period_id: periodId })
  ok("PER-2 close open period works", c2.status === 200,
    c2.status === 200 ? "closed" : `http ${c2.status}: ${c2.text?.slice(0, 140)}`)

  // PER-4: posting into closed period → ACC001
  const c4 = await apiPost("/rpc/post_journal_entry", {
    p_tenant_id: T2,
    p_entry_date: `${testYear}-${String(testMonth).padStart(2, "0")}-20`,
    p_description_ar: "Verify PER-4 closed",
    p_lines: [
      { account_id: cash, debit: 5.0, credit: 0 },
      { account_id: capital, debit: 0, credit: 5.0 },
    ],
  })
  ok("PER-4 posting into closed period rejected (ACC001)", c4.status >= 400 && /ACC001/.test(c4.text),
    c4.status >= 400 ? c4.text?.match(/ACC\d+/)?.[0] ?? "error" : "unexpected 200")

  // PER-5: closing an already-closed period → ACC005
  const c5 = await apiPost("/rpc/close_accounting_period", { p_tenant_id: T2, p_period_id: periodId })
  ok("PER-5 closing closed period rejected (ACC005)", c5.status >= 400 && /ACC005/.test(c5.text),
    c5.status >= 400 ? c5.text?.match(/ACC\d+/)?.[0] ?? "error" : "unexpected 200")

  // PER-3: reopen without reason → ACC006; with reason → reopened
  const r1 = await apiPost("/rpc/reopen_accounting_period", { p_tenant_id: T2, p_period_id: periodId, p_reason: "" })
  ok("PER-3 reopen without reason rejected (ACC006)", r1.status >= 400 && /ACC006/.test(r1.text),
    r1.status >= 400 ? r1.text?.match(/ACC\d+/)?.[0] ?? "error" : "unexpected 200")
  const r2 = await apiPost("/rpc/reopen_accounting_period", { p_tenant_id: T2, p_period_id: periodId, p_reason: "audit correction" })
  ok("PER-3 reopen with reason works", r2.status === 200,
    r2.status === 200 ? "reopened" : `http ${r2.status}: ${r2.text?.slice(0, 140)}`)
} else {
  ok("PER period setup", false, `period create failed http ${period.status}: ${period.text?.slice(0, 120)}`)
}

console.log(failures === 0 ? "\n═══ RESULT: ALL PHASE 3 CHECKS PASSED ═══" : `\n═══ RESULT: ${failures} CHECK(S) FAILED ═══`)
process.exit(failures === 0 ? 0 : 1)
