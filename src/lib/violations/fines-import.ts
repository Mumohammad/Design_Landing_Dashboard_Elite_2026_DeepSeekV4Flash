// Traffic fine spreadsheet → rows for public.import_external_fines (pure).
import { indexRow, pick, toIsoDate, toNumber, toText } from "@/lib/import/sheet"

export interface FineImportRow {
  external_ref: string
  vehicle_plate: string | null
  violation_date: string | null
  fine_amount: number | null
  violation_location: string | null
  violation_type_code: string | null
  payment_deadline: string | null
  external_source: string | null
}

export interface FineParseIssue { line: number; message: string; messageAr: string; blocking: boolean }

export const FINE_TEMPLATE_HEADERS = [
  "Fine reference", "Plate number", "Violation date", "Amount (SAR)", "Violation type", "Location", "Payment deadline", "Issuer",
]

const ALIASES = {
  ref: ["fine reference", "fine ref", "reference", "ref", "violation number", "violation no", "ticket number", "ticket no", "external_ref", "رقم المخالفة", "رقم الغرامة", "المرجع", "رقم المرجع"],
  plate: ["plate number", "plate", "plate no", "vehicle plate", "vehicle_plate", "رقم اللوحة", "اللوحة"],
  date: ["violation date", "date", "incident date", "violation_date", "تاريخ المخالفة", "التاريخ"],
  amount: ["amount (sar)", "amount", "fine amount", "fine", "fine_amount", "value", "قيمة المخالفة", "المبلغ", "القيمة", "الغرامة"],
  type: ["violation type", "type", "violation code", "violation_type_code", "نوع المخالفة", "النوع"],
  location: ["location", "violation location", "city", "place", "الموقع", "المكان", "المدينة"],
  deadline: ["payment deadline", "deadline", "due date", "payment_deadline", "آخر موعد للسداد", "تاريخ الاستحقاق"],
  issuer: ["issuer", "source", "authority", "جهة الإصدار", "الجهة", "المصدر"],
} as const

export function parseFineRows(rows: Record<string, unknown>[]): { rows: FineImportRow[]; issues: FineParseIssue[] } {
  const out: FineImportRow[] = []
  const issues: FineParseIssue[] = []
  const seen = new Set<string>()
  rows.forEach((raw, i) => {
    const line = i + 2
    const r = indexRow(raw)
    const ref = toText(pick(r, ALIASES.ref))
    const plate = toText(pick(r, ALIASES.plate))
    const dateRaw = pick(r, ALIASES.date)
    const date = toIsoDate(dateRaw)
    const amountRaw = pick(r, ALIASES.amount)
    const amount = toNumber(amountRaw)
    if (!ref && !plate && dateRaw === null && amountRaw === null) return
    const fail = (message: string, messageAr: string) => issues.push({ line, message, messageAr, blocking: true })
    if (!ref) return void fail("Missing fine reference", "رقم المخالفة مفقود")
    if (seen.has(ref)) return void fail(`Duplicate reference ${ref} in file`, `رقم مكرر في الملف ${ref}`)
    if (dateRaw !== null && !date) return void fail("Invalid violation date", "تاريخ المخالفة غير صالح")
    if (amountRaw !== null && (amount === null || amount < 0)) return void fail("Invalid amount", "المبلغ غير صالح")
    if (!plate) issues.push({ line, message: "No plate number — the fine will stay unmatched", messageAr: "لا يوجد رقم لوحة — ستبقى المخالفة غير مطابقة", blocking: false })
    seen.add(ref)
    out.push({
      external_ref: ref.slice(0, 100),
      vehicle_plate: plate,
      violation_date: date,
      fine_amount: amount === null ? null : Math.round(amount * 100) / 100,
      violation_location: toText(pick(r, ALIASES.location)),
      violation_type_code: toText(pick(r, ALIASES.type)),
      payment_deadline: toIsoDate(pick(r, ALIASES.deadline)),
      external_source: toText(pick(r, ALIASES.issuer)),
    })
  })
  return { rows: out, issues }
}
