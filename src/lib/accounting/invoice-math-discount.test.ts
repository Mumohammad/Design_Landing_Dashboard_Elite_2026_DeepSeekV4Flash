import { describe, expect, it } from "vitest"
import { applyInvoiceDiscount, computeInvoiceTotals, percentDiscount } from "./invoice-math"

const l = (q: number, p: number, d = 0) => ({ description: "x", quantity: q, unit_price: p, discount: d, vat_rate: 15 })

describe("invoice-level discount", () => {
  it("distributes an amount pro-rata before VAT", () => {
    const out = applyInvoiceDiscount([l(1, 100), l(1, 300)], { mode: "amount", value: 40 })
    expect(out.map((x) => x.discount)).toEqual([10, 30])
    const t = computeInvoiceTotals(out)
    expect(t.subtotal).toBe(360); expect(t.vat_amount).toBe(54); expect(t.total).toBe(414)
  })
  it("keeps cents exact with remainders", () => {
    const out = applyInvoiceDiscount([l(1, 10), l(1, 10), l(1, 10)], { mode: "amount", value: 1 })
    expect(out.reduce((a, x) => a + Math.round(x.discount * 100), 0)).toBe(100)
  })
  it("supports percent on top of line discounts", () => {
    const out = applyInvoiceDiscount([l(2, 50, 10), l(1, 10)], { mode: "percent", value: 10 })
    expect(computeInvoiceTotals(out).subtotal).toBe(90)
  })
  it("rejects discounts above the invoice value", () => {
    expect(() => applyInvoiceDiscount([l(1, 5)], { mode: "amount", value: 6 })).toThrow()
  })
  it("computes percent line discounts", () => {
    expect(percentDiscount(3, 33.3333, 10)).toBe(10)
  })
})
