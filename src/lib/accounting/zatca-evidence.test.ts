import { describe, expect, it } from "vitest"
import { isMockZatcaResponse, zatcaEvidenceLabel } from "./zatca-evidence"

describe("ZATCA evidence display", () => {
  it("identifies historical mocks even when their recorded status is reported", () => {
    expect(isMockZatcaResponse({sandbox:true,status:"reported"})).toBe(true)
    expect(isMockZatcaResponse({mock:true,status:"cleared"})).toBe(true)
    expect(zatcaEvidenceLabel(true,false)).toBe("Mock — not submitted")
    expect(zatcaEvidenceLabel(true,true)).toContain("لم تُرسل")
  })

  it("does not infer authority acceptance from missing or status-only evidence", () => {
    for (const input of [null,undefined,[],"true",{sandbox:"true"},{status:"cleared"}]) {
      expect(isMockZatcaResponse(input)).toBe(false)
    }
    expect(zatcaEvidenceLabel(false,false)).toBe("Unverified record")
  })
})
