// Single source of truth for the EliteDev v2.0 error code taxonomy.
//
// Maps every `ERR_<PREFIX><NNN>` code to its HTTP status and bilingual
// (Arabic / English) user-facing message. The bilingual envelope returned to
// the client is `{ code, message_ar, message_en }`; the HTTP status comes from
// `httpStatus` here.
//
// Reference: docs/phase-2-auth-plan.md section 8 (Error code taxonomy mapping)
//            docs/elite-master-prompt-v2.md section 5.2 (Error code taxonomy)
//
// Notes:
// - Only AUTH* codes are triggered by Phase 2 flows. DRV/PAY/VIO/VEH/ATT/ORD
//   codes are reserved for Phase 3+ but defined here so the envelope shape is
//   fixed now (auth plan 8.3).
// - AUTH001 message contains a `{minutes}` placeholder that the caller must
//   replace with the lockout duration before returning to the client.
// - AUTH005 uses HTTP 302 because it triggers a redirect, not an error body.

export type ErrorCode =
  // Auth (Phase 2)
  | "AUTH001"
  | "AUTH002"
  | "AUTH003"
  | "AUTH004"
  | "AUTH005"
  | "AUTH006"
  | "AUTH007"
  | "AUTH_RATE_LIMITED"
  | "AUTH_ACCOUNT_INACTIVE"
  | "AUTH_ACCOUNT_LOCKED"
  | "AUTH_INVITE_CREATE_FAILED"
  // Drivers (Phase 3+)
  | "DRV001"
  | "DRV002"
  | "DRV003"
  | "DRV004"
  | "DRV005"
  // Payroll (Phase 5)
  | "PAY001"
  | "PAY002"
  | "PAY003"
  | "PAY004"
  | "PAY005"
  | "PAY006"
  // Violations (Phase 4)
  | "VIO001"
  | "VIO002"
  | "VIO003"
  | "VIO004"
  // Vehicles (Phase 3+)
  | "VEH001"
  | "VEH002"
  | "VEH003"
  | "VEH004"
  // Attendance (Phase 4)
  | "ATT001"
  | "ATT002"
  | "ATT003"
  | "ATT004"
  | "ATT005"
  // Orders & Platforms (Phase 4)
  | "ORD001"
  | "ORD002"
  | "ORD003"
  | "ORD004"
  | "ORD005"
  // Accounting — Journal Engine (Phase 1, migration 027/031)
  | "JRN001"
  | "JRN002"
  | "JRN003"
  | "JRN004"
  | "JRN005"
  | "JRN006"
  | "JRN007"
  | "JRN008"
  | "JRN009"
  | "JRN010"
  | "JRN011"
  | "JRN012"
  | "JRN013"
  // Accounting — Periods (Phase 1)
  | "ACC001"
  | "ACC002"
  | "ACC003"
  | "ACC004"
  | "ACC005"
  | "ACC006"
  // Accounting — Chart of Accounts (Phase 2, migration 033)
  | "COA001"
  | "COA002"
  | "COA003"
  | "COA004"
  | "COA005"
  // Accounting — Customers (Phase 4, migration 037)
  | "CUS001"
  | "CUS002"
  | "CUS003"
  | "CUS004"
  | "CUS005"
  // Accounting — Suppliers (Phase 4, migration 037)
  | "SUP001"
  | "SUP002"
  | "SUP003"
  | "SUP004"
  | "SUP005"
  // Accounting — Invoice Engine (Phase 5, migration 038)
  | "INV001"
  | "INV002"
  | "INV003"
  | "INV004"
  | "INV005"
  | "INV006"
  | "INV007"
  | "INV008"
  | "INV009"
  | "INV010"
  | "INV011"
  | "INV012"
  | "INV013"
  | "INV014"
  // Accounting — Expenses (Phase 7, migration 040)
  | "EXP001"
  | "EXP002"
  | "EXP003"
  | "EXP004"
  | "EXP005"
  | "EXP006"
  // Accounting — VAT Engine (Phase 8, migration 041)
  | "VAT001"
  | "VAT002"
  | "VAT003"
  // Accounting — VAT Reconciliation (Phase 11, migration 051)
  | "VAT004"
  | "VAT005"
  // Accounting — VAT Return (Phase 12, IMPLEMENTATION-PLAN Phase 11)
  | "VAT006"
  // Accounting — Financial Statements (Phase 13, IMPLEMENTATION-PLAN Phase 12)
  | "STMT001"
  // Accounting — Payments Engine (Phase 10, migration 048)
  | "PMT001"
  | "PMT002"
  | "PMT003"
  | "PMT004"
  | "PMT005"
  | "PMT006"
  // Accounting — ZATCA Adapter (Phase 15, migration 054)
  | "ZAT001"
  | "ZAT002"
  // Catch-all
  | "ERR_INTERNAL"

export type ErrorDefinition = {
  code: ErrorCode
  httpStatus: number
  messageAr: string
  messageEn: string
}

export const ERROR_CODES: Record<ErrorCode, ErrorDefinition> = {
  // ── Auth ───────────────────────────────────────────────────────────────
  AUTH001: {
    code: "AUTH001",
    httpStatus: 423,
    messageAr: "الحساب مقفل. حاول مرة أخرى بعد {minutes} دقيقة.",
    messageEn: "Account locked. Try again in {minutes} min.",
  },
  AUTH002: {
    code: "AUTH002",
    httpStatus: 401,
    messageAr: "رمز التحقق الثنائي غير صحيح.",
    messageEn: "Invalid 2FA code.",
  },
  AUTH003: {
    code: "AUTH003",
    httpStatus: 401,
    messageAr: "انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.",
    messageEn: "Session expired. Please sign in again.",
  },
  AUTH004: {
    code: "AUTH004",
    httpStatus: 401,
    messageAr: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    messageEn: "Invalid email or password.",
  },
  AUTH005: {
    code: "AUTH005",
    httpStatus: 302,
    messageAr: "يرجى تغيير كلمة المرور الخاصة بك.",
    messageEn: "Please change your password.",
  },
  AUTH006: {
    code: "AUTH006",
    httpStatus: 401,
    messageAr: "مطلوب التحقق الثنائي.",
    messageEn: "2FA verification required.",
  },
  AUTH007: {
    code: "AUTH007",
    httpStatus: 403,
    messageAr: "ليس لديك صلاحية للقيام بهذا الإجراء.",
    messageEn: "You do not have permission to perform this action.",
  },
  AUTH_RATE_LIMITED: {
    code: "AUTH_RATE_LIMITED",
    httpStatus: 429,
    messageAr: "محاولات كثيرة. حاول مرة أخرى لاحقاً.",
    messageEn: "Too many attempts. Try again later.",
  },
  AUTH_ACCOUNT_INACTIVE: {
    code: "AUTH_ACCOUNT_INACTIVE",
    httpStatus: 403,
    messageAr: "تم تعطيل هذا الحساب. تواصل مع المدير.",
    messageEn: "This account is disabled. Contact your manager.",
  },
  AUTH_ACCOUNT_LOCKED: {
    code: "AUTH_ACCOUNT_LOCKED",
    httpStatus: 423,
    messageAr: "تم قفل الحساب مؤقتاً. حاول لاحقاً.",
    messageEn: "Account temporarily locked. Try later.",
  },
  AUTH_INVITE_CREATE_FAILED: {
    code: "AUTH_INVITE_CREATE_FAILED",
    httpStatus: 500,
    messageAr: "فشل إنشاء حساب المستخدم.",
    messageEn: "Failed to create the user account.",
  },

  // ── Drivers (Phase 3+) ─────────────────────────────────────────────────
  DRV001: {
    code: "DRV001",
    httpStatus: 404,
    messageAr: "السائق غير موجود.",
    messageEn: "Driver not found.",
  },
  DRV002: {
    code: "DRV002",
    httpStatus: 422,
    messageAr: "رقم الإقامة غير صالح.",
    messageEn: "Invalid Iqama number.",
  },
  DRV003: {
    code: "DRV003",
    httpStatus: 404,
    messageAr: "مستند السائق غير موجود.",
    messageEn: "Driver document not found.",
  },
  DRV004: {
    code: "DRV004",
    httpStatus: 409,
    messageAr: "السائق نشط في تعيينات حالية.",
    messageEn: "Driver is active in current assignments.",
  },
  DRV005: {
    code: "DRV005",
    httpStatus: 422,
    messageAr: "رقم رخصة القيادة غير صالح.",
    messageEn: "Invalid driver's license number.",
  },

  // ── Payroll (Phase 5) ──────────────────────────────────────────────────
  PAY001: {
    code: "PAY001",
    httpStatus: 409,
    messageAr: "لم يتم قفل فترة الحضور بعد.",
    messageEn: "Attendance period not locked.",
  },
  PAY002: {
    code: "PAY002",
    httpStatus: 422,
    messageAr: "قيمة الراتب غير صالحة.",
    messageEn: "Invalid salary value.",
  },
  PAY003: {
    code: "PAY003",
    httpStatus: 404,
    messageAr: "تشغيل الرواتب غير موجود.",
    messageEn: "Payroll run not found.",
  },
  PAY004: {
    code: "PAY004",
    httpStatus: 409,
    messageAr: "تشغيل الرواتب موجود بالفعل لهذه الفترة.",
    messageEn: "Payroll run already exists for this period.",
  },
  PAY005: {
    code: "PAY005",
    httpStatus: 422,
    messageAr: "قيمة الخصم غير صالحة.",
    messageEn: "Invalid deduction value.",
  },
  PAY006: {
    code: "PAY006",
    httpStatus: 422,
    messageAr: "قيمة البدل غير صالحة.",
    messageEn: "Invalid allowance value.",
  },

  // ── Violations (Phase 4) ──────────────────────────────────────────────
  VIO001: {
    code: "VIO001",
    httpStatus: 404,
    messageAr: "المخالفة غير موجودة.",
    messageEn: "Violation not found.",
  },
  VIO002: {
    code: "VIO002",
    httpStatus: 409,
    messageAr: "نافذة الاعتراض منتهية.",
    messageEn: "Dispute window closed.",
  },
  VIO003: {
    code: "VIO003",
    httpStatus: 404,
    messageAr: "مستند المخالفة غير موجود.",
    messageEn: "Violation document not found.",
  },
  VIO004: {
    code: "VIO004",
    httpStatus: 422,
    messageAr: "قيمة المخالفة غير صالحة.",
    messageEn: "Invalid violation amount.",
  },

  // ── Vehicles (Phase 3+) ────────────────────────────────────────────────
  VEH001: {
    code: "VEH001",
    httpStatus: 404,
    messageAr: "المركبة غير موجودة.",
    messageEn: "Vehicle not found.",
  },
  VEH002: {
    code: "VEH002",
    httpStatus: 422,
    messageAr: "رقم اللوحة غير صالح.",
    messageEn: "Invalid plate number.",
  },
  VEH003: {
    code: "VEH003",
    httpStatus: 422,
    messageAr: "تراجع في قراءة العداد غير مسموح.",
    messageEn: "Odometer regression not allowed.",
  },
  VEH004: {
    code: "VEH004",
    httpStatus: 409,
    messageAr: "المركبة نشطة في تعيينات حالية.",
    messageEn: "Vehicle is active in current assignments.",
  },

  // ── Attendance (Phase 4) ───────────────────────────────────────────────
  ATT001: {
    code: "ATT001",
    httpStatus: 409,
    messageAr: "تم قفل سجل الحضور.",
    messageEn: "Attendance record locked.",
  },
  ATT002: {
    code: "ATT002",
    httpStatus: 422,
    messageAr: "تكرار في سجل الحضور.",
    messageEn: "Duplicate attendance record.",
  },
  ATT003: {
    code: "ATT003",
    httpStatus: 404,
    messageAr: "سجل الحضور غير موجود.",
    messageEn: "Attendance record not found.",
  },
  ATT004: {
    code: "ATT004",
    httpStatus: 422,
    messageAr: "وقت الحضور غير صالح.",
    messageEn: "Invalid attendance time.",
  },
  ATT005: {
    code: "ATT005",
    httpStatus: 409,
    messageAr: "تعارض في سجل الإجازة.",
    messageEn: "Leave record conflict.",
  },

  // ── Orders & Platforms (Phase 4) ────────────────────────────────────────
  ORD001: {
    code: "ORD001",
    httpStatus: 404,
    messageAr: "الجلسة غير موجودة.",
    messageEn: "Session not found.",
  },
  ORD002: {
    code: "ORD002",
    httpStatus: 422,
    messageAr: "قيمة الطلب غير صالحة.",
    messageEn: "Invalid order amount.",
  },
  ORD003: {
    code: "ORD003",
    httpStatus: 409,
    messageAr: "الجلسة مغلقة بالفعل.",
    messageEn: "Session already closed.",
  },
  ORD004: {
    code: "ORD004",
    httpStatus: 404,
    messageAr: "المنصة غير موجودة.",
    messageEn: "Platform not found.",
  },
  ORD005: {
    code: "ORD005",
    httpStatus: 422,
    messageAr: "تاريخ الوردية غير صالح.",
    messageEn: "Invalid shift date.",
  },

  // ── Accounting — Journal Engine (Phase 1) ─────────────────────────────
  JRN001: {
    code: "JRN001",
    httpStatus: 409,
    messageAr: "القيود المرحّلة غير قابلة للتعديل؛ استخدم قيد عكسي.",
    messageEn: "Posted journal entries are immutable; use a reversal entry.",
  },
  JRN002: {
    code: "JRN002",
    httpStatus: 409,
    messageAr: "القيود المعكوسة لا يمكن تعديلها.",
    messageEn: "Reversed journal entries cannot be modified.",
  },
  JRN003: {
    code: "JRN003",
    httpStatus: 409,
    messageAr: "لا يمكن حذف القيود المرحّلة.",
    messageEn: "Posted journal entries cannot be deleted.",
  },
  JRN004: {
    code: "JRN004",
    httpStatus: 422,
    messageAr: "القيد المرحّل غير متوازن (المدين لا يساوي الدائن).",
    messageEn: "Posted journal entry does not balance (debits ≠ credits).",
  },
  JRN005: {
    code: "JRN005",
    httpStatus: 422,
    messageAr: "تاريخ القيد والوصف بالعربية مطلوبان.",
    messageEn: "Entry date and an Arabic description are required.",
  },
  JRN006: {
    code: "JRN006",
    httpStatus: 422,
    messageAr: "القيد يحتاج سطرين على الأقل وكل سطر يحتاج حساباً.",
    messageEn: "A journal entry needs at least two lines, each with an account.",
  },
  JRN007: {
    code: "JRN007",
    httpStatus: 422,
    messageAr: "كل سطر يجب أن يكون من جانب واحد وبمبلغ موجب.",
    messageEn: "Each line must be single-sided (debit XOR credit) with positive amounts.",
  },
  JRN008: {
    code: "JRN008",
    httpStatus: 422,
    messageAr: "الحساب لا ينتمي إلى هذه المنشأة.",
    messageEn: "The account does not belong to this tenant.",
  },
  JRN009: {
    code: "JRN009",
    httpStatus: 422,
    messageAr: "نوع القيد غير مدعوم.",
    messageEn: "Unsupported journal entry type.",
  },
  JRN010: {
    code: "JRN010",
    httpStatus: 404,
    messageAr: "القيد غير موجود أو لا ينتمي إلى هذه المنشأة.",
    messageEn: "Journal entry not found or does not belong to this tenant.",
  },
  JRN011: {
    code: "JRN011",
    httpStatus: 409,
    messageAr: "القيد معكوس بالفعل.",
    messageEn: "Journal entry is already reversed.",
  },
  JRN012: {
    code: "JRN012",
    httpStatus: 409,
    messageAr: "يمكن عكس القيود المرحّلة فقط.",
    messageEn: "Only posted journal entries can be reversed.",
  },
  JRN013: {
    code: "JRN013",
    httpStatus: 409,
    messageAr: "حالة القيد لا تسمح بهذا الإجراء.",
    messageEn: "Journal entry state does not permit this action.",
  },

  // ── Accounting — Chart of Accounts (Phase 2) ───────────────────────────
  COA001: {
    code: "COA001",
    httpStatus: 422,
    messageAr: "رمز الحساب يجب أن يكون من 3 إلى 6 أرقام.",
    messageEn: "Account code must be 3-6 digits.",
  },
  COA002: {
    code: "COA002",
    httpStatus: 422,
    messageAr: "الحساب الأب غير صالح (نفس المنشأة، نفس النوع، بدون حلقة).",
    messageEn: "Parent account is invalid (same tenant, same type, no cycle).",
  },
  COA003: {
    code: "COA003",
    httpStatus: 422,
    messageAr: "طبيعة الرصيد لا تتوافق مع نوع الحساب.",
    messageEn: "Normal balance is inconsistent with the account type.",
  },
  COA004: {
    code: "COA004",
    httpStatus: 409,
    messageAr: "الرمز والنوع وطبيعة الرصيد غير قابلة للتعديل لحساب عليه قيود مرحّلة.",
    messageEn: "Code, type and normal balance are immutable for an account with posted journal lines.",
  },
  COA005: {
    code: "COA005",
    httpStatus: 409,
    messageAr: "لا يمكن إيقاف الحساب وعليه قيود مرحّلة أو حسابات فرعية نشطة.",
    messageEn: "Account cannot be deactivated while it has posted journal lines or active children.",
  },

  // ── Accounting — Customers (Phase 4) ───────────────────────────────────
  CUS001: {
    code: "CUS001",
    httpStatus: 404,
    messageAr: "العميل غير موجود أو لا ينتمي إلى هذه المنشأة.",
    messageEn: "Customer not found or does not belong to this tenant.",
  },
  CUS002: {
    code: "CUS002",
    httpStatus: 422,
    messageAr: "الرقم الضريبي يجب أن يتكون من 15 رقماً بالضبط.",
    messageEn: "Tax number must be exactly 15 digits.",
  },
  CUS003: {
    code: "CUS003",
    httpStatus: 422,
    messageAr: "رمز العميل يجب أن يكون من 3 إلى 12 حرفاً (أحرف وأرقام وشرطات).",
    messageEn: "Customer code must be 3-12 characters (letters, digits, dashes).",
  },
  CUS004: {
    code: "CUS004",
    httpStatus: 422,
    messageAr: "حد الائتمان لا يمكن أن يكون سالباً.",
    messageEn: "Credit limit cannot be negative.",
  },
  CUS005: {
    code: "CUS005",
    httpStatus: 422,
    messageAr: "الاسم بالعربية مطلوب.",
    messageEn: "An Arabic name is required.",
  },

  // ── Accounting — Suppliers (Phase 4) ───────────────────────────────────
  SUP001: {
    code: "SUP001",
    httpStatus: 404,
    messageAr: "المورد غير موجود أو لا ينتمي إلى هذه المنشأة.",
    messageEn: "Supplier not found or does not belong to this tenant.",
  },
  SUP002: {
    code: "SUP002",
    httpStatus: 422,
    messageAr: "الرقم الضريبي يجب أن يتكون من 15 رقماً بالضبط.",
    messageEn: "Tax number must be exactly 15 digits.",
  },
  SUP003: {
    code: "SUP003",
    httpStatus: 422,
    messageAr: "رمز المورد يجب أن يكون من 3 إلى 12 حرفاً (أحرف وأرقام وشرطات).",
    messageEn: "Supplier code must be 3-12 characters (letters, digits, dashes).",
  },
  SUP004: {
    code: "SUP004",
    httpStatus: 422,
    messageAr: "حد الائتمان لا يمكن أن يكون سالباً.",
    messageEn: "Credit limit cannot be negative.",
  },
  SUP005: {
    code: "SUP005",
    httpStatus: 422,
    messageAr: "الاسم بالعربية مطلوب.",
    messageEn: "An Arabic name is required.",
  },

  // ── Accounting — Invoice Engine (Phase 5) ────────────────────────────
  INV001: {
    code: "INV001",
    httpStatus: 404,
    messageAr: "الفاتورة غير موجودة أو لا تنتمي إلى هذه المنشأة.",
    messageEn: "Invoice not found or does not belong to this tenant.",
  },
  INV002: {
    code: "INV002",
    httpStatus: 422,
    messageAr: "أحد بنود الفاتورة غير صالح (الوصف والكمية والسعر مطلوبة).",
    messageEn: "One of the invoice lines is invalid (description, quantity and price required).",
  },
  INV003: {
    code: "INV003",
    httpStatus: 409,
    messageAr: "الفاتورة المعتمدة غير قابلة للتعديل؛ استخدم إشعار دائن أو مدين.",
    messageEn: "Finalized invoices are immutable; use a credit or debit note.",
  },
  INV004: {
    code: "INV004",
    httpStatus: 422,
    messageAr: "حسابات الفاتورة غير متطابقة (الفرق بين الإجمالي والضريبة).",
    messageEn: "Invoice math does not match (total ≠ subtotal + VAT).",
  },
  INV005: {
    code: "INV005",
    httpStatus: 422,
    messageAr: "العميل مطلوب للفواتير البيعية والمورد للفواتير الشرائية.",
    messageEn: "A customer is required for sales invoices and a supplier for purchase invoices.",
  },
  INV006: {
    code: "INV006",
    httpStatus: 409,
    messageAr: "حالة الفاتورة لا تسمح بهذا الإجراء.",
    messageEn: "Invoice state does not permit this action.",
  },
  INV007: {
    code: "INV007",
    httpStatus: 409,
    messageAr: "لا يمكن إلغاء فاتورة مدفوعة أو مدفوعة جزئياً.",
    messageEn: "Only unpaid invoices can be cancelled.",
  },
  INV008: {
    code: "INV008",
    httpStatus: 422,
    messageAr: "تاريخ الاستحقاق لا يمكن أن يسبق تاريخ الإصدار.",
    messageEn: "Due date cannot be before the issue date.",
  },
  INV009: {
    code: "INV009",
    httpStatus: 409,
    messageAr: "تم إصدار إشعار دائن لهذه الفاتورة بالفعل.",
    messageEn: "A credit note was already issued for this invoice.",
  },
  INV010: {
    code: "INV010",
    httpStatus: 422,
    messageAr: "الإشعار يتطلب فاتورة مرجعية صالحة.",
    messageEn: "The note requires a valid reference invoice.",
  },
  INV011: {
    code: "INV011",
    httpStatus: 409,
    messageAr: "لا يمكن إصدار إشعار على فاتورة غير معتمدة.",
    messageEn: "Notes can only be issued against finalized invoices.",
  },
  INV012: {
    code: "INV012",
    httpStatus: 422,
    messageAr: "قيمة مالية غير صالحة (لا يمكن أن تكون سالبة أو غير محدودة).",
    messageEn: "Invalid monetary value (cannot be negative or non-finite).",
  },
  INV013: {
    code: "INV013",
    httpStatus: 422,
    messageAr: "الفاتورة تحتاج سطراً واحداً على الأقل.",
    messageEn: "An invoice needs at least one line.",
  },
  INV014: {
    code: "INV014",
    httpStatus: 409,
    messageAr: "الإشعارات غير قابلة للتعديل بعد الإصدار.",
    messageEn: "Notes are immutable once issued.",
  },

  // ── Accounting — Expenses (Phase 7) ───────────────────────────────────
  EXP001: {
    code: "EXP001",
    httpStatus: 404,
    messageAr: "المصروف غير موجود أو لا ينتمي إلى هذه المنشأة.",
    messageEn: "Expense not found or does not belong to this tenant.",
  },
  EXP002: {
    code: "EXP002",
    httpStatus: 409,
    messageAr: "تم اعتماد هذا المصروف بالفعل.",
    messageEn: "This expense is already approved.",
  },
  EXP003: {
    code: "EXP003",
    httpStatus: 422,
    messageAr: "نسبة الضريبة أو تصنيف الاسترداد غير صالح.",
    messageEn: "Invalid VAT rate or recoverability classification.",
  },
  EXP004: {
    code: "EXP004",
    httpStatus: 409,
    messageAr: "اعتماد المصروف يتطلب الموافِق والتاريخ.",
    messageEn: "Expense approval requires an approver and a timestamp.",
  },
  EXP005: {
    code: "EXP005",
    httpStatus: 422,
    messageAr: "لا يوجد حساب دليل حسابات مرتبط بهذه الفئة.",
    messageEn: "No Chart of Accounts mapping exists for this expense category.",
  },
  EXP006: {
    code: "EXP006",
    httpStatus: 422,
    messageAr: "بيانات المصروف غير صالحة (النوع والمبلغ والتاريخ مطلوبة).",
    messageEn: "Invalid expense data (type, positive amount and date are required).",
  },

  // ── Accounting — VAT Engine (Phase 8) ──────────────────────────────────
  VAT001: {
    code: "VAT001",
    httpStatus: 404,
    messageAr: "فترة ضريبة القيمة المضافة غير موجودة لهذا الشهر.",
    messageEn: "No VAT period exists for this month.",
  },
  VAT002: {
    code: "VAT002",
    httpStatus: 409,
    messageAr: "فترة ضريبة القيمة المضافة موجودة بالفعل لهذا الشهر.",
    messageEn: "The VAT period already exists for this month.",
  },
  VAT003: {
    code: "VAT003",
    httpStatus: 409,
    messageAr: "التسويات الضريبية النهائية غير قابلة للتعديل.",
    messageEn: "Finalized VAT adjustments are immutable.",
  },
  VAT004: {
    code: "VAT004",
    httpStatus: 409,
    messageAr: "البند ليس قيد المراجعة؛ إعادة التصنيف مقفلة.",
    messageEn: "Review item is not pending review; reclassification is locked.",
  },
  VAT005: {
    code: "VAT005",
    httpStatus: 404,
    messageAr: "لا توجد بيانات تسوية ضريبية لهذه الفترة.",
    messageEn: "No VAT reconciliation data for this period.",
  },
  VAT006: {
    code: "VAT006",
    httpStatus: 404,
    messageAr: "لا توجد بيانات إقرار ضريبي لهذه الفترة.",
    messageEn: "No VAT return data for this period.",
  },
  STMT001: {
    code: "STMT001",
    httpStatus: 404,
    messageAr: "لا توجد بيانات قوائم مالية لهذه الفترة.",
    messageEn: "No financial statement data for this period.",
  },

  // ── Accounting — Payments Engine (Phase 10) ────────────────────────────
  PMT001: {
    code: "PMT001",
    httpStatus: 409,
    messageAr: "مبلغ التخصيص يتجاوز الرصيد المتبقي للذمة (المدينة/الدائنة).",
    messageEn: "Allocation amount exceeds the outstanding AR/AP balance.",
  },
  PMT002: {
    code: "PMT002",
    httpStatus: 409,
    messageAr: "الدفعة غير موجودة أو ملغاة؛ لا يمكن إضافة تخصيصات عليها.",
    messageEn: "Payment is missing or void; allocations are frozen.",
  },
  PMT003: {
    code: "PMT003",
    httpStatus: 409,
    messageAr: "مجموع التخصيصات يتجاوز مبلغ الدفعة.",
    messageEn: "Total allocations exceed the payment amount.",
  },
  PMT004: {
    code: "PMT004",
    httpStatus: 422,
    messageAr: "بيانات الدفعة غير صالحة (الاتجاه والطرف والمبلغ المالي مطلوبة).",
    messageEn: "Invalid payment data (direction, party and positive amount are required).",
  },
  PMT005: {
    code: "PMT005",
    httpStatus: 404,
    messageAr: "الدفعة غير موجودة أو لا تنتمي إلى هذه المنشأة.",
    messageEn: "Payment not found or does not belong to this tenant.",
  },
  PMT006: {
    code: "PMT006",
    httpStatus: 404,
    messageAr: "الحساب البنكي غير موجود أو لا ينتمي إلى هذه المنشأة.",
    messageEn: "Bank account not found or does not belong to this tenant.",
  },

  // ── Accounting — Periods (Phase 1) ─────────────────────────────────────
  ACC001: {
    code: "ACC001",
    httpStatus: 409,
    messageAr: "الفترة المحاسبية لهذا التاريخ مغلقة.",
    messageEn: "The accounting period for this date is closed.",
  },
  ACC002: {
    code: "ACC002",
    httpStatus: 409,
    messageAr: "الفترة المحاسبية موجودة بالفعل لهذا الشهر.",
    messageEn: "The accounting period already exists for this month.",
  },
  ACC003: {
    code: "ACC003",
    httpStatus: 404,
    messageAr: "الفترة المحاسبية غير موجودة أو لا تنتمي إلى هذه المنشأة.",
    messageEn: "Accounting period not found or does not belong to this tenant.",
  },
  ACC004: {
    code: "ACC004",
    httpStatus: 409,
    messageAr: "الفترة تحتوي قيوداً مسودّة معلقة؛ رحّلها أو ألغها قبل الإغلاق.",
    messageEn: "Period has pending draft entries; post or remove them before closing.",
  },
  ACC005: {
    code: "ACC005",
    httpStatus: 409,
    messageAr: "حالة الفترة لا تسمح بهذا الإجراء.",
    messageEn: "Period state does not permit this action.",
  },
  ACC006: {
    code: "ACC006",
    httpStatus: 422,
    messageAr: "سبب إعادة الفتح مطلوب.",
    messageEn: "A reopen reason is required.",
  },

  // ── Accounting — ZATCA Adapter (Phase 15) ─────────────────────────────
  ZAT001: {
    code: "ZAT001",
    httpStatus: 409,
    messageAr: "لا يمكن إرسال الفاتورة إلى ZATCA: رقم ضريبة البائع مفقود.",
    messageEn: "Cannot transmit to ZATCA: seller VAT number is missing.",
  },
  ZAT002: {
    code: "ZAT002",
    httpStatus: 409,
    messageAr: "لا يمكن إرسال الفاتورة إلى ZATCA: رقم ضريبة المشتري مفقود للفاتورة الضريبية.",
    messageEn: "Cannot transmit to ZATCA: buyer tax number is missing for a tax invoice.",
  },

  // ── Catch-all ─────────────────────────────────────────────────────────
  ERR_INTERNAL: {
    code: "ERR_INTERNAL",
    httpStatus: 500,
    messageAr: "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.",
    messageEn: "An unexpected error occurred. Please try again.",
  },
}

/**
 * Look up the definition for a code. Falls back to `ERR_INTERNAL` for an
 * unknown code so the envelope shape is always stable.
 */
export function getErrorDefinition(code: string): ErrorDefinition {
  return ERROR_CODES[code as ErrorCode] ?? ERROR_CODES.ERR_INTERNAL
}
