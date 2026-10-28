// Public-surface E2E: landing structure and responsiveness, unauthenticated
// route guards, and the driver application entry/resume flow. None of these
// tests need credentials, so they are safe for every hosted staging run.

import { test, expect } from "@playwright/test"
import { assertStagingTarget } from "./staging-target"

test.beforeAll(async ({ request }) => assertStagingTarget(request))

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]

test.describe("Landing page", () => {
  test("has a single h1 on the first screen and a heading for each section", async ({ page }) => {
    await page.goto("/landing")
    const h1 = page.locator("h1")
    await expect(h1).toHaveCount(1)
    await expect(h1).toBeInViewport()
    const sectionsWithoutHeading = await page.locator("main section").evaluateAll((sections) =>
      sections.filter((section) => !section.querySelector("h1, h2, h3")).length,
    )
    expect(sectionsWithoutHeading).toBe(0)
  })

  test("in-page navigation anchors point to existing sections", async ({ page }) => {
    await page.goto("/landing")
    const missing = await page.locator('a[href^="#"]').evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href") ?? "")
        .filter((href) => href.length > 1 && !document.getElementById(decodeURIComponent(href.slice(1)))),
    )
    expect(missing).toEqual([])
  })

  for (const viewport of VIEWPORTS) {
    test(`has no horizontal overflow at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto("/landing")
      await page.waitForLoadState("load")
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    })
  }

  test("sets a document direction that matches the language", async ({ page }) => {
    await page.goto("/landing")
    const lang = await page.getAttribute("html", "lang")
    const dir = await page.getAttribute("html", "dir")
    expect(dir).toBe(lang === "ar" || lang === "ur" ? "rtl" : "ltr")
  })
})

test.describe("Route guards (signed out)", () => {
  for (const path of ["/dashboard", "/drivers", "/invoices", "/payroll", "/accounting", "/settings"]) {
    test(`${path} redirects to sign-in with a return path`, async ({ page }) => {
      await page.context().clearCookies()
      await page.goto(path)
      await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
      expect(new URL(page.url()).searchParams.get("returnTo")).toBe(path)
    })
  }

  test("sign-in rejects off-site return paths", async ({ page }) => {
    await page.goto("/auth/sign-in?returnTo=https://example.com/steal")
    await expect(page.getByLabel(/email|البريد الإلكتروني/i)).toBeVisible({ timeout: 15_000 })
    expect(new URL(page.url()).hostname).not.toBe("example.com")
  })
})

test.describe("Driver application", () => {
  test("malformed tenant slugs return not found before any lookup", async ({ page }) => {
    // The root loading boundary streams the shell first, so Next.js renders
    // the not-found UI with HTTP 200; assert on the rendered state instead.
    await page.goto(`/apply/${encodeURIComponent("BAD_SLUG!!")}`)
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible()
  })

  test("unknown tenant slugs return not found", async ({ page }) => {
    test.skip(!process.env.BASE_URL, "Needs a hosted target with a real tenant directory")
    await page.goto("/apply/no-such-tenant-e2e")
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible()
  })

  const slug = process.env.E2E_TENANT_SLUG
  test("welcome screen starts the application and never shows a stale resume panel", async ({ page }) => {
    test.skip(!slug, "Set E2E_TENANT_SLUG to a staging tenant that accepts applications")
    await page.context().clearCookies()
    await page.goto(`/apply/${slug}`)
    await expect(page.locator("h1")).toBeVisible()
    await expect(page.getByTestId("registration-resume")).toHaveCount(0)
    await page.getByRole("button").filter({ hasText: /start|ابدأ|شروع|শুরু/i }).first().click()
    await expect(page.locator("form, [role='form']").first()).toBeVisible({ timeout: 15_000 })
  })

  test("a tampered saved-application cookie is ignored", async ({ page, baseURL }) => {
    test.skip(!slug, "Set E2E_TENANT_SLUG to a staging tenant that accepts applications")
    const url = new URL(baseURL ?? "http://localhost:3000")
    await page.context().addCookies([{ name: "driver-application-draft", value: "tampered.value", domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax", secure: url.protocol === "https:" }])
    await page.goto(`/apply/${slug}`)
    await expect(page.locator("h1")).toBeVisible()
    await expect(page.getByTestId("registration-resume")).toHaveCount(0)
  })
})
