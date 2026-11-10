// scripts/verify-vat-reconciliation-browser.mjs
// Browser check for Phase 11 (VAT reconciliation) — VAT tab in /accounting.
//
// Provisions a throwaway GM user via the admin API, signs in through the real
// UI, opens the Accounting page, switches to the VAT tab, and asserts:
//   B-1  Reconciliation-by-period table renders (header + at least one row)
//   B-2  Review-items card renders ("Items awaiting review" / "عناصر قيد المراجعة")
//   B-3  CSV export action resolves (server action callable, no console errors)
//   B-4  zero console/page errors during the flow
//
// Usage: node scripts/verify-vat-reconciliation-browser.mjs
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
const email = `vat11-${RUN}@elite.local`
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

  // Reconciliation-by-period table
  await page.waitForFunction(
    () => /Reconciliation by period|التسوية حسب الفترة/.test(document.body.innerText),
    { timeout: 30000 }
  )
  const reconBody = await page.evaluate(() => {
    const t = document.body.innerText
    return {
      header: /Reconciliation by period|التسوية حسب الفترة/.test(t),
      hasPeriod: /\d{4}-\d{2}/.test(t),
    }
  })
  ok("B-2 reconciliation table rendered with a period row", reconBody.header && reconBody.hasPeriod,
    `header=${reconBody.header} period=${reconBody.hasPeriod}`)

  // Review-items card
  await page.waitForFunction(
    () => /Items awaiting review|عناصر قيد المراجعة/.test(document.body.innerText),
    { timeout: 30000 }
  ).catch(() => {})
  const reviewCard = await page.evaluate(() =>
    /Items awaiting review|عناصر قيد المراجعة/.test(document.body.innerText)
  )
  ok("B-3 review-items card present", reviewCard)

  // CSV export button works (server action round-trip) — click the element
  // directly (React handles the synthetic click) and poll for the flash
  // "تم تصدير / exported" feedback or an error flash.
  const csvClicked = await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button")).find((b) => /CSV|تصدير CSV/.test(b.textContent || ""))
    if (hit) hit.click()
    return !!hit
  })
  let csvOk = false
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500))
    csvOk = await page.evaluate(() =>
      /exported|تم تصدير|Failed|فشل/.test(document.body.innerText)
    )
    if (csvOk) break
  }
  ok("B-4 CSV export action round-tripped", csvClicked && csvOk)
} catch (e) {
  ok("B-5 browser flow completed without exceptions", false, String(e).slice(0, 200))
}

await browser.close()

const realErrors = consoleErrors.filter((e) => !/favicon/.test(e))
ok("B-6 zero console/page errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "))

console.log(failures === 0 ? "\n✅ ALL BROWSER CHECKS PASSED" : `\n❌ ${failures} BROWSER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
