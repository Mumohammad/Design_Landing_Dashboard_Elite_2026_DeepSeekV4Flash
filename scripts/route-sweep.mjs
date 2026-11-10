// Prompt L — Phase 1 route sweep (standalone script; faster than the spec
// runner because it reuses one session and skips assertion overhead).
//
// Usage: node scripts/route-sweep.mjs <startIdx> <endIdx1based>
// Writes: .freebuff/sweep-results.json (+ screenshots of failures)

import { chromium } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"

const BASE = process.env.BASE_URL ?? "http://localhost:3000"
const EMAIL = process.env.TEST_USER_EMAIL ?? "admin@elitedev.com.sa"
const PASSWORD = process.env.TEST_USER_PASSWORD ?? "Test1234!"

const ROUTES = [
  "/accounting",
  "/applications",
  "/approvals",
  "/attendance",
  "/audit-log",
  "/calendar",
  "/chat",
  "/dashboard",
  "/dashboard-2",
  "/drivers",
  "/expenses",
  "/faqs",
  "/hr",
  "/invoices",
  "/mail",
  "/maintenance",
  "/orders",
  "/payments",
  "/payroll",
  "/platforms",
  "/pricing",
  "/reports",
  "/roles",
  "/security",
  "/settings",
  "/tasks",
  "/templates",
  "/users",
  "/vehicles",
  "/violations",
]

// Routes whose page.tsx is a deliberate redirect stub (template demo routes
// retired → /dashboard). Their redirect is the EXPECTED green state.
const EXPECTED_REDIRECTS = new Set(["/calendar", "/chat", "/dashboard-2", "/faqs", "/mail", "/pricing", "/tasks", "/templates"])

const start = Number(process.argv[2] ?? 1) - 1
const end = Number(process.argv[3] ?? ROUTES.length)
const slice = ROUTES.slice(start, end)

const BOUNDARY = /تعذّر تحميل هذه الوحدة|An error occurred|Application error/i
const NOT_FOUND = /404|This page could not be found|الصفحة غير موجودة/i

mkdirSync(".freebuff/sweep", { recursive: true })
const results = []

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

const issues = []
page.on("console", (m) => {
  if (m.type() === "error") issues.push(m.text().slice(0, 400))
})
page.on("pageerror", (e) => issues.push("pageerror: " + String(e?.message ?? e).slice(0, 400)))

// ── login ──
async function login(p) {
  await p.goto(BASE + "/auth/sign-in", { waitUntil: "domcontentloaded", timeout: 40_000 })
  // Dev-mode hydration is slow — the RHF+zod form resets controlled inputs
  // filled before React attaches. Wait for the shell, then a settle beat.
  await p.locator("button[type=submit]").waitFor({ state: "visible", timeout: 30_000 })
  await p.waitForTimeout(1500)
  await p.locator('input[type="email"], input[name="email"]').first().fill(EMAIL)
  await p.locator('input[type="password"]').first().fill(PASSWORD)
  await p.locator("button[type=submit]").click()
  // GM/admin without a verified TOTP factor land on /settings/mfa
  // (proxy step 5.5 enrollment gate) — that is a valid authenticated state.
  await p.waitForURL(/\/dashboard|\/landing|\/settings\/mfa/, { timeout: 45_000 })
}
try {
  await login(page)
  console.log("[sweep] login OK")
} catch (e) {
  console.log("[sweep] login attempt 1 failed (" + e.message.split("\n")[0] + ") — retrying after hydration settle")
  try {
    await login(page)
    console.log("[sweep] login OK on retry")
  } catch (e2) {
  console.error("[sweep] LOGIN FAILED: " + e2.message)
  console.error("[sweep] url now: " + page.url())
  const body = await page.locator("body").innerText().catch(() => "<none>")
  console.error("[sweep] body: " + body.slice(0, 300).replace(/\n+/g, " | "))
  await page.screenshot({ path: ".freebuff/login-failure.png" }).catch(() => {})
  process.exit(2)
  }
}

// ── walk routes ──
for (const route of slice) {
  issues.length = 0
  const rec = { route, status: 0, boundary: false, notFound: false, blank: false, redirected: false, finalUrl: null, digest: null, console: [] }
  try {
    const resp = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 40_000 })
    rec.status = resp?.status() ?? 0
    // settle window for client fetches (no networkidle — some surfaces poll)
    await page.waitForTimeout(4000)
    // Record where we ACTUALLY landed — a proxy redirect to /settings/mfa or
    // /auth/sign-in renders a full page that would otherwise count as "ok".
    rec.finalUrl = page.url()
    rec.redirected = !rec.finalUrl.startsWith(BASE + route)
    const body = (await page.locator("body").innerText().catch(() => "")) ?? ""
    rec.boundary = BOUNDARY.test(body)
    rec.notFound = !rec.boundary && NOT_FOUND.test(body)
    const main = await page.locator("main").first().innerText().catch(() => "")
    rec.blank = !rec.boundary && !rec.notFound && main.trim().length < 40
    if (rec.boundary) {
      const dig = body.match(/ref:\s*([a-z0-9]+)/i)
      rec.digest = dig ? dig[1] : null
      const slug = route.replaceAll("/", "_")
      await page.screenshot({ path: `.freebuff/sweep/${slug}.png` }).catch(() => {})
    }
    rec.console = issues.slice(0, 4)
  } catch (e) {
    rec.status = rec.status || -1
    rec.console = [`navigation failure: ${String(e?.message ?? e).slice(0, 300)}`]
  }
  results.push(rec)
  const flag = rec.redirected && EXPECTED_REDIRECTS.has(route)
    ? "redirect→"
    : rec.redirected
      ? "REDIRECT"
    : rec.boundary
      ? "BOUNDARY"
      : rec.notFound
        ? "404"
        : rec.blank
          ? "BLANK"
          : "ok"
  console.log(
    `[sweep] ${flag.padEnd(8)} ${rec.status || " - "} ${route}${rec.redirected ? " -> " + rec.finalUrl : ""}${rec.digest ? " digest=" + rec.digest : ""}`,
  )
}

await browser.close()
writeFileSync(".freebuff/sweep-results.json", JSON.stringify(results, null, 2))
const bad = results.filter((r) => (r.boundary || r.notFound || r.blank || r.redirected) && !(r.redirected && EXPECTED_REDIRECTS.has(r.route)))
console.log(`[sweep] done: ${results.length - bad.length}/${results.length} green, ${bad.length} failing`)
if (bad.length) {
  console.log("[sweep] failing: " + bad.map((r) => r.route).join(", "))
}
process.exit(0)
