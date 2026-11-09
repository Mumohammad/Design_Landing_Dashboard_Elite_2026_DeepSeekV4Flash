// Bulk driver import: spreadsheet rows → validated DriverCreateInput (pure).
import { driverCreateSchema, type DriverCreateInput } from "@/types/drivers"
import { indexRow, pick, toIsoDate, toNumber, toText } from "@/lib/import/sheet"

export const DRIVER_IMPORT_MAX_ROWS = 300

type Field = { key: keyof DriverCreateInput; header: string; aliases: string[]; kind?: "date" | "number" | "mobile" | "iban" | "enum" }

export const DRIVER_IMPORT_FIELDS: Field[] = [
  { key: "driver_code", header: "Driver code", aliases: ["code", "employee code", "كود السائق", "الرقم الوظيفي"] },
  { key: "full_name_ar", header: "Full name (Arabic)*", aliases: ["full name ar", "name ar", "arabic name", "الاسم بالعربي", "الاسم الكامل", "الاسم"] },
  { key: "full_name_en", header: "Full name (English)", aliases: ["full name en", "name en", "english name", "name", "الاسم بالإنجليزي"] },
  { key: "primary_mobile", header: "Mobile*", aliases: ["mobile", "phone", "primary mobile", "رقم الجوال", "الجوال"], kind: "mobile" },
  { key: "nationality", header: "Nationality", aliases: ["الجنسية"] },
  { key: "iqama_number", header: "Iqama / ID number", aliases: ["iqama", "iqama number", "national id", "id number", "رقم الإقامة", "رقم الهوية"] },
  { key: "iqama_expiry_date", header: "Iqama expiry", aliases: ["iqama expiry date", "انتهاء الإقامة", "تاريخ انتهاء الإقامة"], kind: "date" },
  { key: "passport_number", header: "Passport number", aliases: ["passport", "رقم الجواز"] },
  { key: "passport_expiry_date", header: "Passport expiry", aliases: ["passport expiry date", "انتهاء الجواز"], kind: "date" },
  { key: "license_number", header: "Licence number", aliases: ["license number", "license", "licence", "رقم الرخصة"] },
  { key: "license_expiry_date", header: "Licence expiry", aliases: ["license expiry", "license expiry date", "انتهاء الرخصة"], kind: "date" },
  { key: "date_of_birth", header: "Date of birth", aliases: ["dob", "birth date", "تاريخ الميلاد"], kind: "date" },
  { key: "category", header: "Category", aliases: ["driver category", "الفئة", "نوع السائق"], kind: "enum" },
  { key: "employment_type", header: "Employment type", aliases: ["نوع التوظيف"], kind: "enum" },
  { key: "status", header: "Status", aliases: ["الحالة"], kind: "enum" },
  { key: "hire_date", header: "Hire date", aliases: ["joining date", "start date", "تاريخ التعيين", "تاريخ المباشرة"], kind: "date" },
  { key: "current_city", header: "City", aliases: ["current city", "المدينة"] },
  { key: "personal_email", header: "Email", aliases: ["personal email", "البريد الإلكتروني"] },
  { key: "iban", header: "IBAN", aliases: ["الآيبان", "رقم الآيبان"], kind: "iban" },
  { key: "basic_salary", header: "Basic salary", aliases: ["salary", "الراتب الأساسي", "الراتب"], kind: "number" },
]

const ENUMS: Record<string, Record<string, string>> = {
  category: {
    sponsored_type1: "sponsored_type1", "sponsored type 1": "sponsored_type1", sponsored: "sponsored_type1", "على الكفالة": "sponsored_type1", "مكفول": "sponsored_type1",
    sponsored_type2: "sponsored_type2", "sponsored type 2": "sponsored_type2", "مكفول نوع 2": "sponsored_type2",
    freelancer: "freelancer", freelance: "freelancer", "عمل حر": "freelancer", "مستقل": "freelancer",
  },
  employment_type: {
    full_time: "full_time", "full time": "full_time", "دوام كامل": "full_time",
    part_time: "part_time", "part time": "part_time", "دوام جزئي": "part_time",
    contract: "contract", "عقد": "contract", temporary: "temporary", "مؤقت": "temporary",
  },
  status: {
    draft: "draft", "مسودة": "draft", active: "active", "نشط": "active", on_leave: "on_leave", "on leave": "on_leave", "إجازة": "on_leave",
    suspended: "suspended", "موقوف": "suspended",
  },
}

export function normalizeSaudiMobile(value: string): string {
  const d = value.replace(/[\s\-()]/g, "")
  if (/^5\d{8}$/.test(d)) return `0${d}`
  if (/^9665\d{8}$/.test(d)) return `+${d}`
  if (/^009665\d{8}$/.test(d)) return `+${d.slice(2)}`
  return d
}

export interface DriverImportRow { line: number; input: DriverCreateInput; label: string }
export interface DriverImportIssue { line: number; message: string }

export function parseDriverRows(rows: Record<string, unknown>[]): { rows: DriverImportRow[]; issues: DriverImportIssue[] } {
  const out: DriverImportRow[] = []
  const issues: DriverImportIssue[] = []
  const seen = new Map<string, number>()
  rows.forEach((raw, i) => {
    const line = i + 2
    const r = indexRow(raw)
    const draft: Record<string, unknown> = {}
    let blank = true
    for (const f of DRIVER_IMPORT_FIELDS) {
      const v = pick(r, [f.header, f.key as string, ...f.aliases])
      if (v === null) continue
      blank = false
      if (f.kind === "date") {
        const d = toIsoDate(v)
        if (!d) { issues.push({ line, message: `${f.header}: invalid date` }); continue }
        draft[f.key] = d
      } else if (f.kind === "number") {
        const n = toNumber(v)
        if (n === null) { issues.push({ line, message: `${f.header}: invalid number` }); continue }
        draft[f.key] = n
      } else if (f.kind === "enum") {
        const t = toText(v)?.toLowerCase() ?? ""
        const mapped = ENUMS[f.key as string]?.[t]
        if (!mapped) { issues.push({ line, message: `${f.header}: unknown value "${toText(v)}"` }); continue }
        draft[f.key] = mapped
      } else {
        const t = toText(v)
        if (t === null) continue
        draft[f.key] = f.kind === "mobile" ? normalizeSaudiMobile(t) : f.kind === "iban" ? t.replace(/\s/g, "").toUpperCase() : t
      }
    }
    if (blank) return
    if (issues.some((i) => i.line === line)) return
    draft.category ??= "freelancer"
    draft.status ??= "draft"
    const parsed = driverCreateSchema.safeParse(draft)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      issues.push({ line, message: `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}` })
      return
    }
    const key = parsed.data.iqama_number || parsed.data.driver_code || parsed.data.primary_mobile
    if (key && seen.has(key)) { issues.push({ line, message: `Duplicate of line ${seen.get(key)} (${key})` }); return }
    if (key) seen.set(key, line)
    out.push({ line, input: parsed.data, label: parsed.data.full_name_ar })
  })
  return { rows: out, issues }
}
