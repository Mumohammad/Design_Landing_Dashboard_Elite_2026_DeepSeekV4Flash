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
  item_name?: string | null
  description: string
  quantity: number
  unit_price: number
  discount?: number
  vat_rate?: number
}

export interface ComputedInvoiceLine {
  item_name?: string | null
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

const ZERO = BigInt(0)
const TEN = BigInt(10)
const MAX_CENTS = BigInt("999999999999") // NUMERIC(12,2)

/** Parse the decimal representation before arithmetic, including exponents.
 * PostgreSQL numeric rounds ties away from zero. Strict mode rejects precision
 * that the database would otherwise silently round on insertion. */
function scaled(n: number, places: number, strict = false): bigint {
  if (!Number.isFinite(n)) throw new Error("INV002: finite numeric value required")
  const [mantissa, exponent = "0"] = Math.abs(n).toString().split("e")
  const [whole, fraction = ""] = mantissa.split(".")
  let value = BigInt(whole + fraction)
  const shift = places + Number(exponent) - fraction.length
  if (shift >= 0) value *= TEN ** BigInt(shift)
  else {
    const divisor = TEN ** BigInt(-shift)
    if (strict && value % divisor !== ZERO) throw new Error("INV002: too many decimal places")
    value = (value + divisor / BigInt(2)) / divisor
  }
  return n < 0 ? -value : value
}

export const round2 = (n: number): number => Number(scaled(n, 2)) / 100

function bounded(n: number, places: number, min: number, max: number): bigint {
  if (!Number.isFinite(n) || n < min || n > max) throw new Error("INV002: numeric value out of range")
  return scaled(n, places, true)
}

function money(cents: bigint): number {
  if (cents < ZERO || cents > MAX_CENTS) throw new Error("INV002: monetary value out of range")
  return Number(cents) / 100
}

/** Compute line totals + invoice totals. Throws Error(code) on bad input.
 * Lines without an explicit vat_rate fall back to `defaultVatRate`. */
export function computeInvoiceTotals(
  lines: InvoiceLineInput[],
  defaultVatRate = 15
): ComputedInvoiceTotals {
  if (!lines || lines.length === 0 || lines.length > 200) {
    throw new Error("INV013: invoice needs between 1 and 200 lines")
  }
  bounded(defaultVatRate, 2, 0, 100)
  let subtotal = ZERO
  let discount = ZERO
  let vat = ZERO
  const computed = lines.map((l, i) => {
    const qty = Number(l.quantity)
    const price = Number(l.unit_price)
    const disc = Number(l.discount ?? 0)
    const vatRate = Number(l.vat_rate ?? defaultVatRate)
    const desc = (l.description ?? "").trim()
    if (!desc || desc.length > 1000) throw new Error("INV002: line description must contain 1–1000 characters")
    const qtyMills = bounded(qty, 3, 0.001, 999999999.999)
    if (l.item_name != null && (typeof l.item_name !== "string" || l.item_name.trim().length > 200)) throw new Error("INV002: item name must contain at most 200 characters")
    const itemName = l.item_name?.trim() || null
    const priceUnits = bounded(price, 4, 0, 9999999999.99)
    const discountCents = bounded(disc, 2, 0, 9999999999.99)
    const rateBasis = bounded(vatRate, 2, 0, 100)
    // Quantity uses 3dp and unit price 4dp; round their product once to cents.
    const gross = (qtyMills * priceUnits + BigInt(50000)) / BigInt(100000)
    const amount = gross - discountCents
    if (amount < ZERO) throw new Error("INV002: discount exceeds line value")
    const vatAmount = (amount * rateBasis + BigInt(5000)) / BigInt(10000)
    subtotal += amount
    discount += discountCents
    vat += vatAmount
    return {
      line_no: i + 1,
      ...(itemName ? { item_name: itemName } : {}),
      description: desc,
      quantity: qty,
      unit_price: price,
      discount: disc,
      amount: money(amount),
      vat_rate: vatRate,
      vat_amount: money(vatAmount),
    }
  })
  return {
    lines: computed,
    subtotal: money(subtotal),
    discount: money(discount),
    vat_amount: money(vat),
    total: money(subtotal + vat),
  }
}
