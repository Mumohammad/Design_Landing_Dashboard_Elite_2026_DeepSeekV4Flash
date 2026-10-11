import { test, expect } from "@playwright/test"

test.describe("public platform entry and shared language", () => {
  test("landing has one visible sign-in entry on desktop and mobile", async ({ page }) => {
    await page.goto("/landing?lang=en")
    const signIn = page.getByRole("link", { name: "Sign In", exact: true })
    await expect(signIn).toHaveCount(1)
    await expect(signIn).toBeVisible()
    await expect(signIn).toHaveAttribute("href", /\/platform\?lang=en$/)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole("button", { name: "Menu", exact: true }).click()
    await expect(signIn).toHaveCount(1)
    await expect(signIn).toBeVisible()
  })
  test("language switch updates shared navigation, direction and persisted preference", async ({ page }) => {
    await page.goto("/landing?lang=en")
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr")
    await page.locator("header").getByRole("button", { name: "Toggle language" }).click()
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expect(page.getByRole("link", { name: "تسجيل الدخول", exact: true })).toHaveCount(1)
    // A language query is an explicit override; test persistence without it.
    await page.goto("/landing")
    await expect(page.locator("html")).toHaveAttribute("lang", "ar")
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  })
  test("sign-in passes through platform to the supported auth and recovery forms", async ({ page }) => {
    await page.goto("/landing?lang=en")
    await page.getByRole("link", { name: "Sign In", exact: true }).click()
    await expect(page).toHaveURL(/\/platform\?lang=en$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your company's workspace")
    await page.getByRole("link", { name: "Sign in", exact: true }).click()
    await expect(page).toHaveURL(/\/auth\/sign-in\?lang=en$/)
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible()
    await page.getByRole("link", { name: /forgot.*password/i }).click()
    await expect(page).toHaveURL(/\/auth\/forgot-password/)
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible()
  })
  test("registration remains reachable through platform without submitting data", async ({ page }) => {
    await page.goto("/platform?lang=en")
    await page.getByRole("link", { name: "Register your company", exact: true }).click()
    await expect(page).toHaveURL(/\/platform\/register\?lang=en$/)
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })
  test("anonymous accounting access redirects to supported sign-in", async ({ page }) => {
    await page.goto("/accounting")
    await expect(page).toHaveURL(/\/auth\/sign-in\?returnTo=%2Faccounting/)
  })
})
