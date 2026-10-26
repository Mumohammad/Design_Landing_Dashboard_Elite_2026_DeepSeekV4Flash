import type { SupabaseClient } from "@supabase/supabase-js"
import type { AccountType, NormalBalance } from "./csv-utils"

export type MasterKind = "customers" | "suppliers" | "accounts"
export type MasterIntent = { request_id: string }
export type MasterReview = MasterIntent & { expected_updated_at: string }
export const MASTER_EXPORT_MAX_ROWS = 10_000
export const MASTER_EXPORT_MAX_BYTES = 512 * 1024
export const MASTER_IMPORT_MAX_ROWS = 1_000
export const MASTER_IMPORT_MAX_BYTES = 512 * 1024
export const MASTER_IMPORT_MAX_ROW_CHARS = 4_096

export type PartyMasterRow = {
  id: string; code: string; name_ar: string; name_en: string | null
  phone: string | null; email: string | null; tax_number: string | null
  address: string | null; credit_limit: string | null; is_active: boolean; updated_at: string
}
export type ChartMasterRow = {
  id: string; account_code: string; name_ar: string; name_en: string
  account_type: AccountType; normal_balance: NormalBalance; parent_id: string | null
  is_contra: boolean; is_active: boolean; description: string | null; updated_at: string
  parent_code: string | null; parent_name_ar: string | null; parent_name_en: string | null
  is_canonical: boolean; can_archive: boolean
}
export type PartyMasterSummary = { total: number; active: number; tax_registered: number; avg_credit_limit: string }
export type ChartMasterSummary = { total: number; active: number; assets: number; income_expense: number }
export type MasterSummary = PartyMasterSummary | ChartMasterSummary
export type MasterRow = PartyMasterRow | ChartMasterRow
export type MasterPage<T = MasterRow> = {
  rows: T[]; total: number; page: number; page_size: number; summary: MasterSummary | null
}
export type MasterReadOptions = { search?: string; page?: number; pageSize?: number; exporting?: boolean; signal?: AbortSignal }
export type ChartParentReadOptions = Omit<MasterReadOptions, "exporting"> & { excludeId?: string | null }
export type MasterMutationResult = { id: string; updated_at: string; code: string; is_active: boolean; archived: boolean }
export type MasterFailureCode =
  | "MASTER_INVALID" | "MASTER_STALE" | "MASTER_REQUEST_REQUIRED" | "MASTER_REQUEST_CONFLICT"
  | "MASTER_NOT_FOUND" | "MASTER_EXPORT_LIMIT" | "MASTER_REFERENCED" | "MASTER_CANONICAL"
  | "MASTER_PARENT" | "MASTER_POSTED" | "MASTER_DUPLICATE" | "MASTER_FORBIDDEN"
  | "MASTER_ASSURANCE_REQUIRED" | "MASTER_PERIOD_CLOSED" | "MASTER_RATE_LIMIT" | "MASTER_IMPORT_LIMIT" | "MASTER_UNAVAILABLE" | "MASTER_CODE_INVALID" | "MASTER_TAX_INVALID" | "MASTER_CREDIT_INVALID"
export type MasterActionFailure = { success: false; error: string; errorAr: string; errorCode: MasterFailureCode }
export type MasterActionResult = ({ success: true } & MasterMutationResult) | MasterActionFailure

const messages: Record<MasterFailureCode, [string, string]> = {
  MASTER_INVALID: ["Review the entered accounting details and try again.", "راجع البيانات المحاسبية المدخلة وحاول مجدداً."],
  MASTER_STALE: ["This record changed. Reload and review its latest details before saving.", "تغير هذا السجل. أعد التحميل وراجع أحدث بياناته قبل الحفظ."],
  MASTER_REQUEST_REQUIRED: ["This request is missing its intent identity. Reopen the form and try again.", "يفتقد الطلب معرّف الإجراء. أعد فتح النموذج وحاول مجدداً."],
  MASTER_REQUEST_CONFLICT: ["This request already identifies different details. Reload and review before starting a new request.", "يرتبط هذا الطلب ببيانات مختلفة. أعد التحميل وراجعها قبل بدء طلب جديد."],
  MASTER_NOT_FOUND: ["This accounting record is unavailable. Reload the list.", "هذا السجل المحاسبي غير متاح. أعد تحميل القائمة."],
  MASTER_EXPORT_LIMIT: ["The export is too large. Narrow the search and export again.", "حجم التصدير كبير. ضيّق البحث ثم أعد التصدير."],
  MASTER_REFERENCED: ["This record has financial references and cannot be archived.", "يرتبط هذا السجل بمراجع مالية ولا يمكن أرشفته."],
  MASTER_CANONICAL: ["Standard chart accounts must retain their identity and active status.", "يجب الحفاظ على هوية حسابات الدليل القياسية وحالتها النشطة."],
  MASTER_PARENT: ["Choose an active parent of the same account type, outside this account's descendants.", "اختر حساباً أصلاً نشطاً من النوع نفسه وخارج الحسابات المتفرعة من هذا الحساب."],
  MASTER_POSTED: ["This account is protected by standard definitions or financial history. Keep its structure and active status.", "تحمي التعريفات القياسية أو السجلات المالية هذا الحساب. حافظ على بنيته وحالته النشطة."],
  MASTER_DUPLICATE: ["An accounting record with this code already exists.", "يوجد سجل محاسبي بهذا الرمز مسبقاً."],
  MASTER_FORBIDDEN: ["You do not have permission to perform this accounting action.", "ليست لديك صلاحية لتنفيذ هذا الإجراء المحاسبي."],
  MASTER_ASSURANCE_REQUIRED: ["Enable and verify two-factor authentication before changing accounting master records.", "فعّل التحقق الثنائي وأكّد هويتك قبل تغيير السجلات المحاسبية الأساسية."],
  MASTER_PERIOD_CLOSED: ["The posting period is closed. Review the date and period before posting.", "الفترة المحاسبية مقفلة. راجع التاريخ والفترة قبل الترحيل."],
  MASTER_RATE_LIMIT: ["Too many accounting requests. Wait and try again.", "طلبات محاسبية كثيرة. انتظر ثم حاول مجدداً."],
  MASTER_IMPORT_LIMIT: ["Import at most 1,000 rows and 512 KiB. Shorten the file and try again.", "استورد 1,000 صف و512 كيلوبايت على الأكثر. قلّل حجم الملف وحاول مجدداً."],
  MASTER_UNAVAILABLE: ["Unable to confirm this request. Retry with unchanged details.", "تعذر تأكيد هذا الطلب. أعد المحاولة بالتفاصيل نفسها."],
  MASTER_CODE_INVALID: ["Enter a valid accounting code.", "أدخل رمزاً محاسبياً صالحاً."],
  MASTER_TAX_INVALID: ["Tax number must be exactly 15 digits.", "يجب أن يتكون الرقم الضريبي من 15 رقماً تماماً."],
  MASTER_CREDIT_INVALID: ["Credit limit must be a nonnegative amount with at most two decimal places.", "يجب أن يكون الحد الائتماني مبلغاً غير سالب بمنزلتين عشريتين على الأكثر."],
}
export function masterFailure(code: MasterFailureCode): MasterActionFailure {
  return { success: false, error: messages[code][0], errorAr: messages[code][1], errorCode: code }
}
export function classifyMasterError(error: unknown): MasterFailureCode {
  const object = error && typeof error === "object" ? error as { message?: unknown; code?: unknown; errorCode?: unknown } : {}
  const raw = typeof object.message === "string" ? object.message : ""
  const code = typeof object.errorCode === "string" ? object.errorCode : typeof object.code === "string" ? object.code : ""
  if (Object.prototype.hasOwnProperty.call(messages, code)) return code as MasterFailureCode
  const known = /^(MASTER_[A-Z_]+|AUTH007|COA00[1-6]|CUS00[1-5]|SUP00[1-5]|ACC001|JRN00[4-8])(?::|\b)/.exec(raw)?.[1]
  if (known && Object.prototype.hasOwnProperty.call(messages, known)) return known as MasterFailureCode
  if (code === "AUTH007" || known === "AUTH007" || code === "42501") return "MASTER_FORBIDDEN"
  if (code === "23505") return "MASTER_DUPLICATE"
  if (known === "ACC001") return "MASTER_PERIOD_CLOSED"
  if (known && /^JRN00[4-8]$/.test(known)) return "MASTER_INVALID"
  if (known === "COA002") return "MASTER_PARENT"
  if (known === "COA003") return "MASTER_INVALID"
  if (known === "COA004" || known === "COA005") return "MASTER_POSTED"
  if (known === "COA006") return "MASTER_CANONICAL"
  if (known === "COA001" || known === "CUS003" || known === "SUP003") return "MASTER_CODE_INVALID"
  if (known === "CUS001" || known === "SUP001") return "MASTER_NOT_FOUND"
  if (known === "CUS002" || known === "SUP002") return "MASTER_TAX_INVALID"
  if (known === "CUS004" || known === "SUP004") return "MASTER_CREDIT_INVALID"
  if (known === "CUS005" || known === "SUP005") return "MASTER_INVALID"
  return "MASTER_UNAVAILABLE"
}
/** Translate partial-import diagnostics without exposing raw database messages. */
export function formatChartImportError(raw: string, arabic: boolean): string {
  const row = /^Row ([1-9][0-9]*):\s*/.exec(raw)
  const diagnostic = row ? raw.slice(row[0].length) : raw
  const code = /^([A-Z][A-Z0-9_]{1,31}):/.exec(diagnostic)?.[1]
  const classified = classifyMasterError({ message: diagnostic })
  const failure = masterFailure(classified === "MASTER_UNAVAILABLE" ? "MASTER_INVALID" : classified)
  const detail = arabic ? failure.errorAr : failure.error
  const prefix = row ? (arabic ? "الصف " : "Row ") + row[1] : ""
  return (prefix || code ? prefix + (code ? " (" + code + ")" : "") + ": " : "") + detail
}
export class MasterContractError extends Error {
  readonly errorCode: MasterFailureCode
  constructor(code: MasterFailureCode = "MASTER_UNAVAILABLE") {
    super(messages[code][0]); this.name = "MasterContractError"; this.errorCode = code
  }
}
export function isMasterId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
export function isMasterDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}
export function isMasterTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  return !!match && isMasterDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60
    && Number(match[4]) < 60 && (match[5] === "Z" || (Number(match[6]) < 24 && Number(match[7]) < 60))
}
export function isMasterIntent(value: unknown): value is MasterIntent {
  return !!value && typeof value === "object" && isMasterId((value as MasterIntent).request_id)
}
export function isMasterReview(value: unknown): value is MasterReview {
  return isMasterIntent(value) && isMasterTimestamp((value as MasterReview).expected_updated_at)
}
export function utf8ByteLength(value: string): number { return new TextEncoder().encode(value).byteLength }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const text = (value: unknown): value is string => typeof value === "string"
const nullableText = (value: unknown): value is string | null => value === null || text(value)
const money = (value: unknown): value is string => typeof value === "string" && /^\d{1,40}(?:\.\d{1,2})?$/.test(value)
const accountType = (value: unknown): value is AccountType => ["asset", "liability", "equity", "income", "expense"].includes(String(value))
function parseRow(value: unknown, kind: MasterKind): MasterRow {
  if (!record(value) || !isMasterId(value.id) || !text(value.name_ar) || !value.name_ar.trim()
    || typeof value.is_active !== "boolean" || !isMasterTimestamp(value.updated_at)) throw new MasterContractError()
  if (kind !== "accounts") {
    if (!text(value.code) || !/^[A-Za-z0-9][A-Za-z0-9-]{2,11}$/.test(value.code)
      || ![value.name_en, value.phone, value.email, value.tax_number, value.address].every(nullableText)
      || !(value.credit_limit === null || money(value.credit_limit))) throw new MasterContractError()
    return { id: value.id, code: value.code, name_ar: value.name_ar, name_en: value.name_en as string | null,
      phone: value.phone as string | null, email: value.email as string | null, tax_number: value.tax_number as string | null,
      address: value.address as string | null, credit_limit: value.credit_limit as string | null, is_active: value.is_active, updated_at: value.updated_at }
  }
  if (!text(value.account_code) || !/^\d{3,6}$/.test(value.account_code) || !text(value.name_en) || !value.name_en.trim()
    || !accountType(value.account_type) || !["debit", "credit"].includes(String(value.normal_balance))
    || !(value.parent_id === null || isMasterId(value.parent_id)) || typeof value.is_contra !== "boolean"
    || typeof value.is_canonical !== "boolean" || typeof value.can_archive !== "boolean" || ![value.description, value.parent_code, value.parent_name_ar, value.parent_name_en].every(nullableText)) throw new MasterContractError()
  return { id: value.id, account_code: value.account_code, name_ar: value.name_ar, name_en: value.name_en,
    account_type: value.account_type, normal_balance: value.normal_balance as NormalBalance, parent_id: value.parent_id as string | null,
    is_contra: value.is_contra, is_active: value.is_active, description: value.description as string | null,
    updated_at: value.updated_at, parent_code: value.parent_code as string | null, parent_name_ar: value.parent_name_ar as string | null,
    parent_name_en: value.parent_name_en as string | null, is_canonical: value.is_canonical, can_archive: value.can_archive }
}
export function parseMasterMutationResult(value: unknown, kind: MasterKind): MasterMutationResult {
  if (!["customers", "suppliers", "accounts"].includes(kind) || !record(value) || !isMasterId(value.id) || !isMasterTimestamp(value.updated_at) || !text(value.code)
    || !(kind === "accounts" ? /^\d{3,6}$/.test(value.code) : /^[A-Za-z0-9][A-Za-z0-9-]{2,11}$/.test(value.code))
    || typeof value.is_active !== "boolean" || typeof value.archived !== "boolean") throw new MasterContractError()
  return { id: value.id, updated_at: value.updated_at, code: value.code, is_active: value.is_active, archived: value.archived }
}
export function parseMasterPage<T = MasterRow>(
  value: unknown, kind: MasterKind, page = 1, pageSize = 25, exporting = false, parent = false,
): MasterPage<T> {
  if (!["customers", "suppliers", "accounts"].includes(kind) || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !record(value) || !count(value.total) || value.page !== page || value.page_size !== pageSize || !Array.isArray(value.rows)
    || value.rows.length !== (exporting ? value.total : Math.min(pageSize, Math.max(0, value.total - (page - 1) * pageSize)))) throw new MasterContractError()
  if (exporting && value.total > MASTER_EXPORT_MAX_ROWS) throw new MasterContractError("MASTER_EXPORT_LIMIT")
  const rows = value.rows.map(row => parseRow(row, kind))
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new MasterContractError()
  let summary: MasterSummary | null = null
  if (!parent) {
    const data = value.summary
    if (!record(data) || !count(data.total) || data.total < value.total || !count(data.active) || data.active > data.total) throw new MasterContractError()
    if (kind === "accounts") {
      if (!count(data.assets) || !count(data.income_expense) || data.assets > data.total || data.income_expense > data.total) throw new MasterContractError()
      summary = { total: data.total, active: data.active, assets: data.assets, income_expense: data.income_expense }
    } else {
      if (!count(data.tax_registered) || data.tax_registered > data.total || !money(data.avg_credit_limit)) throw new MasterContractError()
      summary = { total: data.total, active: data.active, tax_registered: data.tax_registered, avg_credit_limit: data.avg_credit_limit }
    }
  } else if (value.summary !== null) throw new MasterContractError()
  return { rows: rows as T[], total: value.total, page, page_size: pageSize, summary }
}
function readOptions(options: MasterReadOptions) {
  const { search = "", page = 1, pageSize = 25, exporting = false } = options
  if (typeof search !== "string" || search.length > 200 || !Number.isSafeInteger(page) || page < 1
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || typeof exporting !== "boolean") throw new MasterContractError("MASTER_INVALID")
  return { search, page, pageSize, exporting }
}
export async function readMasterPage<T = MasterRow>(client: SupabaseClient, kind: MasterKind, options: MasterReadOptions = {}): Promise<MasterPage<T>> {
  const { search, page, pageSize, exporting } = readOptions(options)
  if (!["customers", "suppliers", "accounts"].includes(kind)) throw new MasterContractError("MASTER_INVALID")
  try {
    let query = client.rpc("read_my_accounting_master_page", { p_kind: kind, p_search: search, p_page: page, p_page_size: pageSize, p_export: exporting })
    if (options.signal) query = query.abortSignal(options.signal)
    const { data, error } = await query
    if (options.signal?.aborted) throw new MasterContractError()
    if (error) throw new MasterContractError(classifyMasterError(error))
    return parseMasterPage<T>(data, kind, page, pageSize, exporting)
  } catch (error) { throw new MasterContractError(classifyMasterError(error)) }
}
export async function readChartParentPage(client: SupabaseClient, type: AccountType, options: ChartParentReadOptions = {}): Promise<MasterPage<ChartMasterRow>> {
  const { search, page, pageSize } = readOptions(options)
  if (!accountType(type) || !(options.excludeId == null || isMasterId(options.excludeId))) throw new MasterContractError("MASTER_INVALID")
  try {
    let query = client.rpc("read_my_chart_parent_page", { p_account_type: type, p_exclude_id: options.excludeId ?? null, p_search: search, p_page: page, p_page_size: pageSize })
    if (options.signal) query = query.abortSignal(options.signal)
    const { data, error } = await query
    if (options.signal?.aborted) throw new MasterContractError()
    if (error) throw new MasterContractError(classifyMasterError(error))
    const result = parseMasterPage<ChartMasterRow>(data, "accounts", page, pageSize, false, true)
    if (result.rows.some(row => !row.is_active || row.account_type !== type || (options.excludeId != null && (row.id === options.excludeId || row.parent_id === options.excludeId)))) throw new MasterContractError()
    return result
  } catch (error) { throw new MasterContractError(classifyMasterError(error)) }
}