import { test, expect, type Page } from "@playwright/test"
import { translations } from "../src/lib/i18n/translations"
import { assertStagingTarget } from "./staging-target"

test.beforeAll(async ({ request }) => assertStagingTarget(request))

test("landing, company pages and auth share one language without reloading", async ({ page }) => {
  await page.goto("/landing?lang=en")
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.getByRole("heading", { name: "Simple plans for every fleet size" })).toBeVisible()
  await expect(page.locator("footer").getByRole("link", { name: "Privacy policy", exact: true })).toBeVisible()
  await expect(page.getByRole("navigation").getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.getByRole("button", { name: "Menu", exact: true }).click()
    await expect(page.locator("#landing-mobile-menu").getByRole("link", { name: "Pricing", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Menu", exact: true }).click()
  }
  await page.setViewportSize({ width: 1280, height: 1000 })
  let navigations = 0
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++ })
  await page.getByRole("button", { name: "تغيير اللغة إلى العربية", exact: true }).first().click()
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await expect(page.getByRole("heading", { name: "خطط بسيطة لأي حجم أسطول" })).toBeVisible()
  expect(navigations).toBe(0)
  await page.getByRole("button", { name: "Switch language to English", exact: true }).first().click()
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.getByRole("heading", { name: "Simple plans for every fleet size" })).toBeVisible()

  await page.goto("/platform")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your company's workspace")
  await page.goto("/platform/register")
  await expect(page.getByRole("heading", { name: "Create your company's workspace" })).toBeVisible()
  await page.goto("/auth/sign-in")
  await expect(page.getByLabel(/^Email$/i)).toBeVisible()
  await expect(page.getByRole("button", { name: "تغيير اللغة إلى العربية", exact: true })).toBeVisible()
})

test("language changes synchronize between existing tabs", async ({ page, context }) => {
  await page.goto("/landing?lang=en")
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  const other = await context.newPage()
  await other.goto("/landing")
  await expect(other.locator("html")).toHaveAttribute("lang", "en")
  await page.getByRole("button", { name: "تغيير اللغة إلى العربية", exact: true }).first().click()
  await expect(other.locator("html")).toHaveAttribute("lang", "ar")
  await expect(other.getByRole("heading", { name: "خطط بسيطة لأي حجم أسطول" })).toBeVisible()
  await other.close()
})

test("language selection works when browser persistence is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === "elite-locale") throw new DOMException("Storage is blocked", "SecurityError")
      return original.call(this, key, value)
    }
  })
  await page.goto("/landing")
  await page.getByRole("button", { name: "Switch language to English", exact: true }).first().click()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(page.getByRole("heading", { name: "Simple plans for every fleet size" })).toBeVisible()
})

async function signIn(page: Page) {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  if (!email || !password) throw new Error("Isolated staging credentials are required")
  await page.goto("/auth/sign-in?lang=en")
  await page.getByLabel(/^Email$/i).fill(email)
  await page.getByLabel(/^Password$/i).fill(password)
  await page.getByRole("button", { name: /^Sign in$/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
}

test("one sign-in survives landing visits and legacy login entry points", async ({ page }) => {
  let signIns = 0
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/auth/sign-in") signIns++ })
  await signIn(page)
  for (const path of ["/landing", "/platform/login", "/auth/sign-in?returnTo=%2Finvoices"]) {
    await page.goto(path)
    if (path === "/landing") {
      await page.getByRole("navigation").getByRole("link", { name: "Sign in", exact: true }).first().click()
    }
    await expect(page).toHaveURL(/\/(dashboard|invoices)(?:\?|$)/)
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
  }
  expect(signIns).toBe(1)
})

test("every business module loads in both interface languages", async ({ page }) => {
  test.setTimeout(420_000)
  await signIn(page)
  const runtimeErrors: string[] = []
  page.on("pageerror", error => runtimeErrors.push(error.name))
  const failedReads: Array<{ path: string; status: number }> = []
  page.on("response", response => {
    const url = new URL(response.url())
    if (response.status() >= 400 && response.request().method() === "GET" &&
      (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/api/"))) {
      failedReads.push({ path: url.pathname, status: response.status() })
    }
  })
  const modules = [
    ["/dashboard", "dashboard"], ["/drivers", "drivers"], ["/vehicles", "vehicles"],
    ["/attendance", "attendance"], ["/orders", "orders"], ["/platforms", "platforms"],
    ["/payroll", "payroll"], ["/expenses", "expenses"], ["/invoices", "invoices"],
    ["/accounting", "accounting"], ["/payments", "payments"], ["/maintenance", "maintenance"],
    ["/violations", "violations"], ["/hr", "hrManagement"], ["/applications", "applications"],
    ["/reports", "reports"], ["/users", "users"], ["/roles", "roles"],
    ["/approvals", "approvals"], ["/audit-log", "auditLog"], ["/security", "security"], ["/settings", "settings"],
  ] as const
  for (const locale of ["en", "ar"] as const) {
    for (const [path, label] of modules) {
      await page.goto(`${path}?lang=${locale}`)
      await expect(page.locator("html")).toHaveAttribute("lang", locale)
      const heading = path === "/dashboard" ? translations[locale].app.dashboardTitle
        : path === "/approvals" ? (locale === "ar" ? "صندوق القرارات" : "Approvals Inbox")
        : translations[locale].nav[label]
      await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(heading)
      await page.waitForLoadState("networkidle", { timeout: 20_000 })
      await expect(page.getByText("Unable to load this module", { exact: true })).toHaveCount(0)
      await expect(page.getByText("تعذّر تحميل هذه الوحدة", { exact: true })).toHaveCount(0)
    }
  }
  await page.goto("/orders?lang=en")
  for (const month of ["2026-02", "2028-02", "2026-04"]) {
    const loaded = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === "/rest/v1/daily_order_entries" &&
        url.searchParams.getAll("entry_date").some(value => value.includes(`${month}-01`))
    })
    await page.locator('input[type="month"]').fill(month)
    expect((await loaded).ok()).toBe(true)
  }
  expect(failedReads).toEqual([])
  expect(runtimeErrors).toEqual([])
})
