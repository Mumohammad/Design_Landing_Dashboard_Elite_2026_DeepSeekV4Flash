import { format, formatDistanceToNow, parse, parseISO } from "date-fns"
import { ar, enUS } from "date-fns/locale"
import type { Locale } from "@/lib/i18n/types"

const LOCALES = { ar, en: enUS } as const

/** Western digits in both locales (matches app conventions). */
export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(
    locale === "ar" ? "ar-SA-u-nu-latn" : "en-US",
  ).format(value)
}

export function formatCurrency(locale: Locale, value: number): string {
  return `${formatNumber(locale, Math.round(value))} ${locale === "ar" ? "ر.س" : "SAR"}`
}

/** "yyyy-MM-dd" (daily) or "yyyy-MM" (monthly) bucket → localized short label. */
export function formatBucketLabel(locale: Locale, key: string): string {
  const df = LOCALES[locale]
  if (key.length === 10) {
    const d = parse(key, "yyyy-MM-dd", new Date())
    return format(d, "d MMM", { locale: df })
  }
  const d = parse(`${key}-01`, "yyyy-MM-dd", new Date())
  return format(d, "MMM yy", { locale: df })
}

export function formatRelative(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: LOCALES[locale] })
  } catch {
    return ""
  }
}
