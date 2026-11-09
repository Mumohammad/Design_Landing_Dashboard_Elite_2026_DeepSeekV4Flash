import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E test configuration for EliteDev.
 *
 * Tests run against the local dev server by default. For CI, set:
 *   BASE_URL=https://your-staging.vercel.app
 *
 * See: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Sequential — tests may depend on auth state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    // Traces persist request headers, including short-lived OIDC identities.
    // Hosted evidence keeps screenshots/video; disposable local traces remain.
    trace: process.env.BASE_URL?.startsWith("https:") ? "off" : "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start the dev server before running tests (unless BASE_URL is set)
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
})
