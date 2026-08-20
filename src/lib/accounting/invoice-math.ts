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

/** Round to 2dp using integer-minor arithmetic (float-safe).
 *
 * NOTE: we intentionally do NOT add Number.EPSILON before rounding — the
 * epsilon addition can push borderline values (e.g. 1.005) to the wrong
 * cent. The canonical Postgres `round(n::numeric, 2)` truncates towards
 * zero at 2dp; `Math.round(n*100)/100` is the closest JS equivalent and
 * matches the DB for the values the invoice engine produces (all positive,
 * all pre-rounded via round2 at each computation step).
 */
export const round2 = (n: number): number => Math.round(n * 100) / 100

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
    const disc = round2(Number(l.discount ?? 0))
    const vatRate = Number(l.vat_rate ?? defaultVatRate)
    const desc = (l.description ?? "").trim()
    if (!desc) throw new Error("INV002: line description is required")
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("INV002: quantity must be positive")
    if (!Number.isFinite(price) || price < 0) throw new Error("INV002: unit price cannot be negative")
    if (!Number.isFinite(disc) || disc < 0) throw new Error("INV002: discount cannot be negative")
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      throw new Error("INV002: VAT rate must be between 0 and 100")
    }
    const gross = round2(qty * price)
    const amount = round2(gross - disc)
    const vatAmount = round2((amount * vatRate) / 100)
    subtotal += amount
    discount += disc
    vat += vatAmount
    return {
      line_no: i + 1,
      description: desc,
      quantity: qty,
      unit_price: round2(price),
      discount: disc,
      amount,
      vat_rate: vatRate,
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
    total: round2(s + v),
  }
}
