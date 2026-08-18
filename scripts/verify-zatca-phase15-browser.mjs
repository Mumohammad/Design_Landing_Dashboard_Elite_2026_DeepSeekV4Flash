// scripts/verify-zatca-phase15-browser.mjs
// Browser check for Phase 15 (ZATCA adapter) — ZATCA tab in /accounting.
//
// Provisions a throwaway GM user via the admin API, signs in through the real
// UI, opens the Accounting page, switches to the ZATCA tab, and asserts:
//   B-1  ZATCA tab opens with the transmission log card
//   B-2  Run adapter resolves (server action round-trips; sandbox summary
//        flash observed) and transmission rows appear (reported status)
//   B-3  View dialog opens the UBL payload for a transmission row
//   B-4  zero console/page errors during the flow
//
// Usage: node scripts/verify-zatca-phase15-browser.mjs
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
const email = `zatca15-${RUN}@elite.local`
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
    full_name_ar: "مدير فحص ZATCA", full_name_en: "ZATCA Verify GM",
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

  // Switch to the ZATCA tab (scroll into view first — the tab bar wraps)
  const tabRect = await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("[role=tab]")).find((b) => /ZATCA|إشعارات ZATCA/.test(b.textContent || ""))
    if (!hit) return null
    hit.scrollIntoView({ block: "center" })
    const r = hit.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (tabRect) await page.mouse.click(tabRect.x, tabRect.y)
  ok("B-1 ZATCA tab opened", !!tabRect)

  await page.waitForFunction(
    () => /ZATCA transmission log|سجل إرسال ZATCA/.test(document.body.innerText),
    { timeout: 30000 }
  ).catch(() => {})

  // B-2: Run adapter — expect a sandbox summary flash and rows appearing.
  const runBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"))
    const b = btns.find((x) => /Run adapter|تشغيل المحوّل/.test(x.textContent || ""))
    if (b) b.click()
    return !!b
  })
  let flash = ""
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    flash = await page.evaluate(() => {
      const m = document.body.innerText.match(/ZATCA: [^—\n]*|ZATCA adapter failed|فشل/)
      return m ? m[0] : ""
    })
    if (flash) break
  }
  ok("B-2 Run adapter round-tripped (summary flash observed)", runBtn && Boolean(flash), `flash="${flash}"`)

  // Transmission rows should now exist for the demo tenant's finalized sales
  // documents (the seeded INV-2026-000001 at minimum).
  let rowState = { rows: 0, reported: false }
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500))
    rowState = await page.evaluate(() => {
      const t = document.body.innerText
      return {
        rows: (t.match(/Reported|مُبلَّغ عنها|Rejected|مرفوضة|Cleared|مُخلصة/g) || []).length,
        reported: /Reported|مُبلَّغ عنها/.test(t),
      }
    })
    if (rowState.rows > 0) break
  }
  ok("B-3 transmission rows rendered after run", rowState.rows > 0,
    `statusBadges=${rowState.rows} reported=${rowState.reported}`)

  // B-4: View dialog opens the UBL payload for the first row. Scope to the
  // ZATCA card — other hidden tab panels have their own View buttons.
  const viewOpened = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[class*=rounded-2xl]"))
    const card = cards.find((c) => /ZATCA transmission log|سجل إرسال ZATCA/.test(c.textContent || ""))
    if (!card) return false
    const btns = Array.from(card.querySelectorAll("button"))
    const b = btns.find((x) => /View|عرض/.test(x.textContent || ""))
    if (!b) return false
    b.click()
    return true
  })
  let dialogState = false
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500))
    dialogState = await page.evaluate(() => {
      const t = document.body.innerText
      return /UBL document|وثيقة UBL/.test(t) && /<Invoice|&lt;Invoice/.test(t)
    })
    if (dialogState) break
  }
  ok("B-4 View dialog shows UBL payload", viewOpened && dialogState,
    `viewBtn=${viewOpened} dialog=${dialogState}`)

  // ── AUTO-RUN check: finalizing a NEW sales invoice must transmit it ──────
  // without pressing "Run adapter" (wired into finalizeInvoice).
  await page.goto(`${APP}/invoices`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.waitForFunction(() => document.body.innerText.length > 0, { timeout: 30000 })
  await new Promise((r) => setTimeout(r, 2000))  // let the list load
  const beforeRefs = await page.evaluate(() =>
    (document.body.innerText.match(/INV-\d{4}-\d{6}/g) || [])
  )

  // Open the create-draft dialog via the primary CTA.
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /New invoice|فاتورة جديدة/.test(x.textContent || ""))
    if (b) b.click()
  })
  await page.waitForFunction(() => !!document.querySelector("#inv-party"), { timeout: 20000 }).catch(() => {})

  // Fill the form: customer select + description/qty/price via native
  // puppeteer events (the native-setter hack doesn't reliably trigger React).
  const selValue = await page.evaluate(() => {
    const sel = document.querySelector("#inv-party")
    return sel && sel.options.length > 1 ? sel.options[1].value : ""
  })
  if (selValue) await page.select("#inv-party", selValue)
  await page.type('[role=dialog] input[placeholder="Line description"], [role=dialog] input[placeholder="وصف البند"]', "ZATCA auto-run probe")
  // Qty = first number input without id, Price = second (header VAT has id
  // inv-vat). Filter INSIDE the evaluate — index spaces must not mix.
  const setNum = async (which, text) => {
    const ok = await page.evaluate((w) => {
      const dialog = document.querySelector("[role=dialog]")
      const nums = Array.from(dialog.querySelectorAll("input")).filter((i) => i.type === "number" && i.id !== "inv-vat")
      const input = w === "qty" ? nums[0] : nums[1]
      if (!input) return false
      input.focus()
      input.select()
      return true
    }, which)
    if (!ok) return false
    await page.keyboard.press("Backspace")
    await page.keyboard.type(text)
    return true
  }
  await setNum("qty", "1")
  await setNum("price", "500")
  let filled = "partial"
  for (let i = 0; i < 10 && filled !== "ok"; i++) {
    await new Promise((r) => setTimeout(r, 300))
    filled = await page.evaluate(() => {
      const dialog = document.querySelector("[role=dialog]")
      if (!dialog) return "no-dialog"
      const desc = Array.from(dialog.querySelectorAll("input")).find((i) => /Line description|وصف البند/.test(i.placeholder || ""))
      const nums = Array.from(dialog.querySelectorAll("input")).filter((i) => i.type === "number" && i.id !== "inv-vat")
      const descOk = (desc?.value || "").trim() === "ZATCA auto-run probe"
      const qtyOk = nums[0]?.value === "1"
      const priceOk = nums[1]?.value === "500"
      return descOk && qtyOk && priceOk ? "ok" : `desc=${desc?.value} qty=${nums[0]?.value} price=${nums[1]?.value}`
    })
  }
  ok("B-5 create-draft form filled", filled === "ok", filled)

  const saved = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /Save draft|حفظ المسودة/.test(x.textContent || ""))
    if (!b) return false
    b.click()
    return true
  })

  // The new draft is the INV ref that did NOT exist before — retry-loop
  // because the save action + list reload take a moment.
  let newRef = null
  for (let i = 0; i < 12 && !newRef; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const afterRefs = await page.evaluate(() =>
      (document.body.innerText.match(/INV-\d{4}-\d{6}/g) || [])
    )
    newRef = (afterRefs || []).find((r) => !(beforeRefs || []).includes(r)) || null
  }
  ok("B-6a new draft row appeared", saved && Boolean(newRef), `saved=${saved} ref=${newRef}`)

  let issueClicked = false
  let finalizeClicked = false
  if (newRef) {
    for (let i = 0; i < 10 && !issueClicked; i++) {
      issueClicked = await page.evaluate((ref) => {
        const rows = Array.from(document.querySelectorAll("tr"))
        const row = rows.find((r) => r.textContent?.includes(ref))
        const b = row ? Array.from(row.querySelectorAll("button")).find((x) => /Issue|إصدار/.test(x.textContent || "")) : null
        if (!b) return false
        b.click()
        return true
      }, newRef)
      if (!issueClicked) await new Promise((r) => setTimeout(r, 500))
    }
    await new Promise((r) => setTimeout(r, 2000))
    for (let i = 0; i < 10 && !finalizeClicked; i++) {
      finalizeClicked = await page.evaluate((ref) => {
        const rows = Array.from(document.querySelectorAll("tr"))
        const row = rows.find((r) => r.textContent?.includes(ref))
        const b = row ? Array.from(row.querySelectorAll("button")).find((x) => /Finalize|اعتماد/.test(x.textContent || "")) : null
        if (!b) return false
        b.click()
        return true
      }, newRef)
      if (!finalizeClicked) await new Promise((r) => setTimeout(r, 500))
    }
    await new Promise((r) => setTimeout(r, 4000))  // finalize + auto-run ZATCA
  }
  ok("B-6 new invoice issued + finalized through the UI", Boolean(newRef) && issueClicked && finalizeClicked,
    `ref=${newRef} issue=${issueClicked} finalize=${finalizeClicked}`)

  // Auto-run: the finalized invoice must have a reported transmission WITHOUT
  // pressing "Run adapter" — assert deterministically via the service role
  // (the invoice number was generated by the UI flow above; the transmission
  // is created by runZatcaAdapter() wired into finalizeInvoice).
  let autoTx = false
  for (let i = 0; i < 10 && !autoTx; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const invRes = await fetchRetry(`${BASE}/rest/v1/invoices?select=id&invoice_number=eq.${newRef}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    const invRow = (await invRes.json())[0]
    if (!invRow) continue
    const txRes = await fetchRetry(`${BASE}/rest/v1/zatca_transmissions?select=status&invoice_id=eq.${invRow.id}&doc_type=eq.invoice`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    const txRows = await txRes.json()
    autoTx = Array.isArray(txRows) && txRows.some((r) => r.status === "reported" || r.status === "cleared")
  }
  ok("B-7 auto-run: new finalized invoice transmitted without Run button", Boolean(newRef) && autoTx,
    `ref=${newRef} reported=${autoTx}`)
} catch (e) {
  ok("B-8 browser flow completed without exceptions", false, String(e).slice(0, 200))
}

await browser.close()

const realErrors = consoleErrors.filter((e) => !/favicon/.test(e))
ok("B-8 zero console/page errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "))

// Cleanup the throwaway user
await fetchRetry(`${BASE}/auth/v1/admin/users/${authUid}`, {
  method: "DELETE",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})

console.log(failures === 0 ? "\n✅ ALL ZATCA BROWSER CHECKS PASSED" : `\n❌ ${failures} BROWSER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
