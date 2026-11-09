// Pure parsers that turn OCR text from Saudi iqama / ID, driving licence and
// passport scans into suggested form values. Results are suggestions only —
// staff (or the driver) confirm them before saving.

export type OcrDocKind = "iqama" | "national_id" | "driving_license" | "passport" | "other"
export interface OcrSuggestion {
  docNumber: string | null
  expiryDate: string | null // ISO yyyy-mm-dd (Gregorian)
  expirySource: "gregorian" | "hijri" | "mrz" | null
  name: string | null
  nationality: string | null
  birthDate: string | null
  confidence: "high" | "medium" | "low"
}

const AR_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g
export function westernize(text: string): string {
  return text.replace(AR_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
}

const pad = (n: number) => String(n).padStart(2, "0")
function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

let hijriFmt: Intl.DateTimeFormat | null | undefined
function hijriParts(t: number): [number, number, number] | null {
  if (hijriFmt === undefined) {
    try { hijriFmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" }) } catch { hijriFmt = null }
  }
  if (!hijriFmt) return null
  const parts = hijriFmt.formatToParts(new Date(t))
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value?.replace(/\D/g, ""))
  return [get("year"), get("month"), get("day")]
}
/** Umm al-Qura Hijri → Gregorian ISO date (1350–1500 AH), via Intl. */
export function hijriToGregorian(hy: number, hm: number, hd: number): string | null {
  if (hy < 1350 || hy > 1500 || hm < 1 || hm > 12 || hd < 1 || hd > 30) return null
  const key = (y: number, m: number, d: number) => y * 10000 + m * 100 + d
  const target = key(hy, hm, hd)
  let t = Date.UTC(622, 6, 16) + Math.floor(((hy - 1) * 354.367 + (hm - 1) * 29.53 + (hd - 1)) * 86400000)
  let prev: number | null = null
  for (let i = 0; i < 90; i++) {
    const p = hijriParts(t)
    if (!p) return null
    const k = key(p[0], p[1], p[2])
    if (k === target) { const d = new Date(t); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) }
    const dir = k < target ? 1 : -1
    if (prev !== null && prev !== dir) return null // skipped over: day 30 in a 29-day month
    prev = dir
    t += dir * 86400000
  }
  return null
}

type DateHit = { iso: string; source: "gregorian" | "hijri"; index: number }
/** All plausible dates in the text (yyyy/mm/dd, dd/mm/yyyy, Hijri 14xx). */
export function findDates(raw: string): DateHit[] {
  const text = westernize(raw)
  const hits: DateHit[] = []
  const re = /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})|(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/g
  for (const m of text.matchAll(re)) {
    const [y, mo, d] = m[1] ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[6]), Number(m[5]), Number(m[4])]
    if (y >= 1350 && y <= 1500) {
      const g = hijriToGregorian(y, mo, d)
      if (g) hits.push({ iso: g, source: "hijri", index: m.index ?? 0 })
    } else if (y >= 1900 && y <= 2100) {
      const g = iso(y, mo, d)
      if (g) hits.push({ iso: g, source: "gregorian", index: m.index ?? 0 })
    }
  }
  return hits
}

const EXPIRY_HINT = /expiry|expiration|exp\.?\s*date|valid\s*(until|till|to)|انتهاء|الانتهاء|صالحة/i

function pickExpiry(text: string, today: string): DateHit | null {
  const dates = findDates(text)
  if (!dates.length) return null
  const hinted = dates.filter((d) => EXPIRY_HINT.test(text.slice(Math.max(0, d.index - 40), d.index)))
  const pool = hinted.length ? hinted : dates.filter((d) => d.iso >= today)
  const latest = (arr: DateHit[]) => [...arr].sort((a, b) => (a.iso < b.iso ? 1 : -1))[0]
  return latest(pool.length ? pool : dates)
}

// ── Passport MRZ (ICAO 9303 TD3: 2 × 44 chars) ──
const MRZ_W: Record<string, number> = { "<": 0 }
for (let i = 0; i < 10; i++) MRZ_W[String(i)] = i
for (let i = 0; i < 26; i++) MRZ_W[String.fromCharCode(65 + i)] = i + 10
export function mrzCheckDigit(s: string): number {
  const w = [7, 3, 1]
  let sum = 0
  for (let i = 0; i < s.length; i++) sum += (MRZ_W[s[i]] ?? 0) * w[i % 3]
  return sum % 10
}
function mrzDate(yymmdd: string, future: boolean): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null
  const yy = Number(yymmdd.slice(0, 2)), mm = Number(yymmdd.slice(2, 4)), dd = Number(yymmdd.slice(4, 6))
  const nowYY = new Date().getUTCFullYear() % 100
  const y = future ? 2000 + yy : yy > nowYY ? 1900 + yy : 2000 + yy
  return iso(y, mm, dd)
}
const fixDigits = (s: string) => s.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2")

export interface MrzResult { passportNumber: string; nationality: string; birthDate: string | null; expiryDate: string | null; surname: string; givenNames: string; valid: boolean }
export function parseMrz(raw: string): MrzResult | null {
  const lines = raw.toUpperCase().replace(/[«‹]/g, "<").split(/\r?\n/).map((l) => l.replace(/\s+/g, "").replace(/[^A-Z0-9<]/g, "")).filter((l) => l.length >= 40)
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith("P")) continue
    const l1 = lines[i].padEnd(44, "<").slice(0, 44), l2 = lines[i + 1].padEnd(44, "<").slice(0, 44)
    const num = l2.slice(0, 9), numCd = fixDigits(l2[9]), nat = l2.slice(10, 13)
    const dob = fixDigits(l2.slice(13, 19)), dobCd = fixDigits(l2[19]), exp = fixDigits(l2.slice(21, 27)), expCd = fixDigits(l2[27])
    const [sur, given = ""] = l1.slice(5).split("<<")
    const valid = String(mrzCheckDigit(num)) === numCd && String(mrzCheckDigit(dob)) === dobCd && String(mrzCheckDigit(exp)) === expCd
    return {
      passportNumber: num.replace(/</g, ""), nationality: nat.replace(/</g, ""), birthDate: mrzDate(dob, false), expiryDate: mrzDate(exp, true),
      surname: sur.replace(/</g, " ").trim(), givenNames: given.replace(/</g, " ").replace(/\s+/g, " ").trim(), valid,
    }
  }
  return null
}

/** Saudi ID / iqama numbers: 10 digits starting 1 (citizen) or 2 (resident), Luhn-valid. */
export function isSaudiIdNumber(n: string): boolean {
  if (!/^[12]\d{9}$/.test(n)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    let d = Number(n[i])
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

export function extractDocumentFields(rawText: string, kind: OcrDocKind, today = new Date().toISOString().slice(0, 10)): OcrSuggestion {
  const text = westernize(rawText)
  const empty: OcrSuggestion = { docNumber: null, expiryDate: null, expirySource: null, name: null, nationality: null, birthDate: null, confidence: "low" }
  if (kind === "passport") {
    const mrz = parseMrz(text)
    if (mrz) return { docNumber: mrz.passportNumber || null, expiryDate: mrz.expiryDate, expirySource: mrz.expiryDate ? "mrz" : null, name: [mrz.givenNames, mrz.surname].filter(Boolean).join(" ") || null, nationality: mrz.nationality || null, birthDate: mrz.birthDate, confidence: mrz.valid ? "high" : "medium" }
    const num = text.match(/\b([A-Z]{1,2}\d{6,8})\b/)
    const exp = pickExpiry(text, today)
    return { ...empty, docNumber: num?.[1] ?? null, expiryDate: exp?.iso ?? null, expirySource: exp?.source ?? null, confidence: num && exp ? "medium" : "low" }
  }
  const candidates = [...text.matchAll(/(?<!\d)([12]\d{9})(?!\d)/g)].map((m) => m[1])
  const valid = candidates.find(isSaudiIdNumber)
  let docNumber: string | null = valid ?? candidates[0] ?? null
  if (!docNumber && kind === "driving_license") docNumber = text.match(/(?<!\d)(\d{10})(?!\d)/)?.[1] ?? null
  const exp = pickExpiry(text, today)
  return { ...empty, docNumber, expiryDate: exp?.iso ?? null, expirySource: exp?.source ?? null, confidence: valid && exp ? "high" : docNumber || exp ? "medium" : "low" }
}

/** Map a vault document type to the OCR parser to use (null = OCR not offered). */
export function ocrKindFor(docType: string): OcrDocKind | null {
  if (docType === "iqama" || docType === "national_id" || docType === "driving_license" || docType === "passport") return docType
  if (docType === "work_permit" || docType === "health_certificate" || docType === "medical_insurance" || docType === "home_delivery_permit") return "other"
  return null
}
