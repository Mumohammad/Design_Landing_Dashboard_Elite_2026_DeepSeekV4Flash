// Expense claims (employee expense & receipt capture) — shared, client-safe.
//
// Separate from the ledger `expenses` module. Receipts attached here are
// SUPPORTING DOCUMENTS for internal reimbursement review only: they are never
// treated as ZATCA e-invoices, never submitted to ZATCA, and VAT figures on
// them are unverified until a reviewer has checked them.

export const CLAIM_STATUSES = ["draft", "submitted", "needs_info", "approved", "rejected", "exported", "reimbursed"] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const PAYMENT_METHODS = ["cash", "company_card", "personal_card", "bank_transfer", "petty_cash", "other"] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const DOC_KINDS = ["photo", "scanned_pdf", "digital_pdf", "structured_einvoice"] as const
export type DocKind = (typeof DOC_KINDS)[number]

export type Bi = { en: string; ar: string }

export const STATUS_LABELS: Record<ClaimStatus, Bi> = {
  draft: { en: "Draft", ar: "مسودة" },
  submitted: { en: "Submitted", ar: "مقدَّمة" },
  needs_info: { en: "Needs info", ar: "بحاجة لمعلومات" },
  approved: { en: "Approved", ar: "معتمدة" },
  rejected: { en: "Rejected", ar: "مرفوضة" },
  exported: { en: "Exported", ar: "مُصدَّرة" },
  reimbursed: { en: "Reimbursed", ar: "مُسدَّدة" },
}

export const PAYMENT_LABELS: Record<PaymentMethod, Bi> = {
  cash: { en: "Cash", ar: "نقداً" },
  company_card: { en: "Company card", ar: "بطاقة الشركة" },
  personal_card: { en: "Personal card", ar: "بطاقة شخصية" },
  bank_transfer: { en: "Bank transfer", ar: "تحويل بنكي" },
  petty_cash: { en: "Petty cash", ar: "عهدة نقدية" },
  other: { en: "Other", ar: "أخرى" },
}

export const DOC_KIND_LABELS: Record<DocKind, Bi> = {
  photo: { en: "Receipt photo (supporting document)", ar: "صورة إيصال (مستند داعم)" },
  scanned_pdf: { en: "Scanned PDF (supporting document)", ar: "ملف PDF ممسوح (مستند داعم)" },
  digital_pdf: { en: "PDF document (supporting document)", ar: "مستند PDF (مستند داعم)" },
  structured_einvoice: { en: "Supplier structured e-invoice file (XML original)", ar: "ملف الفاتورة الإلكترونية المنظمة من المورد (XML أصلي)" },
}

export const CATEGORY_LABELS: Record<string, Bi> = {
  fuel: { en: "Fuel", ar: "وقود" },
  meals: { en: "Meals", ar: "وجبات" },
  transport: { en: "Transport", ar: "مواصلات" },
  accommodation: { en: "Accommodation", ar: "سكن" },
  vehicle_maintenance: { en: "Vehicle maintenance", ar: "صيانة مركبات" },
  parking_tolls: { en: "Parking & tolls", ar: "مواقف ورسوم طرق" },
  office_supplies: { en: "Office supplies", ar: "مستلزمات مكتبية" },
  telecom: { en: "Telecom", ar: "اتصالات" },
  government_fees: { en: "Government fees", ar: "رسوم حكومية" },
  other: { en: "Other", ar: "أخرى" },
}

export function categoryLabel(key: string | null | undefined): Bi {
  if (!key) return { en: "Uncategorised", ar: "غير مصنف" }
  return CATEGORY_LABELS[key] ?? { en: key.replace(/_/g, " "), ar: key.replace(/_/g, " ") }
}

export const DUPLICATE_REASON_LABELS: Record<string, Bi> = {
  same_file: { en: "Same file already uploaded", ar: "نفس الملف مرفوع مسبقاً" },
  same_receipt_number: { en: "Same supplier and receipt number", ar: "نفس المورد ورقم الإيصال" },
  same_supplier_date_total: { en: "Same supplier, date and total", ar: "نفس المورد والتاريخ والإجمالي" },
}

/** Wording used wherever VAT from a receipt is displayed. Never "recoverable" or "deductible". */
export const VAT_UNVERIFIED: Bi = { en: "VAT shown on receipts (unverified)", ar: "الضريبة الظاهرة في الإيصالات (غير متحقق منها)" }
export const VAT_REVIEWED: Bi = { en: "VAT shown on reviewed receipts", ar: "الضريبة الظاهرة في الإيصالات المراجَعة" }

export const SUPPORTING_DOC_NOTICE: Bi = {
  en: "Receipts and scans are supporting documents for internal expense review only. They are not ZATCA e-invoices and nothing here is submitted to ZATCA.",
  ar: "الإيصالات والمستندات الممسوحة مستندات داعمة للمراجعة الداخلية للمصروفات فقط، وليست فواتير إلكترونية لدى هيئة الزكاة والضريبة والجمارك، ولا يُرسل منها شيء إلى الهيئة.",
}

export const CHECKLIST_NOTICE: Bi = {
  en: "Internal review aid only — not a legal or tax compliance determination. Rules must be confirmed by an administrator or tax professional before production use.",
  ar: "أداة مساعدة للمراجعة الداخلية فقط — وليست حكماً قانونياً أو ضريبياً بالامتثال. يجب أن يؤكد المسؤول أو مختص ضريبي القواعد قبل الاستخدام الفعلي.",
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS = 10
export const RECEIPT_BUCKET = "expense-receipts"

export const EDITABLE_FIELDS = [
  "department", "expense_date", "supplier_name", "supplier_vat_number", "receipt_number", "category", "business_purpose",
  "currency", "amount_before_vat", "vat_rate", "vat_amount", "total_amount", "payment_method", "project", "cost_center", "customer", "notes",
] as const
export type EditableField = (typeof EDITABLE_FIELDS)[number]

export const FIELD_LABELS: Record<EditableField | "claim_no" | "submitter" | "status" | "submitted_at" | "reviewer" | "reviewed_at" | "reviewer_comment" | "attachments" | "duplicate" | "verification" | "exported_at" | "reimbursed_at" | "reimbursement_ref" | "source", Bi> = {
  claim_no: { en: "Claim no.", ar: "رقم المطالبة" },
  submitter: { en: "Submitter", ar: "مقدم الطلب" },
  department: { en: "Department", ar: "القسم" },
  expense_date: { en: "Expense date", ar: "تاريخ المصروف" },
  submitted_at: { en: "Submitted at", ar: "تاريخ التقديم" },
  supplier_name: { en: "Supplier / merchant", ar: "المورد / التاجر" },
  supplier_vat_number: { en: "Supplier VAT no. (as shown)", ar: "الرقم الضريبي للمورد (كما يظهر)" },
  receipt_number: { en: "Receipt / invoice no.", ar: "رقم الإيصال / الفاتورة" },
  category: { en: "Category", ar: "الفئة" },
  business_purpose: { en: "Business purpose", ar: "الغرض من المصروف" },
  currency: { en: "Currency", ar: "العملة" },
  amount_before_vat: { en: "Amount before VAT", ar: "المبلغ قبل الضريبة" },
  vat_rate: { en: "VAT rate % (as shown)", ar: "نسبة الضريبة % (كما تظهر)" },
  vat_amount: { en: "VAT amount (as shown, unverified)", ar: "مبلغ الضريبة (كما يظهر، غير متحقق منه)" },
  total_amount: { en: "Total amount", ar: "المبلغ الإجمالي" },
  payment_method: { en: "Payment method", ar: "طريقة الدفع" },
  project: { en: "Project", ar: "المشروع" },
  cost_center: { en: "Cost center", ar: "مركز التكلفة" },
  customer: { en: "Customer", ar: "العميل" },
  notes: { en: "Notes", ar: "ملاحظات" },
  status: { en: "Status", ar: "الحالة" },
  reviewer: { en: "Reviewer", ar: "المراجع" },
  reviewed_at: { en: "Reviewed at", ar: "تاريخ المراجعة" },
  reviewer_comment: { en: "Reviewer comment", ar: "تعليق المراجع" },
  attachments: { en: "Attachments", ar: "المرفقات" },
  duplicate: { en: "Duplicate check", ar: "فحص التكرار" },
  verification: { en: "Verification", ar: "التحقق" },
  exported_at: { en: "Exported at", ar: "تاريخ التصدير" },
  reimbursed_at: { en: "Reimbursed at", ar: "تاريخ السداد" },
  reimbursement_ref: { en: "Reimbursement ref.", ar: "مرجع السداد" },
  source: { en: "Source", ar: "المصدر" },
}

/** Row shape read from public.expense_claims (subset used by the UI/export). */
export interface ExpenseClaim {
  id: string
  claim_no: string
  submitter_id: string
  department: string | null
  expense_date: string | null
  submitted_at: string | null
  supplier_name: string | null
  supplier_vat_number: string | null
  receipt_number: string | null
  category: string | null
  business_purpose: string | null
  currency: string
  amount_before_vat: number | string | null
  vat_rate: number | string | null
  vat_amount: number | string | null
  total_amount: number | string | null
  payment_method: PaymentMethod | null
  project: string | null
  cost_center: string | null
  customer: string | null
  notes: string | null
  status: ClaimStatus
  source: "web" | "telegram"
  ocr_suggestions: Record<string, unknown>
  unverified_fields: string[]
  verified_by: string | null
  verified_at: string | null
  reviewer_id: string | null
  reviewed_at: string | null
  reviewer_comment: string | null
  review_checklist: Record<string, string>
  duplicate_status: "none" | "possible" | "not_duplicate" | "duplicate"
  duplicate_of: string[]
  duplicate_reasons: string[]
  exported_at: string | null
  reimbursed_at: string | null
  reimbursement_ref: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface ClaimAttachment {
  id: string
  claim_id: string
  original_filename: string
  mime_type: string
  size_bytes: number
  sha256: string
  doc_kind: DocKind
  source: "web" | "telegram"
  uploaded_at: string
}

export interface ChecklistItem { key: string; en: string; ar: string; enabled: boolean }

export interface ClaimSettings {
  export_language: "en" | "ar" | "both"
  amount_locale: "en-US" | "ar-SA"
  default_currency: string
  allow_self_approval: boolean
  categories: string[]
  checklist: ChecklistItem[]
  checklist_confirmed_by: string | null
  checklist_confirmed_at: string | null
  checklist_confirmation_note: string | null
  telegram_enabled: boolean
}

export const DEFAULT_SETTINGS: ClaimSettings = {
  export_language: "both",
  amount_locale: "en-US",
  default_currency: "SAR",
  allow_self_approval: false,
  categories: Object.keys(CATEGORY_LABELS),
  checklist: [],
  checklist_confirmed_by: null,
  checklist_confirmed_at: null,
  checklist_confirmation_note: null,
  telegram_enabled: false,
}

export function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Statuses whose amounts count as committed spend. */
export const COUNTED_STATUSES: ClaimStatus[] = ["approved", "exported", "reimbursed"]
export const PENDING_STATUSES: ClaimStatus[] = ["submitted", "needs_info"]

const ERRORS: Record<string, Bi> = {
  AUTH007: { en: "You do not have permission for this action.", ar: "ليس لديك صلاحية لهذا الإجراء." },
  EXC002: { en: "Expense claim not found.", ar: "المطالبة غير موجودة." },
  EXC003: { en: "This claim was changed by someone else. Reload and try again.", ar: "تم تعديل المطالبة من مستخدم آخر. أعد التحميل وحاول مجدداً." },
  EXC004: { en: "This claim cannot be changed in its current status.", ar: "لا يمكن تعديل المطالبة في حالتها الحالية." },
  EXC005: { en: "That action is not allowed in the current status.", ar: "هذا الإجراء غير مسموح في الحالة الحالية." },
  EXC006: { en: "Expense date and total amount are required before submitting.", ar: "تاريخ المصروف والمبلغ الإجمالي مطلوبان قبل التقديم." },
  EXC007: { en: "You cannot review your own expense claim.", ar: "لا يمكنك مراجعة مطالبتك الخاصة." },
  EXC008: { en: "Resolve the possible duplicate before approving.", ar: "يجب حسم احتمال التكرار قبل الاعتماد." },
  EXC009: { en: "A comment is required for this action.", ar: "التعليق مطلوب لهذا الإجراء." },
  EXC010: { en: "Invalid payment method.", ar: "طريقة دفع غير صالحة." },
  EXC011: { en: "The Telegram bot is not enabled for this company.", ar: "بوت تيليجرام غير مفعّل لهذه الشركة." },
  EXC012: { en: "Too many link codes. Try again later.", ar: "عدد كبير من رموز الربط. حاول لاحقاً." },
  EXC013: { en: "Invalid file location.", ar: "موقع الملف غير صالح." },
  EXC014: { en: "Up to 10 attachments per claim.", ar: "الحد الأقصى 10 مرفقات لكل مطالبة." },
}

/** Maps an RPC error (e.g. "EXC006: ...") to a bilingual message. */
export function claimErrorMessage(err: unknown, locale: "en" | "ar" = "en"): string {
  const msg = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err ?? "")
  const code = /\b(AUTH007|EXC0\d\d)\b/.exec(msg)?.[1]
  if (code && ERRORS[code]) return ERRORS[code][locale]
  return locale === "ar" ? "تعذر إكمال العملية. حاول مرة أخرى." : "The action could not be completed. Please try again."
}
