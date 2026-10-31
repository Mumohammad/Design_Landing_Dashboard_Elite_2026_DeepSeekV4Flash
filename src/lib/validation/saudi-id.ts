/**
 * Saudi identity numbers (National ID for citizens, Iqama for residents):
 * ten digits, the first is 1 (citizen) or 2 (resident) and the last is a
 * Luhn-style check digit.
 */
export type SaudiIdKind = "citizen" | "resident"

export function saudiIdKind(id: string): SaudiIdKind | null {
  if (!/^[12]\d{9}$/.test(id)) return null
  return id[0] === "1" ? "citizen" : "resident"
}

export function isValidSaudiId(id: string): boolean {
  if (!saudiIdKind(id)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const digit = Number(id[i])
    if (i % 2 === 0) {
      const doubled = digit * 2
      sum += Math.floor(doubled / 10) + (doubled % 10)
    } else {
      sum += digit
    }
  }
  return sum % 10 === 0
}

/** Saudi short national address: four letters and four digits (e.g. RRRD2929). */
export function isSaudiShortAddress(value: string): boolean {
  return /^[A-Z]{4}\d{4}$/.test(value.replace(/\s+/g, "").toUpperCase())
}
