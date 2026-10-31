// Client-safe "Getting started" checklist model for new tenants.

export type SetupStepKey = "company" | "bank" | "platform" | "driver" | "vehicle" | "team" | "invoice"

export interface SetupCounts {
  companyComplete: boolean
  bankAccounts: number
  platforms: number
  drivers: number
  vehicles: number
  users: number
  invoices: number
}

export interface SetupStep {
  key: SetupStepKey
  done: boolean
  href: string
  titleAr: string
  titleEn: string
  hintAr: string
  hintEn: string
}

export interface SetupProgress {
  steps: SetupStep[]
  completed: number
  total: number
}

export function buildSetupProgress(c: SetupCounts): SetupProgress {
  const steps: SetupStep[] = [
    { key: "company", done: c.companyComplete, href: "/settings/company", titleAr: "أكمل ملف المنشأة", titleEn: "Complete your company profile", hintAr: "الاسم، السجل التجاري، الرقم الضريبي والشعار — تظهر في الفواتير.", hintEn: "Name, CR, VAT number and logo — printed on invoices." },
    { key: "bank", done: c.bankAccounts > 0, href: "/accounting?tab=payments", titleAr: "أضف حساباً بنكياً", titleEn: "Add a bank account", hintAr: "لعرض بيانات التحويل في الفواتير وتسجيل الدفعات.", hintEn: "Shown on invoices and used to record payments." },
    { key: "platform", done: c.platforms > 0, href: "/platforms", titleAr: "فعّل منصة توصيل", titleEn: "Activate a delivery platform", hintAr: "مثل هنقرستيشن أو جاهز أو كيتا لربط الطلبات والرواتب.", hintEn: "E.g. HungerStation, Jahez or Keeta to link orders and payroll." },
    { key: "driver", done: c.drivers > 0, href: "/drivers", titleAr: "أضف أول سائق", titleEn: "Add your first driver", hintAr: "مع الإقامة والرخصة لتتبع انتهاء الوثائق تلقائياً.", hintEn: "With Iqama and license so expiries are tracked automatically." },
    { key: "vehicle", done: c.vehicles > 0, href: "/vehicles", titleAr: "سجّل مركبة", titleEn: "Register a vehicle", hintAr: "اللوحة، الاستمارة، التأمين ونوع الملكية.", hintEn: "Plate, registration, insurance and ownership type." },
    { key: "team", done: c.users > 1, href: "/users", titleAr: "ادعُ فريقك", titleEn: "Invite your team", hintAr: "امنح المحاسبين والمشرفين صلاحيات حسب الدور.", hintEn: "Give accountants and supervisors role-based access." },
    { key: "invoice", done: c.invoices > 0, href: "/invoices", titleAr: "أنشئ أول فاتورة", titleEn: "Create your first invoice", hintAr: "فاتورة ضريبية مع رمز QR وقيد محاسبي تلقائي.", hintEn: "Tax invoice with QR code and automatic journal entry." },
  ]
  return { steps, completed: steps.filter((s) => s.done).length, total: steps.length }
}

export function isCompanyProfileComplete(t: {
  name_ar?: string | null
  vat_number?: string | null
  cr_number?: string | null
  logo_url?: string | null
} | null): boolean {
  if (!t) return false
  return [t.name_ar, t.vat_number, t.cr_number, t.logo_url].every((v) => typeof v === "string" && v.trim().length > 0)
}
