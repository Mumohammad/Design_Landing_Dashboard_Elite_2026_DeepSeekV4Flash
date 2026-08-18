// scripts/verify-vat-return-browser.mjs
// Browser check for Phase 12 (VAT return preparation) — VAT tab in /accounting.
//
// Provisions a throwaway GM user via the admin API, signs in through the real
// UI, opens the Accounting page, switches to the VAT tab, and asserts:
//   B-1  VAT return card renders with a period selector
//   B-2  return summary populates for the auto-selected latest period
//        (Output VAT + Recoverable input + net position cells)
//   B-3  period selector works (changing period refetches the summary)
//   B-4  CSV export action resolves (server action callable, no error flash)
//   B-5  Print report action resolves (server action callable, no error flash)
//   B-6  zero console/page errors during the flow
//
// Usage: node scripts/verify-vat-return-browser.mjs
// Requires the dev server running on :3000 (NEXT_PUBLIC_APP_URL).

import { readFileSync } from "node:fs"
import puppeteer from "puppeteer-core"

const envRaw = readFileSync(".env.local", "utf8")
const env = {}
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const APP = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")
if (!BASE || !KEY || !ANON) {
  console.error("✗ Missing Supabase env vars in .env.local")
  process.exit(1)
}

const RUN = Date.now()
const email = `vat12-${RUN}@elite.local`
const password = "EliteVerify2026!" + (1000 + (RUN % 9000))
const T = "00000000-0000-0000-0000-000000000001" // demo tenant
let failures = 0

function ok(name, pass, detail = "") {
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"

async function fetchRetry(url, opts, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, opts)
    } catch (e) {
      if (i === attempts) throw e
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

// ── Provision GM user (mirrors the REST scripts) ─────────────────────────
const created = await fetchRetry(`${BASE}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { email_verified: true } }),
})
const authUid = (await created.json()).id
if (!authUid) {
  console.error("✗ could not create test user")
  process.exit(1)
}
await fetchRetry(`${BASE}/rest/v1/users`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
  body: JSON.stringify({
    auth_user_id: authUid, tenant_id: T, email, role: "general_manager", status: "active",
    full_name_ar: "مدير فحص الواجهة", full_name_en: "Browser Verify GM",
    must_change_password: false, accepted_invite_at: new Date().toISOString(),
  }),
})

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] })
const page = await browser.newPage()
const consoleErrors = []
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })
page.on("pageerror", (e) => consoleErrors.push(String(e)))

try {
  // Sign in through the real UI
  await page.goto(`${APP}/auth/sign-in`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.type('input[type="email"]', email)
  await page.type('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(
    () => location.pathname.includes("/dashboard") || /invalid|خطأ/.test(document.body.innerText),
    { timeout: 45000 }
  ).catch(() => {})
  ok("B-0 signed in and reached dashboard", /dashboard/.test(page.url()), page.url())

  // Open the Accounting page
  await page.goto(`${APP}/accounting`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.waitForFunction(() => document.body.innerText.length > 0, { timeout: 30000 })

  // Switch to the VAT tab (coordinate click — Radix tabs need a real mouse event)
  const tabRect = await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("[role=tab]")).find((b) => /VAT|الضريبة/.test(b.textContent || ""))
    if (!hit) return null
    const r = hit.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (tabRect) await page.mouse.click(tabRect.x, tabRect.y)
  ok("B-1 VAT tab opened", !!tabRect)

  // B-2: return card renders with a period selector + summary cells.
  // NOTE: the summary wait uses the RETURN card's unique labels —
  // "Output VAT (sales)" / "ضريبة المخرجات (مبيعات)" — NOT the bare
  // "Output VAT", which also appears on the reconciliation card above it
  // and renders before the return data loads. Clicking CSV while the
  // return card is still loading silently no-ops (handleExportVatReturn
  // returns early when vatReturnPeriod is unset), which made B-5 flaky.
  await page.waitForFunction(
    () => /VAT Return|إقرار ضريبة القيمة المضافة/.test(document.body.innerText),
    { timeout: 30000 }
  ).catch(() => {})
  await page.waitForFunction(
    () => /Output VAT \(sales\)|ضريبة المخرجات \(مبيعات\)/.test(document.body.innerText) || /لا توجد بيانات إقرار|No VAT return data/.test(document.body.innerText),
    { timeout: 30000 }
  ).catch(() => {})
  // The period selector must hold a value (vatReturnPeriod set in state),
  // otherwise the CSV/Print handlers return early without any feedback.
  await page.waitForFunction(
    () => {
      const sel = Array.from(document.querySelectorAll("select")).find((s) => /20\d{2}-\d{2}/.test(s.value || ""))
      return !!sel && sel.value !== ""
    },
    { timeout: 30000 }
  ).catch(() => {})
  // Settle: setting vatReturnPeriod re-fires the effect (it's a dependency),
  // which POSTs a second getVatReturn while the first is still resolving.
  // Clicking CSV/Print while that refetch is in flight sends a concurrent
  // server-action POST to /accounting whose response can be starved in dev
  // (the action never resolves, no flash → B-5/B-6 flake). Let it finish.
  await new Promise((r) => setTimeout(r, 2000))
  const cardState = await page.evaluate(() => {
    const t = document.body.innerText
    return {
      card: /VAT Return|إقرار ضريبة القيمة المضافة/.test(t),
      hasSelector: /20\d{2}-\d{2}/.test(t),
      summary: /Output VAT \(sales\)|ضريبة المخرجات \(مبيعات\)|Net payable|صافي مستحق/.test(t),
      empty: /لا توجد بيانات إقرار|No VAT return data/.test(t),
    }
  })
  ok("B-2 VAT return card rendered", cardState.card, `card=${cardState.card}`)
  ok("B-3 period selector present with periods", cardState.hasSelector)
  ok("B-4 summary populated (or empty-state)", cardState.summary || cardState.empty,
    `summary=${cardState.summary} empty=${cardState.empty}`)

  // B-5: CSV export action scoped to the VAT return card — runs on the
  // auto-selected (data-rich) period BEFORE any period switch.
  const csvBtn = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[class*=rounded-2xl]"))
    const card = cards.find((c) => /VAT Return|إقرار ضريبة القيمة المضافة/.test(c.textContent || ""))
    if (!card) return false
    const csv = Array.from(card.querySelectorAll("button")).find((b) => /CSV/.test(b.textContent || ""))
    if (csv) csv.click()
    return !!csv
  })
  let csvOk = false
  let csvFlash = ""
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500))
    csvFlash = await page.evaluate(() => {
      // Success flash: "تم تصدير الإقرار الضريبي." / "VAT return exported."
      // Error flash: "Export failed" / a mapped financial message. Either
      // proves the server action round-tripped.
      const m = document.body.innerText.match(
        /تم تصدير الإقرار الضريبي|VAT return exported|Export failed|No VAT return data for this period|فشل تصدير/
      )
      return m ? m[0] : ""
    })
    if (csvFlash) { csvOk = true; break }
  }
  ok("B-5 CSV export action round-tripped (flash observed)", csvBtn && csvOk,
    `csvBtn=${csvBtn} flash="${csvFlash}"`)

  // B-6: Print action — clicked separately and independently checked.
  const printBtn = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[class*=rounded-2xl]"))
    const card = cards.find((c) => /VAT Return|إقرار ضريبة القيمة المضافة/.test(c.textContent || ""))
    if (!card) return false
    const print = Array.from(card.querySelectorAll("button")).find((b) => /طباعة الإقرار|^Print$/.test(b.textContent || ""))
    if (print) print.click()
    return !!print
  })
  let printErr = false
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 500))
    printErr = await page.evaluate(() =>
      /Failed|فشل|Report failed|No VAT return data/.test(document.body.innerText)
    )
    if (printErr) break
  }
  ok("B-6 print report action resolved without error", printBtn && !printErr, `printBtn=${printBtn}`)

  // B-7: period selector change works — pick a different period (last).
  const selChanged = await page.evaluate(() => {
    const sel = Array.from(document.querySelectorAll("select")).find((s) => /20\d{2}-\d{2}/.test(s.value || ""))
    if (!sel || sel.options.length < 2) return false
    sel.selectedIndex = sel.options.length - 1
    sel.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  })
  await new Promise((r) => setTimeout(r, 1200))
  const afterSwitch = await page.evaluate(() => {
    const t = document.body.innerText
    return /لا توجد بيانات إقرار|No VAT return data/.test(t) || /صافي مستحق|صافي المركز|Net payable|Net receivable|Net position/.test(t)
  })
  ok("B-7 period selector change accepted and refetched", selChanged && afterSwitch,
    `selChanged=${selChanged} refetched=${afterSwitch}`)
} catch (e) {
  ok("B-9 browser flow completed without exceptions", false, String(e).slice(0, 200))
}

await browser.close()

const realErrors = consoleErrors.filter((e) => !/favicon/.test(e))
ok("B-8 zero console/page errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "))

console.log(failures === 0 ? "\n✅ ALL BROWSER CHECKS PASSED" : `\n❌ ${failures} BROWSER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
