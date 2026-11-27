import { describe, expect, it } from "vitest"
import { documentHealth } from "./document-health"
const today = "2026-11-01", row = { expiry_date: "2026-12-15", is_verified: true, file_url: "tenant/synthetic.pdf" }
describe("document readiness", () => {
  it("does not classify an unverified or missing file as valid", () => {
    expect(documentHealth(true, { ...row, is_verified: false }, today).state).toBe("unverified")
    expect(documentHealth(true, { ...row, file_url: null }, today).state).toBe("unverified")
  })
  it("requires expiry for documents that expire", () => {
    expect(documentHealth(true, { ...row, expiry_date: null }, today).state).toBe("no_expiry")
    expect(documentHealth(false, { ...row, expiry_date: null }, today).state).toBe("valid")
    expect(documentHealth(true, { ...row, expiry_date: "2026-02-31" }, today).state).toBe("no_expiry")
  })
  it("keeps missing, expired, expiring and verified current documents distinct", () => {
    expect(documentHealth(true, undefined, today).state).toBe("missing")
    expect(documentHealth(true, { ...row, expiry_date: "2026-10-31" }, today).state).toBe("expired")
    expect(documentHealth(true, { ...row, expiry_date: "2026-11-20" }, today).state).toBe("expiring")
    expect(documentHealth(true, row, today).state).toBe("valid")
  })
})
