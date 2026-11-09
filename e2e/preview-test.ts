import { test as base, expect } from "@playwright/test"
import { installVerificationAccess } from "../scripts/lib/verification-access.mjs"

/** The CI browser requests share the explicit, origin-scoped Preview transport. */
export const test = base.extend<{ previewAccess: void }>({
  previewAccess: [async ({ context }, use) => {
    if (process.env.BASE_URL) await installVerificationAccess(context, process.env.BASE_URL)
    await use()
  }, { auto: true }],
})
export { expect }
export type { Page } from "@playwright/test"
