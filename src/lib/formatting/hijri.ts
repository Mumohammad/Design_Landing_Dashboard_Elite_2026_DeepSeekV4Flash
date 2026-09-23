// Umm al-Qura Hijri formatting helpers (Saudi dual-calendar display).
//
// Intl ships the "islamic-umalqura" calendar in Node 18+ / modern browsers, so
// no extra dependency is needed. Used on card print, leave requests, and any
// surface that must show Gregorian + Hijri side by side (Saudi requirement).

const HIJRI_MONTHS_EN = [
  "Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani",
  "Jumada al-Ula", "Jumada al-Akhirah", "Rajab", "Shaban",
  "Ramadan", "Shawwal", "Dhu al-Qidah", "Dhu al-Hijjah",
]

const HIJRI_MONTHS_AR = [
  "محرم", "صفر", "ربيع الأول", "ربيع الثاني",
  "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان",
  "رمضان", "شوال", "ذو القعدة", "ذو الحجة",
]

function hijriParts(date: Date): { day: number; month: number; year: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
    })
    const parts = fmt.formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value
    const day = get("day")
    const month = get("month")
    const year = get("year")
    if (!day || !month || !year) return null
    return { day: Number(day), month: Number(month), year: Number(year.replace(/[^0-9]/g, "")) }
  } catch {
    return null
  }
}

/** "1447/04/12 هـ" style numeric Hijri date. */
export function formatHijri(date: Date | string | null | undefined, isAr = false): string {
  if (!date) return "—"
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return typeof date === "string" ? date : "—"
  const p = hijriParts(d)
  if (!p) return "—"
  const mm = String(p.month).padStart(2, "0")
  const dd = String(p.day).padStart(2, "0")
  return `${p.year}/${mm}/${dd} ${isAr ? "هـ" : "H"}`
}

/**
 * "12 Shawwal 1447 هـ" style long Hijri date.
 */
export function formatHijriLong(date: Date | string | null | undefined, isAr = false): string {
  if (!date) return "—"
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return typeof date === "string" ? date : "—"
  const p = hijriParts(d)
  if (!p) return "—"
  const months = isAr ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN
  return `${p.day} ${months[p.month - 1]} ${p.year}${isAr ? " هـ" : " H"}`
}

/** Dual-date line: "15 Sep 2026 · 04 Rabi al-Awwal 1448 H" */
export function formatDualDate(date: Date | string | null | undefined, isAr = false): string {
  if (!date) return "—"
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return typeof date === "string" ? date : "—"
  const g = d.toLocaleDateString(isAr ? "ar-SA-u-ca-gregory" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  return `${g} · ${formatHijriLong(d, isAr)}`
}
