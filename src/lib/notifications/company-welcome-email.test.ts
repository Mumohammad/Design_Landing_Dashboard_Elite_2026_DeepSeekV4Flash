import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { inspect } from "node:util"
import { sendCompanyConfirmationEmail } from "./company-welcome-email"

const privateDetail = "SYNTHETIC_PRIVATE_DELIVERY_DIAGNOSTIC"
const input = { email: "owner@logging.test", companyName: "Logging fixture", confirmationUrl: "https://auth.example.test/confirm?token=synthetic-confirmation" }

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "synthetic-test-key-not-a-credential")
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://workspace.example.test")
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe("company confirmation delivery diagnostic privacy", () => {
  it("does not consume or log a rejected provider response body", async () => {
    const text = vi.fn(async () => privateDetail), cancel = vi.fn(async () => {})
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 422, text, body: { cancel } })))
    await expect(sendCompanyConfirmationEmail(input)).resolves.toBeUndefined()
    expect(inspect(vi.mocked(console.error).mock.calls, { depth: 8 })).not.toContain(privateDetail)
    expect(text).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
    expect(console.error).toHaveBeenCalled()
  })

  it("keeps delivery exceptions nonblocking without logging their private fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error(privateDetail), { request: { authorization: privateDetail, body: input } }) }))
    await expect(sendCompanyConfirmationEmail(input)).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalled()
    expect(inspect(vi.mocked(console.error).mock.calls, { depth: 8 })).not.toContain(privateDetail)
    expect(inspect(vi.mocked(console.error).mock.calls, { depth: 8 })).not.toContain(input.confirmationUrl)
  })

  it("treats an unreadable rejected response stream as a nonblocking failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, body: { cancel: async () => { throw new Error(privateDetail) } } })))
    await expect(sendCompanyConfirmationEmail(input)).resolves.toBeUndefined()
    expect(inspect(vi.mocked(console.error).mock.calls, { depth: 8 })).not.toContain(privateDetail)
  })
})
