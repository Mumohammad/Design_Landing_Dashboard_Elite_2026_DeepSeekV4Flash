// scripts/verify-vat-return-print-layout.mjs
// Phase 12 print-layout check: click the VAT return card's Print button,
// capture the popup document that the app writes, and assert the A4 report
// contains the expected bilingual structure.
//
//   P-1  Print button found and clicked
//   P-2  popup window opens with the A4 report
//   P-3  report title bilingual: "إقرار ضريبة القيمة المضافة / VAT Return"
//   P-4  period line + doc ref (VAT-RET-YYYY-MM)
//   P-5  structured field rows present (Output VAT, Recoverable input,
//        Non-recoverable, Net payable/receivable) + SAR amounts
//   P-6  signatures block + generated meta
//   P-7  zero console/page errors
//
// Usage: node scripts/verify-vat-return-print-layout.mjs
// Requires the dev server running on :3000.

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
const email = `vat12p-${RUN}@elite.local`
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
    full_name_ar: "مدير فحص الطباعة", full_name_en: "Print Layout GM",
    must_change_password: false, accepted_invite_at: new Date().toISOString(),
  }),
})

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-popup-blocking", "--disable-dev-shm-usage"],
})
const page = await browser.newPage()
const consoleErrors = []
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })
page.on("pageerror", (e) => consoleErrors.push(String(e)))

// Headless Chrome blocks window.open("") from server actions, so we stub it
// before any page loads: capture the report HTML the app writes instead of
// opening a real popup. The fake window exposes the same document.write/close
// API the print handler uses.
await page.evaluateOnNewDocument(() => {
  window.__printedHtml = ""
  window.open = () => {
    const fakeDoc = {
      write: (html) => { window.__printedHtml = html },
      close: () => {},
    }
    return {
      document: fakeDoc,
      print: () => {},
      close: () => {},
    }
  }
})

try {
  await page.goto(`${APP}/auth/sign-in`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.type('input[type="email"]', email)
  await page.type('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(
    () => location.pathname.includes("/dashboard") || /invalid|خطأ/.test(document.body.innerText),
    { timeout: 45000 }
  ).catch(() => {})
  ok("P-0 signed in", /dashboard/.test(page.url()), page.url())

  await page.goto(`${APP}/accounting`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.waitForFunction(() => document.body.innerText.length > 0, { timeout: 30000 })

  const tabRect = await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("[role=tab]")).find((b) => /VAT|الضريبة/.test(b.textContent || ""))
    if (!hit) return null
    const r = hit.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (tabRect) await page.mouse.click(tabRect.x, tabRect.y)

  // Wait for the return summary to populate.
  await page.waitForFunction(
    () => /إقرار ضريبة القيمة المضافة/.test(document.body.innerText),
    { timeout: 30000 }
  ).catch(() => {})
  await page.waitForFunction(
    () => /صافي مستحق|صافي المركز|لا توجد بيانات إقرار/.test(document.body.innerText),
    { timeout: 30000 }
  ).catch(() => {})
  await new Promise((r) => setTimeout(r, 1200))

  // Click Print in the VAT return card with a REAL mouse event — window.open
  // requires a user-activation token, so a synthetic .click() from evaluate
  // would be silently blocked in headless.
  const printRect = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[class*=rounded-2xl]"))
    const card = cards.find((c) => /إقرار ضريبة القيمة المضافة/.test(c.textContent || ""))
    if (!card) return null
    const print = Array.from(card.querySelectorAll("button")).find((b) => /طباعة الإقرار|^Print$/.test(b.textContent || ""))
    if (!print) return null
    print.scrollIntoView({ block: "center" })
    return true
  })
  await new Promise((r) => setTimeout(r, 400))
  const printPoint = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[class*=rounded-2xl]"))
    const card = cards.find((c) => /إقرار ضريبة القيمة المضافة/.test(c.textContent || ""))
    if (!card) return null
    const print = Array.from(card.querySelectorAll("button")).find((b) => /طباعة الإقرار|^Print$/.test(b.textContent || ""))
    if (!print) return null
    const r = print.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (printPoint) {
    await page.mouse.move(printPoint.x, printPoint.y)
    await page.mouse.down()
    await page.mouse.up()
  }
  ok("P-1 print button clicked (real mouse, scrolled into view)", !!printPoint, JSON.stringify(printPoint))

  // The server action records the document + audit log, so it can take a few
  // seconds; poll the stub instead of a fixed short wait.
  let content = ""
  for (let i = 0; i < 20 && !content; i++) {
    await new Promise((r) => setTimeout(r, 500))
    content = await page.evaluate(() => window.__printedHtml ?? "")
  }

  ok("P-2 print handler wrote report HTML", content.length > 500, `len=${content.length}`)
  ok("P-3 bilingual title", /إقرار ضريبة القيمة المضافة/.test(content) && /VAT Return/.test(content))
  ok("P-4 period + doc ref", /VAT-RET-20\d{2}-\d{2}/.test(content), content.match(/VAT-RET-20\d{2}-\d{2}/)?.[0])
  ok("P-5 structured field rows",
    /Output VAT \(sales\)/.test(content) &&
    /Recoverable input VAT/.test(content) &&
    /Non-recoverable input VAT/.test(content) &&
    /Net VAT (payable|receivable|position)/.test(content),
    `output=${/Output VAT/.test(content)} rec=${/Recoverable input VAT/.test(content)} nonrec=${/Non-recoverable/.test(content)} net=${/Net VAT (payable|receivable|position)/.test(content)}`)
  ok("P-5b SAR amounts present", /SAR/.test(content))
  ok("P-6 signatures + meta",
    /Prepared by|أعدّ الإقرار/.test(content) && /Generated:/i.test(content))
} catch (e) {
  ok("P-8 browser flow completed without exceptions", false, String(e).slice(0, 200))
}

await browser.close()

const realErrors = consoleErrors.filter((e) => !/favicon/.test(e))
ok("P-7 zero console/page errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "))

console.log(failures === 0 ? "\n✅ ALL PRINT-LAYOUT CHECKS PASSED" : `\n❌ ${failures} PRINT-LAYOUT CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
