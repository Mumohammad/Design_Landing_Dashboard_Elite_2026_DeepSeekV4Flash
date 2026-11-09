import { describe, expect, it } from "vitest"
import { isSaudiShortAddress, isValidSaudiId, saudiIdKind } from "./saudi-id"

describe("Saudi identity numbers", () => {
  it("classifies citizens and residents by the first digit", () => {
    expect(saudiIdKind("1000000008")).toBe("citizen")
    expect(saudiIdKind("2000000006")).toBe("resident")
    expect(saudiIdKind("3000000000")).toBeNull()
    expect(saudiIdKind("10000000")).toBeNull()
  })
  it("verifies the check digit", () => {
    expect(isValidSaudiId("1000000008")).toBe(true)
    expect(isValidSaudiId("2000000006")).toBe(true)
    expect(isValidSaudiId("1000000009")).toBe(false)
    expect(isValidSaudiId("2234567890")).toBe(false)
  })
  it("accepts short national addresses", () => {
    expect(isSaudiShortAddress("RRRD2929")).toBe(true)
    expect(isSaudiShortAddress("rrrd 2929")).toBe(true)
    expect(isSaudiShortAddress("RRR2929")).toBe(false)
  })
})
