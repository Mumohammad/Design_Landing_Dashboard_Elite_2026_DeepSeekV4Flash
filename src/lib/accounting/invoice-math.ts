// Decimal-safe invoice math — pure module, single source of truth for the
// canonical totals formula (migration 038). No server-only imports, so it is
// import-safe anywhere (server actions, client previews, unit tests).
//
// Canonical math (migration 038):
//   line_amount = round2(quantity × unit_price) − discount   (line net)
//   line_vat    = round2(line_amount × vat_rate / 100)      (per line)
//   subtotal    = Σ line_amount   ·   vat_amount = Σ line_vat
//   total       = round2(subtotal + vat_amount)
// All money passes through 2dp integer-minor arithmetic — no float drift.

import { calculateVat, decimalRound, multiplyMoney, sumMoney } from "./decimal"

export type InvoiceLineInput = {
  description: string
  quantity: number
  unit_price: number
  discount?: number
  vat_rate?: number
}

export interface ComputedInvoiceLine {
  line_no: number
  description: string
  quantity: number
  unit_price: number
  discount: number
  amount: number
  vat_rate: number
  vat_amount: number
}

export interface ComputedInvoiceTotals {
  lines: ComputedInvoiceLine[]
  subtotal: number
  discount: number
  vat_amount: number
  total: number
}

/** PostgreSQL numeric-compatible rounding, including negative half cents. */
export const round2 = (n: number): number => decimalRound(n)

/** Compute line totals + invoice totals. Throws Error(code) on bad input.
 * Lines without an explicit vat_rate fall back to `defaultVatRate`. */
export function computeInvoiceTotals(
  lines: InvoiceLineInput[],
  defaultVatRate = 15
): ComputedInvoiceTotals {
  if (!lines || lines.length === 0) {
    throw new Error("INV013: invoice needs at least one line")
  }
  let subtotal = 0
  let discount = 0
  let vat = 0
  const computed = lines.map((l, i) => {
    const qty = Number(l.quantity)
    const price = Number(l.unit_price)
    const rawDiscount = Number(l.discount ?? 0)
    const disc = Number.isFinite(rawDiscount) ? round2(rawDiscount) : rawDiscount
    const vatRate = Number(l.vat_rate ?? defaultVatRate)
    const desc = (l.description ?? "").trim()
    if (!desc) throw new Error("INV002: line description is required")
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("INV002: quantity must be positive")
    if (!Number.isFinite(price) || price < 0) throw new Error("INV002: unit price cannot be negative")
    if (!Number.isFinite(rawDiscount) || rawDiscount < 0) throw new Error("INV002: discount cannot be negative")
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      throw new Error("INV002: VAT rate must be between 0 and 100")
    }
    // Match the persisted numeric(12,3)/(12,2)/(5,2) values before computing.
    const storedQty = decimalRound(qty, 3)
    const storedPrice = round2(price)
    const storedRate = round2(vatRate)
    if (storedQty <= 0 || storedQty >= 1_000_000_000 || storedPrice >= 10_000_000_000) {
      throw new Error("INV002: line value exceeds database precision")
    }
    const gross = multiplyMoney(storedQty, storedPrice)
    if (disc > gross) throw new Error("INV002: discount exceeds line gross amount")
    const amount = sumMoney(gross, -disc)
    const vatAmount = calculateVat(amount, storedRate)
    subtotal = sumMoney(subtotal, amount)
    discount = sumMoney(discount, disc)
    vat = sumMoney(vat, vatAmount)
    if ([gross, subtotal, discount, vat, sumMoney(subtotal, vat)].some(value => value >= 10_000_000_000)) {
      throw new Error("INV002: invoice value exceeds database precision")
    }
    return {
      line_no: i + 1,
      description: desc,
      quantity: storedQty,
      unit_price: storedPrice,
      discount: disc,
      amount,
      vat_rate: storedRate,
      vat_amount: vatAmount,
    }
  })
  const s = round2(subtotal)
  const v = round2(vat)
  return {
    lines: computed,
    subtotal: s,
    discount: round2(discount),
    vat_amount: v,
    total: sumMoney(s, v),
  }
}
