// Dev helper: verify the updated landing page (pricing, operations w/o orders,
// drone visual, Explore the Platform CTA, AR + EN, no console errors).
import puppeteer from "puppeteer-core"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const BASE = process.env.BASE_URL || "http://localhost:3000"

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
const errors = []
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text())
})
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message))

const results = []
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`)

// ── Arabic ──
await page.goto(`${BASE}/landing`, { waitUntil: "networkidle0", timeout: 60000 })
await new Promise((r) => setTimeout(r, 1500))

check("AR dir=rtl", (await page.evaluate(() => document.documentElement.dir)) === "rtl")
check(
  "AR nav has Pricing",
  await page.evaluate(() => [...document.querySelectorAll("header nav a")].some((a) => a.textContent.trim() === "الأسعار"))
)
check(
  "AR pricing section present",
  await page.evaluate(() => !!document.querySelector("#pricing"))
)
check(
  "AR pricing plans (3)",
  (await page.evaluate(() => document.querySelectorAll("#pricing ul").length)) >= 3
)
check(
  "AR operations has NO 'الطلبات' KPI",
  !(await page.evaluate(() => document.querySelector("#operations")?.textContent.includes("إجمالي الطلبات")))
)
check(
  "AR operations has drone image",
  await page.evaluate(
    async () => {
      document.querySelector("#operations")?.scrollIntoView({ behavior: "auto", block: "center" })
      await new Promise((r) => setTimeout(r, 3000))
      const img = document.querySelector("#operations img[src*='drone']")
      return !!img && img.naturalWidth > 0
    }
  )
)
check(
  "AR hero CTA -> #platform",
  (await page.evaluate(() => document.querySelector("main a[href='#platform']")?.getAttribute("href"))) === "#platform"
)

// CTA scroll behavior
await page.evaluate(() => document.querySelector("main a[href='#platform']")?.click())
await new Promise((r) => setTimeout(r, 2600))
const scrollPosAr = await page.evaluate(() => window.scrollY)
check("AR CTA scrolls down", scrollPosAr > 300, `scrollY=${Math.round(scrollPosAr)}`)

// ── English ──
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("header button")].find((b) => b.textContent.trim() === "EN")
  btn?.click()
})
await new Promise((r) => setTimeout(r, 2500))

check("EN dir=ltr", (await page.evaluate(() => document.documentElement.dir)) === "ltr")
check(
  "EN nav has Pricing",
  await page.evaluate(() => [...document.querySelectorAll("header nav a")].some((a) => a.textContent.trim() === "Pricing"))
)
check(
  "EN operations has NO orders KPI",
  !(await page.evaluate(() => document.querySelector("#operations")?.textContent.includes("Total orders")))
)
check(
  "EN operations table has no Orders column",
  !(await page.evaluate(() => document.querySelector("#operations")?.textContent.includes("Orders")))
)
check(
  "EN drone caption",
  await page.evaluate(() => document.querySelector("#operations img[src*='drone']")?.getAttribute("alt")?.includes("Drone view"))
)
check(
  "EN pricing popular badge",
  await page.evaluate(() => document.querySelector("#pricing")?.textContent.includes("Most popular"))
)
check(
  "EN final CTA primary -> #platform",
  (await page.evaluate(() => [...document.querySelectorAll("main a[href='#platform']")].at(-1)?.getAttribute("href"))) === "#platform"
)

// Console errors (allow known favicon 404)
const realErrors = errors.filter((e) => !e.includes("favicon"))
check("No console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "))

console.log(results.join("\n"))
await browser.close()
