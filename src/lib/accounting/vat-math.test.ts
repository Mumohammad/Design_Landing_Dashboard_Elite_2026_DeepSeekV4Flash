// Financial Phase 14 — unit tests for the canonical VAT net-position formula
// (TEST-STRATEGY.md §3.1 / §5): the three mock scenarios
// (0 / 5,000 payable / 5,000 receivable) + the adjustment case.
import { describe, expect, it } from "vitest"
import { computeVatNetPosition, netNature } from "./vat-math"

describe("computeVatNetPosition — canonical formula output + adjOut − recIn − adjIn", () => {
  it("scenario 1: fully offset → zero net position", () => {
    expect(computeVatNetPosition(5_000, 0, 5_000, 0)).toBe(0)
  })

  it("scenario 2: output exceeds recoverable input → 5,000 payable", () => {
    expect(computeVatNetPosition(20_000, 0, 15_000, 0)).toBe(5_000)
  })

  it("scenario 3: recoverable input exceeds output → 5,000 receivable", () => {
    expect(computeVatNetPosition(10_000, 0, 15_000, 0)).toBe(-5_000)
  })

  it("includes adjustments in both directions", () => {
    // Phase 12 verification numbers: 20,000 + (−750) − 10,000 − (−125.5) = 9,375.5
    expect(computeVatNetPosition(20_000, -750, 10_000, -125.5)).toBe(9_375.5)
    // Credit note reduces output: −1,500 adjustment pulls the position down.
    expect(computeVatNetPosition(5_000, -1_500, 5_000, 0)).toBe(-1_500)
  })

  it("is exact at 2dp (no float drift)", () => {
    expect(computeVatNetPosition(10_000, -0.5, 9_999.5, 0)).toBe(0)
  })
})

describe("netNature", () => {
  it("classifies positive net as payable", () => {
    expect(netNature(5_000)).toBe("payable")
  })

  it("classifies negative net as receivable", () => {
    expect(netNature(-5_000)).toBe("receivable")
  })

  it("classifies zero as zero", () => {
    expect(netNature(0)).toBe("zero")
  })
})
