// Prompt M2 — recharts zero-size regression guard.
//
// recharts logs "width(-1) and height(-1) of chart should be greater than 0"
// when a ResponsiveContainer mounts inside a hidden / not-yet-laid-out
// container. ChartContainer and the KPI sparkline now gate the chart mount
// on a MEASURED container size (ResizeObserver), so this spec asserts the
// warning class can never appear on the chart-bearing surfaces.

import { test as base, expect, type Page } from "@playwright/test"

const test = base.extend<{ authed: Page }>({
  authed: async ({ page }, use) => {
    const email = process.env.TEST_USER_EMAIL ?? "admin@elitedev.com.sa"
    const password = process.env.TEST_USER_PASSWORD ?? "Test1234!"

    const login = async () => {
      await page.goto("/auth/sign-in", { waitUntil: "domcontentloaded", timeout: 40_000 })
      await page.locator("button[type=submit]").waitFor({ state: "visible", timeout: 30_000 })
      await page.waitForTimeout(1_500)
      await page.locator('input[type="email"], input[name="email"]').first().fill(email)
      await page.locator('input[type="password"]').first().fill(password)
      await page.locator("button[type=submit]").click()
      await page.waitForURL(/\/dashboard|\/landing|\/settings\/mfa/, { timeout: 45_000 })
    }
    try {
      await login()
    } catch {
      await login()
    }
    await use(page) // eslint-disable-line react-hooks/rules-of-hooks -- Playwright fixture `use`, not React
  },
})

const CHART_ROUTES = ["/dashboard", "/dashboard-2", "/reports", "/payroll"]

test.describe("Prompt M2 — chart mounts are size-gated", () => {
  for (const route of CHART_ROUTES) {
    test(`no recharts zero-size warnings on ${route}`, async ({ authed: page }) => {
      const sizeWarnings: string[] = []
      page.on("console", (msg) => {
        if (/width\(-1\)|height\(-1\)|should be greater than 0/i.test(msg.text())) {
          sizeWarnings.push(msg.text().slice(0, 200))
        }
      })

      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 40_000 })
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
      // Give the measured-size gate and any stagger animations time to settle.
      await page.waitForTimeout(4_000)

      expect(sizeWarnings, `recharts size warnings on ${route}:\n${sizeWarnings.join("\n")}`).toEqual([])
    })
  }
})
