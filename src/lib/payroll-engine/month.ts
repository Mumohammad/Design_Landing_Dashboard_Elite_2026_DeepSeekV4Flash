// Month helpers shared by the payroll engine adapters and UI.
const MONTH_INDEX: Record<string, string> = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
  apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
  aug: "08", august: "08", sep: "09", sept: "09", september: "09",
  oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12",
}

export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** "May 2026" → "2026-05" (upstream monthKeyFromLabel); null when no month is recognisable. */
export function monthKeyFromLabel(label: string): string | null {
  const parts = label.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/)
  const year = parts.find(p => /^\d{4}$/.test(p))
  if (!year) return null
  for (const part of parts) {
    const month = MONTH_INDEX[part]
    if (month) return `${year}-${month}`
  }
  return null
}

/** "2026-09" → "September 2026" (the payroll month label used on payslips). */
export function monthLabel(key: string): string {
  if (!MONTH_KEY_RE.test(key)) return key
  const [y, m] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
}

export function monthLabelAr(key: string): string {
  if (!MONTH_KEY_RE.test(key)) return key
  const [y, m] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" })
}

/** Last calendar day of a month key as YYYY-MM-DD (journal date for a payroll month). */
export function monthEndDate(key: string): string {
  const [y, m] = key.split("-").map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

/** Half-up rounding to halalas for payable amounts (display, bank files, journals). */
export function toHalalas(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
