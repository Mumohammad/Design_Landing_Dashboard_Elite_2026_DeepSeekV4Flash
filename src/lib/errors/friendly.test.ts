import { describe, expect, it } from "vitest"
import { friendlyError } from "./friendly"

describe("friendlyError", () => {
  it("maps known codes in both languages", () => {
    expect(friendlyError("PAY_INPUTS_UNREVIEWED", false)).toMatch(/Lock the month's attendance/)
    expect(friendlyError("PAY_INPUTS_UNREVIEWED", true)).toMatch(/الحضور|حضور/)
    expect(friendlyError("FLT005: record changed; reload before saving", true)).toMatch(/أعد التحميل/)
  })
  it("uses the readable part of CODE: message when unmapped", () => {
    expect(friendlyError("FLT027: document type cannot change; upload a replacement", false)).toBe("Document type cannot change; upload a replacement")
  })
  it("falls back to suffix rules and then a support message", () => {
    expect(friendlyError("EVIDENCE_STALE", false)).toMatch(/Reload/)
    expect(friendlyError("LEAVE_FORBIDDEN", false)).toMatch(/permission/)
    expect(friendlyError("ZZZ_WEIRD9", false)).toMatch(/could not be completed \(ZZZ_WEIRD9\)/)
  })
  it("leaves human sentences and empty values sensible", () => {
    expect(friendlyError("Rate limit exceeded. Try again later.", false)).toBe("Rate limit exceeded. Try again later.")
    expect(friendlyError("VAT number is invalid", false)).toBe("VAT number is invalid")
    expect(friendlyError("", false, "Save failed")).toBe("Save failed")
  })
})
