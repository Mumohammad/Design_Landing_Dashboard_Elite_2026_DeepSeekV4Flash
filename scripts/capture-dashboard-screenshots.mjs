// Dev helper: capture real full-page screenshots of the app's dashboard pages
// (dashboard, drivers, vehicles) in light + dark mode using system Chrome.
// Output: public/_screens/{page}-{theme}.png (copy into public/ to publish)
//
// Credentials come from /tmp/gm-test-creds.txt (written by create-gm-test-user.mjs)
// so captures always use a freshly created, confirmed GM account.
import { readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import puppeteer from "puppeteer-core"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const BASE = "http://localhost:3000"
const OUT = "C:/Users/Zbook/Downloads/shadcn-dashboard-landing-template-main (1)/shadcn-dashboard-landing-template-main/nextjs-version/public/_screens"

const credsRaw = readFileSync("/tmp/gm-test-creds.txt", "utf8")
const email = credsRaw.match(/email: (.+)/)?.[1] ?? ""
const password = credsRaw.match(/password: (.+)/)?.[1] ?? ""
if (!email || !password) {
  console.error("Missing credentials. Run scripts/create-gm-test-user.mjs first.")
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1000"],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1.5 },
  })

  const page = await browser.newPage()

  // 1. Log in
  await page.goto(`${BASE}/auth/sign-in`, { waitUntil: "networkidle0", timeout: 30000 }).catch(() => {})
  await page.waitForSelector('button[type="submit"]', { timeout: 20000 })
  await sleep(6000) // let React fully hydrate the form
  await page.evaluate(
    ({ email, password }) => {
      const set = (sel, val) => {
        const el = document.querySelector(sel)
        if (!el) throw new Error("input not found: " + sel)
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
        setter.call(el, val)
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
      }
      set('input[type="email"]', email)
      set('input[type="password"]', password)
    },
    { email, password }
  )
  await sleep(500)
  await page.click('button[type="submit"]')
  // Poll until the client-side redirect lands on /dashboard.
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    if (page.url().includes("/dashboard")) break
  }
  await sleep(2000)

  // Confirm we're on the dashboard
  const url = page.url()
  console.log("After login:", url)
  if (!url.includes("/dashboard")) {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 300))
    console.log("Page text:", JSON.stringify(text))
    await page.screenshot({ path: `${OUT}/_login-failed.png` })
    throw new Error("Login did not reach /dashboard: " + url)
  }

  // Dismiss the sidebar welcome notification so screenshots are clean.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Close notification")
    )
    btn?.click()
  })
  await sleep(500)

  // 2. Capture each page in each theme.
  const targets = [
    { path: "/dashboard", name: "dashboard" },
    { path: "/drivers", name: "drivers" },
    { path: "/vehicles", name: "vehicles" },
  ]

  const failures = []
  for (const theme of ["light", "dark"]) {
    for (const t of targets) {
      try {
        // Navigate fresh, then apply the theme, then reload so the whole
        // document renders under the target theme (no partial paint).
        await page.goto(`${BASE}${t.path}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {})
        await sleep(1500)
        await page.evaluate((theme) => {
          localStorage.setItem("elite-ui-theme", theme)
          localStorage.setItem("elite-locale", "en")
          const root = document.documentElement
          root.classList.remove("light", "dark")
          root.classList.add(theme)
        }, theme)
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {})
        await sleep(4000)

        // Wait for skeletons to disappear (data loaded).
        for (let i = 0; i < 20; i++) {
          await sleep(1000)
          const skeletonCount = await page.evaluate(() =>
            document.querySelectorAll('[class*="animate-pulse"], [class*="skeleton"]').length
          )
          if (skeletonCount === 0) break
        }
        await sleep(1500)

        // Remove any open dialogs.
        await page.evaluate(() => {
          document.querySelectorAll("[data-state='open'][role='dialog']").forEach((el) => el.remove())
        })

        const file = `${OUT}/${t.name}-${theme}.png`
        await page.screenshot({ path: file, fullPage: false })
        const size = (await import("node:fs")).statSync(file).size
        console.log(`Saved: ${file} (${(size / 1024).toFixed(0)}KB)`)
      } catch (err) {
        console.error("Capture failed for", t.name, theme + ":", err.message)
        failures.push(`${t.name}-${theme}`)
      }
    }
  }

  await browser.close()
  console.log("Done.", failures.length ? `Failures: ${failures.join(", ")}` : "All captures saved.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
