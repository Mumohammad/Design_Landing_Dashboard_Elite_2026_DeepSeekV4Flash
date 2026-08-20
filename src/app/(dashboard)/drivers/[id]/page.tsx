"use client"

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { DriverTabs } from "./driver-tabs"
import type { Driver, DriverCategory, DriverStatus } from "@/types/drivers"
import type { LucideIcon } from "lucide-react"
import { ArrowLeft, BadgeCheck, Briefcase, Car, Phone, User, Wallet } from "lucide-react"

const STATUS_META: Record<DriverStatus, { ar: string; en: string; className: string }> = {
  active: {
    ar: "نشط",
    en: "Active",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
  },
  on_leave: {
    ar: "في إجازة",
    en: "On Leave",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20",
  },
  suspended: {
    ar: "معلّق",
    en: "Suspended",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
  draft: {
    ar: "مسودة",
    en: "Draft",
    className:
      "bg-gray-500/15 text-gray-700 dark:text-gray-300 border border-gray-500/20",
  },
  terminated: {
    ar: "منهى",
    en: "Terminated",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
  blacklisted: {
    ar: "محظور",
    en: "Blacklisted",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
}

const CATEGORY_META: Record<DriverCategory, { ar: string; en: string; className: string }> = {
  sponsored_type1: {
    ar: "كفيل نوع ١",
    en: "Sponsored T1",
    className:
      "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300 border border-elite-blue-500/20",
  },
  sponsored_type2: {
    ar: "كفيل نوع ٢",
    en: "Sponsored T2",
    className:
      "bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/20",
  },
  freelancer: {
    ar: "مستقل",
    en: "Freelancer",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20",
  },
}

function InfoGroup({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
        <Icon className="h-4 w-4 text-elite-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">{children}</dl>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground">{value}</dd>
    </div>
  )
}

function QuickStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

export default function DriverDetailPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const isAr = locale === "ar"

  const rawId = params?.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId

  const [driver, setDriver] = useState<Driver | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!id) {
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setError(null)
      const supabase = createClient()
      const { data, error: queryError } = await supabase
        .from("drivers")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle()

      if (cancelled) return
      if (queryError) {
        console.error("Failed to load driver:", queryError)
        setError(queryError.message)
        setDriver(null)
      } else {
        setDriver((data as Driver | null) ?? null)
      }
      setIsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const fmt = (v: string | null | undefined) =>
    v !== null && v !== undefined && v.length > 0 ? v : "—"
  const fmtBool = (v: boolean | null | undefined) =>
    v ? t.common.yes : t.common.no
  const fmtDate = (v: string | null | undefined) => {
    if (!v) return "—"
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return v
    return new Intl.DateTimeFormat("en-GB").format(d)
  }
  const fmtMoney = (v: number | null | undefined) => {
    if (v === null || v === undefined) return "—"
    return `${v.toLocaleString("en-US")} ${isAr ? "ر.س" : "SAR"}`
  }

  if (isLoading) {
    return (
      <div className="space-y-6 px-4 py-4 lg:px-6">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4 px-4 py-4 lg:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/drivers")}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t.common.back}
        </Button>
        <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">{t.common.error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            {t.common.retry}
          </Button>
        </div>
      </div>
    )
  }

  if (!driver) {
    return (
      <div className="space-y-4 px-4 py-4 lg:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/drivers")}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t.common.back}
        </Button>
        <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">
            {isAr ? "السائق غير موجود" : "Driver not found"}
          </p>
        </div>
      </div>
    )
  }

  const initials =
    driver.full_name_ar?.slice(0, 1) ?? driver.full_name_en?.slice(0, 1) ?? "?"
  const statusMeta = STATUS_META[driver.status]
  const categoryMeta = CATEGORY_META[driver.category]

  return (
    <div className="page-enter space-y-6 px-4 py-4 lg:px-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/drivers")}
        className="w-fit gap-1.5"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {t.common.back}
      </Button>

      {/* Profile header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 p-6 shadow-sm backdrop-blur-sm">
        <div
          className="absolute top-0 right-0 h-32 w-32 rounded-full opacity-[0.06]"
          style={{ backgroundColor: "#1E5A99", transform: "translate(30%, -30%)" }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 ring-2 ring-border/40">
              {driver.photo_url && (
                <AvatarImage src={driver.photo_url} alt={driver.full_name_ar} />
              )}
              <AvatarFallback className="bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-lg font-semibold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {driver.full_name_ar}
              </h1>
              {driver.full_name_en && (
                <p className="text-sm text-muted-foreground" dir="ltr">
                  {driver.full_name_en}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {driver.driver_code && (
                  <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-xs text-foreground">
                    {driver.driver_code}
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    statusMeta.className,
                  )}
                >
                  {isAr ? statusMeta.ar : statusMeta.en}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    categoryMeta.className,
                  )}
                >
                  {isAr ? categoryMeta.ar : categoryMeta.en}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 sm:gap-6">
            <QuickStat
              label={isAr ? "الاكتمال" : "Completeness"}
              value={`${driver.profile_completeness_score}%`}
            />
            <QuickStat
              label={isAr ? "تاريخ التعيين" : "Hire Date"}
              value={fmtDate(driver.hire_date)}
            />
            <QuickStat
              label={isAr ? "مخاطر الامتثال" : "Compliance Risk"}
              value={`${driver.compliance_risk_score}`}
            />
          </div>
        </div>
      </div>

      <DriverTabs
        driver={driver}
        overview={
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InfoGroup icon={User} title={isAr ? "الهوية" : "Identity"}>
              <InfoRow
                label={isAr ? "الجنسية" : "Nationality"}
                value={fmt(driver.nationality)}
              />
              <InfoRow
                label={isAr ? "تاريخ الميلاد" : "Date of Birth"}
                value={fmtDate(driver.date_of_birth)}
              />
              <InfoRow
                label={isAr ? "مكان الميلاد" : "Place of Birth"}
                value={fmt(driver.place_of_birth)}
              />
              <InfoRow label={isAr ? "الجنس" : "Gender"} value={fmt(driver.gender)} />
              <InfoRow
                label={isAr ? "الحالة الاجتماعية" : "Marital Status"}
                value={fmt(driver.marital_status)}
              />
            </InfoGroup>

            <InfoGroup icon={BadgeCheck} title={isAr ? "القانونية" : "Legal"}>
              <InfoRow
                label={isAr ? "رقم الإقامة" : "Iqama No."}
                value={fmt(driver.iqama_number)}
              />
              <InfoRow
                label={isAr ? "انتهاء الإقامة" : "Iqama Expiry"}
                value={fmtDate(driver.iqama_expiry_date)}
              />
              <InfoRow
                label={isAr ? "رقم الجواز" : "Passport No."}
                value={fmt(driver.passport_number)}
              />
              <InfoRow
                label={isAr ? "انتهاء الجواز" : "Passport Expiry"}
                value={fmtDate(driver.passport_expiry_date)}
              />
              <InfoRow
                label={isAr ? "رقم الرخصة" : "License No."}
                value={fmt(driver.license_number)}
              />
              <InfoRow
                label={isAr ? "نوع الرخصة" : "License Type"}
                value={fmt(driver.license_type)}
              />
              <InfoRow
                label={isAr ? "انتهاء الرخصة" : "License Expiry"}
                value={fmtDate(driver.license_expiry_date)}
              />
            </InfoGroup>

            <InfoGroup icon={Phone} title={isAr ? "التواصل" : "Contact"}>
              <InfoRow
                label={isAr ? "الجوال الأساسي" : "Primary Mobile"}
                value={<span dir="ltr">{fmt(driver.primary_mobile)}</span>}
              />
              <InfoRow
                label={isAr ? "الجوال الثانوي" : "Secondary Mobile"}
                value={<span dir="ltr">{fmt(driver.secondary_mobile)}</span>}
              />
              <InfoRow
                label={isAr ? "البريد الشخصي" : "Personal Email"}
                value={<span dir="ltr">{fmt(driver.personal_email)}</span>}
              />
              <InfoRow
                label={isAr ? "البريد الوظيفي" : "Work Email"}
                value={<span dir="ltr">{fmt(driver.work_email)}</span>}
              />
              <InfoRow
                label={isAr ? "المدينة" : "City"}
                value={fmt(driver.current_city)}
              />
              <InfoRow
                label={isAr ? "العنوان الوطني" : "National Address"}
                value={fmt(driver.national_address)}
              />
            </InfoGroup>

            <InfoGroup icon={Briefcase} title={isAr ? "التوظيف" : "Employment"}>
              <InfoRow
                label={isAr ? "الفئة" : "Category"}
                value={isAr ? categoryMeta.ar : categoryMeta.en}
              />
              <InfoRow
                label={isAr ? "نوع التوظيف" : "Employment Type"}
                value={fmt(driver.employment_type)}
              />
              <InfoRow
                label={isAr ? "نوع العقد" : "Contract Type"}
                value={fmt(driver.contract_type)}
              />
              <InfoRow
                label={isAr ? "المسمى الوظيفي" : "Job Title"}
                value={fmt(driver.job_title)}
              />
              <InfoRow
                label={isAr ? "القسم" : "Department"}
                value={fmt(driver.department)}
              />
              <InfoRow
                label={isAr ? "تاريخ التعيين" : "Hire Date"}
                value={fmtDate(driver.hire_date)}
              />
              <InfoRow
                label={isAr ? "بداية العقد" : "Contract Start"}
                value={fmtDate(driver.contract_start)}
              />
              <InfoRow
                label={isAr ? "نهاية العقد" : "Contract End"}
                value={fmtDate(driver.contract_end)}
              />
            </InfoGroup>

            <InfoGroup icon={Wallet} title={isAr ? "الرواتب" : "Payroll"}>
              <InfoRow
                label={isAr ? "الراتب الأساسي" : "Basic Salary"}
                value={fmtMoney(driver.basic_salary)}
              />
              <InfoRow
                label={isAr ? "بدل السكن" : "Housing Allowance"}
                value={fmtMoney(driver.housing_allowance)}
              />
              <InfoRow
                label={isAr ? "بدل النقل" : "Transport Allowance"}
                value={fmtMoney(driver.transport_allowance)}
              />
              <InfoRow
                label={isAr ? "البنك" : "Bank"}
                value={fmt(driver.bank_name)}
              />
              <InfoRow
                label="IBAN"
                value={<span dir="ltr">{fmt(driver.iban)}</span>}
              />
              <InfoRow
                label={isAr ? "طريقة الدفع" : "Payment Method"}
                value={fmt(driver.payment_method)}
              />
              <InfoRow
                label={isAr ? "مجموعة الرواتب" : "Payroll Group"}
                value={fmt(driver.payroll_group)}
              />
            </InfoGroup>

            <InfoGroup icon={Car} title={isAr ? "العمليات" : "Operations"}>
              <InfoRow
                label={isAr ? "المركبة الحالية" : "Current Vehicle"}
                value={fmt(driver.current_vehicle_id)}
              />
              <InfoRow
                label={isAr ? "نوع السائق" : "Driver Type"}
                value={fmt(driver.driver_type)}
              />
              <InfoRow
                label={isAr ? "منطقة المدينة" : "City Zone"}
                value={fmt(driver.city_zone)}
              />
              <InfoRow
                label={isAr ? "منطقة الخدمة" : "Service Area"}
                value={fmt(driver.service_area)}
              />
              <InfoRow
                label={isAr ? "نوع الوردية" : "Shift Type"}
                value={fmt(driver.shift_type)}
              />
              <InfoRow
                label={isAr ? "صالح للإرسال" : "Dispatch Eligible"}
                value={fmtBool(driver.dispatch_eligible)}
              />
              <InfoRow
                label={isAr ? "رصيد COD المستحق" : "COD Outstanding"}
                value={fmtMoney(driver.cod_outstanding_amount)}
              />
            </InfoGroup>
          </div>
        }
      />
    </div>
  )
}
