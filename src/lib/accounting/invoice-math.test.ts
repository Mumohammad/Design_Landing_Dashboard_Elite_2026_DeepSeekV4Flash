// Financial Phase 14 — unit tests for the canonical invoice math
// (TEST-STRATEGY.md §3.1). Money is asserted exactly — never via float
// tolerance — because the module uses integer-minor arithmetic.
import { describe, expect, it } from "vitest"
import { computeInvoiceTotals, round2 } from "./invoice-math"

describe("round2 (integer-minor rounding)", () => {
  it("rounds float artifacts exactly", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(2.5)).toBe(2.5)
    expect(round2(2.999)).toBe(3)
  })

  it("is stable across repeated application", () => {
    expect(round2(round2(0.1) + round2(0.2))).toBe(0.3)
  })
})

// Manual receivable action persistence is exercised in receivable-actions.test.ts.
describe("invoice VAT rounding boundaries", () => {
  it("matches Postgres rounding for edge values", () => {
    const invoice = computeInvoiceTotals([{ description: "VAT boundary", quantity: 1, unit_price: 4.1 }])
    expect(invoice.vat_amount).toBe(0.62)
    expect(invoice.total).toBe(4.72)
    expect(computeInvoiceTotals([{ description: "Quantity boundary", quantity: 1.005, unit_price: 1, vat_rate: 0 }]).total).toBe(1.01)
  })
})

describe("computeInvoiceTotals — standard VAT (15%)", () => {
  it("computes the canonical mock invoice A (100,000 / 15,000 / 115,000)", () => {
    const r = computeInvoiceTotals([{ description: "خدمات نقل", quantity: 1, unit_price: 100_000 }])
    expect(r.subtotal).toBe(100_000)
    expect(r.vat_amount).toBe(15_000)
    expect(r.total).toBe(115_000)
    expect(r.discount).toBe(0)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ amount: 100_000, vat_amount: 15_000, vat_rate: 15 })
  })

  it("sums per-line VAT rather than VAT on the summed subtotal (canonical rule)", () => {
    // 3 × 33.33 = 99.99 → VAT 14.9985 → 15.00 ; 2 × 10 = 20 → VAT 3.00
    const r = computeInvoiceTotals([
      { description: "خط 1", quantity: 3, unit_price: 33.33 },
      { description: "خط 2", quantity: 2, unit_price: 10 },
    ])
    expect(r.subtotal).toBe(119.99)
    expect(r.vat_amount).toBe(18.0)
    expect(r.total).toBe(137.99)
    expect(r.lines[0].vat_amount).toBe(15.0)
    expect(r.lines[1].vat_amount).toBe(3.0)
  })

  it("applies the default VAT rate when a line omits vat_rate", () => {
    const r = computeInvoiceTotals([{ description: "خدمات", quantity: 1, unit_price: 1_000 }], 5)
    expect(r.vat_amount).toBe(50)
    expect(r.total).toBe(1_050)
  })
})

describe("computeInvoiceTotals — zero VAT", () => {
  it("produces total = subtotal when vat_rate is 0", () => {
    const r = computeInvoiceTotals([{ description: "خدمات معفاة", quantity: 1, unit_price: 500, vat_rate: 0 }])
    expect(r.vat_amount).toBe(0)
    expect(r.total).toBe(500)
    expect(r.lines[0].vat_rate).toBe(0)
  })
})

describe("computeInvoiceTotals — discount", () => {
  it("deducts the discount from the line amount before VAT", () => {
    const r = computeInvoiceTotals([{ description: "خدمات", quantity: 1, unit_price: 1_000, discount: 100 }])
    expect(r.lines[0].amount).toBe(900)
    expect(r.lines[0].vat_amount).toBe(135)
    expect(r.subtotal).toBe(900)
    expect(r.discount).toBe(100)
    expect(r.total).toBe(1_035)
  })
})

describe("computeInvoiceTotals — validation (INV codes)", () => {
  it("rejects an empty line set with INV013", () => {
    expect(() => computeInvoiceTotals([])).toThrow("INV013")
  })

  it("rejects missing/blank descriptions with INV002", () => {
    expect(() => computeInvoiceTotals([{ description: "   ", quantity: 1, unit_price: 10 }])).toThrow("INV002")
    expect(() => computeInvoiceTotals([{ description: "", quantity: 1, unit_price: 10 }])).toThrow("INV002")
  })

  it("rejects non-positive quantity with INV002", () => {
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: 0, unit_price: 10 }])).toThrow("INV002")
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: -2, unit_price: 10 }])).toThrow("INV002")
  })

  it("rejects negative unit price / discount with INV002", () => {
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: 1, unit_price: -5 }])).toThrow("INV002")
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: 1, unit_price: 5, discount: -1 }])).toThrow("INV002")
  })

  it("rejects out-of-range VAT rates with INV002", () => {
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: 1, unit_price: 5, vat_rate: -1 }])).toThrow("INV002")
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: 1, unit_price: 5, vat_rate: 101 }])).toThrow("INV002")
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: 1, unit_price: 5, vat_rate: Number.NaN }])).toThrow("INV002")
  })

  it("rejects non-finite money values with INV002 (NaN trap)", () => {
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: 1, unit_price: Number.POSITIVE_INFINITY }])).toThrow("INV002")
    expect(() => computeInvoiceTotals([{ description: "أ", quantity: Number.NaN, unit_price: 5 }])).toThrow("INV002")
  })
})


describe("invoice storage precision and limits", () => {
  const line = { description: "Service", quantity: 1, unit_price: 10 }
  it.each([
    { quantity: 0.0001 }, { unit_price: 1.005 }, { discount: 0.001 },
    { vat_rate: 15.001 }, { discount: 11 }, { quantity: 1e9 },
    { unit_price: 1e10 }, { description: "x".repeat(1001) },
  ])("rejects invalid line %j", (patch) => {
    expect(() => computeInvoiceTotals([{ ...line, ...patch }])).toThrow("INV002")
  })
  it("rejects total overflow even when each line fits", () => {
    expect(() => computeInvoiceTotals([{ ...line, unit_price: 9999999999.99 }])).toThrow("INV002")
  })
  it("supports the largest storable zero-rated total exactly", () => {
    expect(computeInvoiceTotals([{ ...line, unit_price: 9999999999.99, vat_rate: 0 }]).total).toBe(9999999999.99)
  })
  it("rejects more than 200 lines", () => {
    expect(() => computeInvoiceTotals(Array.from({ length: 201 }, () => line))).toThrow("INV013")
  })
})
