// Exact base-10 arithmetic. Numbers are accepted at existing UI boundaries,
// but never multiplied or accumulated using binary floating-point arithmetic.
export type DecimalInput = number | string
type Decimal = { coefficient: bigint; scale: number }
const ZERO = BigInt(0)
const TWO = BigInt(2)
const TEN = BigInt(10)

function parse(value: DecimalInput): Decimal {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid decimal")
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i)
  if (!match) throw new Error("Invalid decimal")
  const exponent = Number(match[4] ?? 0)
  const fraction = match[3] ?? ""
  const scale = fraction.length - exponent
  if (Math.abs(scale) > 100) throw new Error("Decimal out of range")
  const coefficient = BigInt(`${match[1]}${match[2]}${fraction}`)
  return scale < 0
    ? { coefficient: coefficient * TEN ** BigInt(-scale), scale: 0 }
    : { coefficient, scale }
}

function quantize(value: Decimal, scale: number): bigint {
  if (value.scale <= scale) return value.coefficient * TEN ** BigInt(scale - value.scale)
  const divisor = TEN ** BigInt(value.scale - scale)
  const absolute = value.coefficient < ZERO ? -value.coefficient : value.coefficient
  // PostgreSQL numeric round: ties away from zero, including negative values.
  const rounded = (absolute + divisor / TWO) / divisor
  return value.coefficient < ZERO ? -rounded : rounded
}

function asNumber(coefficient: bigint, scale: number): number {
  if (coefficient > BigInt(Number.MAX_SAFE_INTEGER) || coefficient < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("Decimal out of range")
  }
  const sign = coefficient < ZERO ? "-" : ""
  const digits = (coefficient < ZERO ? -coefficient : coefficient).toString().padStart(scale + 1, "0")
  const result=Number(scale ? `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}` : `${sign}${digits}`)
  // An integer coefficient can be safe while its decimal Number loses a cent.
  // Existing UI boundaries accept numbers, so reject any non-round-tripping value.
  if(!Number.isFinite(result)||quantize(parse(result),scale)!==coefficient)throw new Error("Decimal out of range")
  return result
}

export function decimalRound(value: DecimalInput, scale = 2): number {
  return asNumber(quantize(parse(value), scale), scale)
}

export function sumMoney(...values: DecimalInput[]): number {
  return sumMoneyValues(values)
}

export function sumMoneyValues(values: Iterable<DecimalInput>): number {
  let total = ZERO
  for (const value of values) total += quantize(parse(value), 2)
  return asNumber(total, 2)
}

export function multiplyMoney(left: DecimalInput, right: DecimalInput): number {
  const a = parse(left)
  const b = parse(right)
  return asNumber(quantize({ coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale }, 2), 2)
}

export function calculateVat(amount: DecimalInput, rate: DecimalInput): number {
  const a = parse(amount)
  const b = parse(rate)
  return asNumber(quantize({ coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale + 2 }, 2), 2)
}
