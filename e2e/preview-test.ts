import { test as base, expect } from "@playwright/test"
import type { BrowserContextOptions } from "@playwright/test"
import { createVerificationBrowserProxy, installVerificationAccess } from "../scripts/lib/verification-access.mjs"

/** The CI browser requests share the explicit, origin-scoped Preview transport. */
type PreviewProxy = { contextOptions: BrowserContextOptions; close: () => Promise<void> } | null
export const test = base.extend<{ previewAccess: void }, { previewProxy: PreviewProxy }>({
  previewProxy: [async ({}, provide) => {
    const proxy = process.env.BASE_URL ? await createVerificationBrowserProxy(process.env.BASE_URL) : null
    try { await provide(proxy) } finally { await proxy?.close() }
  }, { scope: "worker" }],
  contextOptions: async ({ contextOptions, previewProxy }, provide) => {
    await provide({ ...contextOptions, ...previewProxy?.contextOptions })
  },
  previewAccess: [async ({ context, previewProxy }, use) => {
    // Keep native transport mandatory even if a test overrides contextOptions.
    void previewProxy
    if (process.env.BASE_URL) await installVerificationAccess(context, process.env.BASE_URL)
    await use()
  }, { auto: true }],
})
export { expect }
export type { Page } from "@playwright/test"
