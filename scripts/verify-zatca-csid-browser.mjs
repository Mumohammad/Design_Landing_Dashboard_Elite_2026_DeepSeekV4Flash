// scripts/verify-zatca-csid-browser.mjs
// Browser check for the Phase 18 CSID credential store — "Stored CSID
// credentials" card on the /accounting ZATCA tab.
//
// Seeds one CSID row for the demo tenant via the service role (what
// saveZatcaCsid writes), signs in as a throwaway GM user through the real UI,
// opens the Accounting page, switches to the ZATCA tab, and asserts:
//   C-1  ZATCA tab renders the "Stored CSID credentials" card
//   C-2  The seeded row appears with environment · kind + status badge
//   C-3  The secret is MASKED in the UI (preview prefix visible, full
//        secret text absent from the page)
//   C-4  zero console/page errors during the flow
//
// Usage: node scripts/verify-zatca-csid-browser.mjs
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
// Allow a CLI override (e.g. NEXT_PUBLIC_APP_URL=http://localhost:3200 when
// the dev server runs off the default port) — otherwise fall back to .env.local.
const APP = (process.env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")
if (!BASE || !KEY || !ANON) {
  console.error("✗ Missing Supabase env vars in .env.local")
  process.exit(1)
}

const RUN = Date.now()
const email = `zatca-csid-${RUN}@elite.local`
const password = "EliteVerify2026!" + (1000 + (RUN % 9000))
const T = "00000000-0000-0000-0000-000000000001" // demo tenant
const SECRET = "SUPER-SECRET-" + RUN // full secret must NEVER appear in the UI
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

// ── Seed one CSID row (what saveZatcaCsid writes) ─────────────────────────
const seed = await fetchRetry(`${BASE}/rest/v1/zatca_csids`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
  body: JSON.stringify({
    tenant_id: T,
    environment: "sandbox",
    kind: "production",
    csid_base64: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A-TEST-CERT",
    secret: SECRET,
    status: "issued",
    issued_at: new Date().toISOString(),
  }),
})
const seededRow = (await seed.json())[0]
ok("S-1 seeded a sandbox/production CSID row via service role", seed.status === 201 && !!seededRow)

// ── Provision GM user ─────────────────────────────────────────────────────
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
    full_name_ar: "مدير فحص CSID", full_name_en: "CSID Verify GM",
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
  ok("C-0 signed in and reached dashboard", /dashboard/.test(page.url()), page.url())

  // Open the Accounting page, switch to the ZATCA tab
  await page.goto(`${APP}/accounting`, { waitUntil: "networkidle0", timeout: 60000 })
  await page.waitForFunction(() => document.body.innerText.length > 0, { timeout: 30000 })
  const tabRect = await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("[role=tab]")).find((b) => /ZATCA|إشعارات ZATCA/.test(b.textContent || ""))
    if (!hit) return null
    hit.scrollIntoView({ block: "center" })
    const r = hit.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (tabRect) await page.mouse.click(tabRect.x, tabRect.y)
  ok("C-1 ZATCA tab opened", !!tabRect)

  // C-2: the "Stored CSID credentials" card must render the seeded row
  await page.waitForFunction(
    () => /Stored CSID credentials|شهادات CSID المخزّنة/.test(document.body.innerText),
    { timeout: 30000 }
  ).catch(() => {})
  let card = ""
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500))
    card = await page.evaluate(() => {
      const t = document.body.innerText
      const hasCard = /Stored CSID credentials|شهادات CSID المخزّنة/.test(t)
      // CSS `capitalize` renders "Sandbox · Production" — match case-insensitively.
      const hasRow = /sandbox\s*·\s*production/i.test(t)
      return hasCard && hasRow ? "ok" : `card=${hasCard} row=${hasRow}`
    })
    if (card === "ok") break
  }
  ok("C-2 CSID card renders the seeded row (sandbox · production)", card === "ok", card)

  // C-3: secret masked — preview prefix visible, full secret ABSENT
  const secretState = await page.evaluate((fullSecret) => {
    const t = document.body.innerText
    const preview = /Secret:|السر:/.test(t)
    const leaked = t.includes(fullSecret)
    return { preview, leaked }
  }, SECRET)
  ok("C-3 secret masked in UI (preview shown, full secret absent)",
    secretState.preview && !secretState.leaked,
    `previewShown=${secretState.preview} leaked=${secretState.leaked}`)

  // Also confirm the masked value itself (first 4 chars) is present
  const maskOk = await page.evaluate((prefix) => {
    return document.body.innerText.includes(prefix)
  }, SECRET.slice(0, 4))
  ok("C-3b masked prefix shown", maskOk, `prefix="${SECRET.slice(0, 4)}"`)

  // O-1: the "Onboard" button renders in the CSID card header
  const hasOnboardBtn = await page.evaluate(() =>
    /إعداد جديد|Onboard/.test(document.body.innerText)
  )
  ok("O-1 Onboard button present", hasOnboardBtn)

  // O-2: clicking it opens the OTP dialog (environment selector + OTP input)
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /إعداد جديد|Onboard/.test(b.textContent || ""))
    if (!btn) return false
    btn.click()
    return true
  })
  await new Promise((r) => setTimeout(r, 800))
  const dialogState = await page.evaluate(() => {
    const t = document.body.innerText
    const hasOtp = /One-time password|رمز الدخول لمرة واحدة/.test(t)
    const hasEnv = /Environment|البيئة/.test(t)
    const hasSandbox = /sandbox/i.test(t) && /TSTZATCA/i.test(t)
    return { hasOtp, hasEnv, hasSandbox }
  })
  ok("O-2 Onboard dialog opens with OTP + environment fields",
    clicked && dialogState.hasOtp && dialogState.hasEnv && dialogState.hasSandbox,
    JSON.stringify(dialogState))

  // O-3: all three environment templates offered (TSTZATCA/PREZATCA/ZATCA)
  const envOptions = await page.evaluate(() => {
    const sel = document.getElementById("onboardEnv")
    return sel ? Array.from(sel.options).map((o) => o.textContent || "") : []
  })
  ok("O-3 environment selector offers sandbox/simulation/production templates",
    envOptions.length === 3 && /TSTZATCA/.test(envOptions[0]) && /PREZATCA/.test(envOptions[1]) && /ZATCA/.test(envOptions[2]),
    envOptions.join(" | "))

  // O-4: Cancel closes the dialog
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /إلغاء|Cancel/.test(b.textContent || ""))
    if (btn) btn.click()
  })
  await new Promise((r) => setTimeout(r, 600))
  const dialogClosed = await page.evaluate(() => !document.getElementById("onboardOtp"))
  ok("O-4 Cancel closes the dialog", dialogClosed)
} catch (e) {
  ok("C-5 browser flow completed without exceptions", false, String(e).slice(0, 200))
}

await browser.close()

const realErrors = consoleErrors.filter((e) => !/favicon/.test(e))
ok("C-4 zero console/page errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "))

// ── Cleanup: seeded CSID row + throwaway user ─────────────────────────────
if (seededRow?.id) {
  await fetchRetry(`${BASE}/rest/v1/zatca_csids?id=eq.${seededRow.id}`, {
    method: "DELETE",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
}
await fetchRetry(`${BASE}/auth/v1/admin/users/${authUid}`, {
  method: "DELETE",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})

console.log(failures === 0 ? "\n✅ ALL CSID BROWSER CHECKS PASSED" : `\n❌ ${failures} BROWSER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
