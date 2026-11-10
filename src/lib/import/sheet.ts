// Spreadsheet import helpers (client-safe, pure). Rows come from
// XLSX.utils.sheet_to_json(..., { defval: null }) or a parsed CSV.

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

/** Arabic/Persian digits → Western digits. */
export function westernDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => {
    const a = ARABIC_DIGITS.indexOf(d)
    return String(a >= 0 ? a : PERSIAN_DIGITS.indexOf(d))
  })
}

/** Lower-case, strip spaces/underscores/punctuation so "Fine Ref", "fine_ref" and "FINE-REF" match. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_\-./():*]+/g, "").trim()
}

/** Index a sheet row by normalised header. */
export function indexRow(row: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const [k, v] of Object.entries(row)) map.set(normalizeHeader(k), v)
  return map
}

/** First non-empty value among header aliases. */
export function pick(row: Map<string, unknown>, aliases: readonly string[]): unknown {
  for (const a of aliases) {
    const v = row.get(normalizeHeader(a))
    if (v !== null && v !== undefined && String(v).trim() !== "") return v
  }
  return null
}

export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = westernDigits(String(value)).trim()
  return s === "" ? null : s
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

/**
 * Excel serial numbers, Date objects, ISO (2026-03-01), and day-first
 * (01/03/2026, 1-3-2026) dates → YYYY-MM-DD. Returns null when unparseable.
 */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null
  if (typeof value === "number") {
    if (value < 1 || value > 2958465) return null
    const ms = Math.round((value - 25569) * 86_400_000)
    return new Date(ms).toISOString().slice(0, 10)
  }
  const s = westernDigits(String(value)).trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return iso(+m[3], +m[2], +m[1])
  if (/^\d{5}(\.\d+)?$/.test(s)) return toIsoDate(Number(s))
  return null
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const s = westernDigits(String(value)).replace(/[,\s]|SAR|ر\.?س\.?|ريال/gi, "").replace("٫", ".")
  if (s === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Read the first sheet of an .xlsx/.xls/.csv file into plain rows. */
export async function readSheetRows(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx")
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true })
  const first = wb.SheetNames[0]
  if (!first) return []
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[first], { defval: null, raw: true })
}

/** Download an .xlsx template with one header row and optional example rows. */
export async function downloadTemplate(fileName: string, headers: string[], examples: (string | number | null)[][] = []): Promise<void> {
  const XLSX = await import("xlsx")
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples])
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, "Template")
  XLSX.writeFile(wb, fileName)
}
