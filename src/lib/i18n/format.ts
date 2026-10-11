import type { Locale } from "./types"

export function formatAmount(value: number | string | null | undefined, locale: Locale): string {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—"
  // Formatting only: calculations use decimal.ts / PostgreSQL numeric.
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(value))
}

export function formatAccountingDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "—"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "—"
  // Financial dates remain Gregorian; localization must not silently change
  // the invoice's accounting calendar to the locale's default Hijri calendar.
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    calendar: "gregory", timeZone: "Asia/Riyadh", day: "2-digit", month: "short", year: "numeric",
  }).format(date)
}
