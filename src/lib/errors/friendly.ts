// Turns database / server-action error text into clear bilingual messages.
// Database functions raise codes such as "PAY_INPUTS_UNREVIEWED" or
// "FLT005: record changed; reload before saving"; users should never see the
// raw code. Exact codes use the dictionary; otherwise generic rules by suffix
// keep the message meaningful. Plain human sentences pass through unchanged.
import { DRIVER_MESSAGES } from "./friendly-drivers"

type Pair = readonly [en: string, ar: string]

const MESSAGES: Record<string, Pair> = {
  ...DRIVER_MESSAGES,
  // Fleet / vehicles / maintenance
  FLT003: ["The vehicle or record was not found, or the vehicle is not active.", "لم يتم العثور على المركبة أو السجل، أو المركبة غير نشطة."],
  FLT004: ["Retired vehicles cannot receive operational changes.", "لا يمكن إجراء تغييرات تشغيلية على مركبة متقاعدة."],
  FLT005: ["This record was changed by someone else. Reload and try again.", "تم تعديل هذا السجل من مستخدم آخر. أعد التحميل وحاول مجددًا."],
  FLT008: ["Maintenance type and fault description are required.", "نوع الصيانة ووصف العطل مطلوبان."],
  FLT010: ["Some values are invalid or too long. Check the form.", "بعض القيم غير صحيحة أو طويلة جدًا. راجع النموذج."],
  FLT011: ["Dates cannot be in the future, and completion must follow entry.", "لا يمكن أن تكون التواريخ مستقبلية، ويجب أن يلي الإنجاز تاريخ الدخول."],
  FLT012: ["A reason is required.", "السبب مطلوب."],
  FLT013: ["End active assignments and maintenance before archiving.", "أنهِ التعيينات والصيانة النشطة قبل الأرشفة."],
  FLT014: ["A valid plate (e.g. ABC 1234), make and model are required.", "رقم لوحة صحيح (مثل ABC 1234) والماركة والموديل مطلوبة."],
  FLT015: ["Status is managed automatically by assignments and maintenance.", "تُدار الحالة تلقائيًا عبر التعيينات والصيانة."],
  FLT016: ["The driver or vehicle is no longer available.", "السائق أو المركبة لم يعد متاحًا."],
  FLT017: ["No current assignment was found.", "لا يوجد تعيين حالي."],
  FLT019: ["Verified documents cannot be edited; upload a replacement.", "لا يمكن تعديل المستندات الموثقة؛ ارفع مستندًا بديلًا."],
  FLT025: ["Inspect and complete every checklist item.", "افحص وأكمل جميع بنود قائمة التحقق."],
  FLT026: ["End the assignment before recording the return.", "أنهِ التعيين قبل تسجيل الإرجاع."],
  VEH003: ["The odometer reading cannot go backwards.", "لا يمكن أن تقل قراءة العداد عن السابقة."],
  // Payroll (monthly preparation workflow)
  PAY_INPUTS_UNREVIEWED: ["Lock the month's attendance and review orders before calculating payroll.", "اعتمد (أقفل) حضور الشهر وراجع الطلبات قبل احتساب الرواتب."],
  PAY_DRIVER_INPUTS_UNREVIEWED: ["This driver's attendance and orders must be reviewed first.", "يجب مراجعة حضور وطلبات هذا السائق أولًا."],
  PAY_ATTENDANCE_INCOMPLETE: ["Attendance for this month is incomplete.", "حضور هذا الشهر غير مكتمل."],
  PAY_ORDERS_UNPREPARED: ["Review the month's orders before continuing.", "راجع طلبات الشهر قبل المتابعة."],
  PAY_RULE_INCOMPLETE: ["The driver's payroll rule is incomplete. Complete it in payroll rules.", "قاعدة رواتب السائق غير مكتملة. أكملها من قواعد الرواتب."],
  PAY_NO_ACTIVE_DRIVERS: ["There are no active drivers for this period.", "لا يوجد سائقون نشطون في هذه الفترة."],
  PAY_OPEN_PERIOD_FIRST: ["Open the payroll period first.", "افتح فترة الرواتب أولًا."],
  PAY_PERIOD_ALREADY_EXISTS: ["A payroll period already exists for this month.", "توجد فترة رواتب لهذا الشهر بالفعل."],
  PAY_PERIOD_LOCKED: ["This payroll period is locked.", "فترة الرواتب هذه مقفلة."],
  PAY_PREPARATION_LOCKED: ["Payroll preparation for this month is locked.", "تجهيز رواتب هذا الشهر مقفل."],
  PAY_BASIS_LOCKED: ["The payroll basis for this month is locked.", "أساس رواتب هذا الشهر مقفل."],
  PAY_MIDMONTH_RULE_REQUIRES_SPLIT: ["The rule changed mid-month; split the period before calculating.", "تغيّرت القاعدة في منتصف الشهر؛ قسّم الفترة قبل الاحتساب."],
  PAY_CANCEL_REASON_REQUIRED: ["A cancellation reason is required.", "سبب الإلغاء مطلوب."],
  PAY_REVIEW_NOTE_REQUIRED: ["A review note is required.", "ملاحظة المراجعة مطلوبة."],
  PAY_WORKING_DAYS_INVALID: ["Working days are invalid for this month.", "أيام العمل غير صحيحة لهذا الشهر."],
  PAY_ADVANCE_REPAYMENT_MISMATCH: ["Advance repayments do not match the advance amount.", "أقساط السلفة لا تطابق مبلغها."],
  PAY_ADVANCE_ALREADY_RESERVED: ["This advance is already included in a payroll.", "هذه السلفة مدرجة في مسير رواتب بالفعل."],
  PAYENG004: ["This payroll run changed. Reload and try again.", "تم تعديل مسير الرواتب. أعد التحميل وحاول مجددًا."],
  PAYENG005: ["Only draft payroll runs can be approved or replaced; this month is already approved.", "يمكن اعتماد أو استبدال المسودات فقط؛ هذا الشهر معتمد بالفعل."],
  PAYENG008: ["Reverse the posted payroll journal before cancelling.", "اعكس قيد الرواتب المرحّل قبل الإلغاء."],
  // Orders
  ORDER_ACTIVE_TENANT_PLATFORM_REQUIRED: ["Choose an active platform of this company.", "اختر منصة نشطة تابعة لهذه الشركة."],
  ORDER_TENANT_DRIVER_REQUIRED: ["Choose a driver of this company.", "اختر سائقًا تابعًا لهذه الشركة."],
  ORDER_INVALID_AMOUNT: ["Amounts must be zero or more with at most 2 decimals.", "يجب أن تكون المبالغ صفرًا أو أكثر بحد أقصى منزلتين عشريتين."],
  ORDER_INVALID_COUNT: ["Order counts must be whole numbers of zero or more.", "يجب أن تكون أعداد الطلبات أعدادًا صحيحة غير سالبة."],
  ORDER_INVALID_DATE: ["The date is invalid or in the future.", "التاريخ غير صحيح أو في المستقبل."],
  ORDER_LOCK_REQUIRES_PREPARATION: ["This month is locked for payroll; changes need payroll preparation.", "هذا الشهر مقفل للرواتب؛ التعديل يتطلب تجهيز الرواتب."],
  // Leave
  LEAVE_OVERLAP: ["This leave overlaps another leave request.", "هذه الإجازة تتداخل مع طلب إجازة آخر."],
  LEAVE_DATES: ["The leave dates are invalid.", "تواريخ الإجازة غير صحيحة."],
  LEAVE_DRIVER_INACTIVE: ["Leave can only be requested for active drivers.", "يمكن طلب الإجازة للسائقين النشطين فقط."],
  LEAVE_POLICY_REVIEW: ["The request exceeds the leave policy balance and needs review.", "الطلب يتجاوز رصيد سياسة الإجازات ويحتاج مراجعة."],
  LEAVE_REASON_REQUIRED: ["A reason is required.", "السبب مطلوب."],
  LEAVE_TYPE_REQUIRED: ["Choose a leave type.", "اختر نوع الإجازة."],
  // Applications
  APP002: ["This application was already decided.", "تم البت في هذا الطلب مسبقًا."],
  APP004: ["A rejection note is required.", "ملاحظة الرفض مطلوبة."],
  APP_DOCUMENTS_REQUIRED: ["Profile photo, identity and license documents are required.", "الصورة الشخصية ومستندا الهوية والرخصة مطلوبة."],
  // Expenses
  EXP002: ["This expense is already approved.", "هذا المصروف معتمد بالفعل."],
  EXP005: ["No chart-of-accounts mapping exists for this category. Set it in accounting settings.", "لا يوجد ربط بدليل الحسابات لهذه الفئة. اضبطه من إعدادات المحاسبة."],
  EXP_REJECTED: ["This expense was already rejected.", "تم رفض هذا المصروف مسبقًا."],
  EXP_CANCELLED: ["This expense was cancelled.", "تم إلغاء هذا المصروف."],
  MASTER_REFERENCED: ["This party has financial history; deactivate it instead of deleting.", "لهذا الطرف سجل مالي؛ قم بإيقافه بدلًا من حذفه."],
  MASTER_DUPLICATE: ["This code already exists.", "هذا الرمز موجود بالفعل."],
  MASTER_ASSURANCE_REQUIRED: ["Two-factor authentication is required for this change.", "التحقق بخطوتين مطلوب لهذا التعديل."],
}

const GENERIC: Array<[RegExp, Pair]> = [
  [/(^|_)(STALE|STALE_VERSION|CHANGED|RESERVATION_CHANGED|SNAPSHOT_CHANGED)$/, ["This record was changed. Reload and try again.", "تم تعديل هذا السجل. أعد التحميل وحاول مجددًا."]],
  [/(^|_)(FORBIDDEN|PERMISSION|CALLER_REQUIRED|AUTH)$/, ["You do not have permission for this action.", "ليست لديك صلاحية لهذا الإجراء."]],
  [/(^|_)NOT_FOUND$/, ["The record was not found or was removed.", "لم يتم العثور على السجل أو تمت إزالته."]],
  [/(^|_)(IMMUTABLE|HISTORY_IMMUTABLE|LOCKED|LOCKED_PERIOD)$/, ["This record is locked and cannot be changed.", "هذا السجل مقفل ولا يمكن تعديله."]],
  [/(^|_)(ALREADY_DECIDED|ALREADY_STATUS|ALREADY_CURRENT)$/, ["This was already processed.", "تمت معالجة هذا مسبقًا."]],
  [/(^|_)(TRANSITION_INVALID|INVALID_TRANSITION)$/, ["This action is not allowed in the current status.", "هذا الإجراء غير مسموح في الحالة الحالية."]],
  [/(^|_)(REQUIRED|REASON_REQUIRED)$/, ["Some required information is missing.", "بعض المعلومات المطلوبة ناقصة."]],
  [/(^|_)(INPUT|INVALID|PAYLOAD_INVALID|TOO_LONG|PAGE_INVALID)$/, ["Some values are invalid. Check the form and try again.", "بعض القيم غير صحيحة. راجع النموذج وحاول مجددًا."]],
  [/(^|_)(REVIEW|REVIEW_REQUIRED|FINANCE_REVIEW)$/, ["This needs a review before it can continue.", "يحتاج هذا إلى مراجعة قبل المتابعة."]],
  [/(^|_)(RETRY_MISMATCH|REQUEST_REUSED|REQUEST_CONFLICT|RETRY)$/, ["This request was already submitted with different details. Reload and try again.", "تم إرسال هذا الطلب مسبقًا بتفاصيل مختلفة. أعد التحميل وحاول مجددًا."]],
]

const CODE = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)(?::\s*([\s\S]*))?$/

function isCode(token: string) {
  // Codes are upper-case identifiers with a digit or underscore (e.g. FLT005, PAY_RULE_INCOMPLETE).
  return /^[A-Z][A-Z0-9_]{2,}$/.test(token) && /[0-9_]/.test(token)
}

export function friendlyError(raw: unknown, isAr: boolean, fallback?: string): string {
  const text = (typeof raw === "string" ? raw : raw instanceof Error ? raw.message : "").trim()
  const empty = fallback || (isAr ? "حدث خطأ. حاول مجددًا." : "Something went wrong. Try again.")
  if (!text) return empty
  const m = CODE.exec(text)
  if (!m || !isCode(m[1])) return text
  const [, code, detail] = m
  const hit = MESSAGES[code] ?? MESSAGES[code.replace(/:.*$/, "")]
  if (hit) return isAr ? hit[1] : hit[0]
  // "CODE: readable sentence" → the sentence (English); keep it readable in Arabic too.
  if (detail && /[a-z]/.test(detail) && !/%/.test(detail)) {
    const sentence = detail.charAt(0).toUpperCase() + detail.slice(1)
    return isAr ? `تعذر إكمال العملية: ${sentence}` : sentence
  }
  for (const [re, pair] of GENERIC) if (re.test(code)) return isAr ? pair[1] : pair[0]
  return isAr ? `تعذر إكمال العملية (${code}). حاول مجددًا أو تواصل مع الدعم.` : `The action could not be completed (${code}). Try again or contact support.`
}

/** Current UI language on the client (the app sets <html lang>). */
export function currentIsArabic(): boolean {
  if (typeof document === "undefined") return true
  return (document.documentElement.lang || "ar").toLowerCase().startsWith("ar")
}
