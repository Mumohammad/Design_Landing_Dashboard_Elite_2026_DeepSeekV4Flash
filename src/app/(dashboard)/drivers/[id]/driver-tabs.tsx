"use client"

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { Driver } from "@/types/drivers"
import {
  Banknote,
  Briefcase,
  Car,
  ClipboardCheck,
  FileText,
  Gauge,
  ShieldAlert,
  Wallet,
  Wrench,
} from "lucide-react"

/* ───────────────────────── shared bits ───────────────────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-14 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function Badge({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        className,
      )}
    >
      {children}
    </span>
  )
}

function StatusBadge({ value, ok, warn }: { value: string; ok: string; warn: string }) {
  const bad = value !== ok
  return (
    <Badge
      className={
        bad
          ? "bg-red-500/15 text-red-700 dark:text-red-400"
          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      }
    >
      <span className={cn("h-1 w-1 rounded-full", bad ? "bg-red-500" : "bg-emerald-500")} />
      {warn}
    </Badge>
  )
}

function DocTypeLabel({ type, isAr }: { type: string; isAr: boolean }) {
  const map: Record<string, [string, string]> = {
    iqama: ["إقامة", "Iqama"],
    passport: ["جواز سفر", "Passport"],
    driving_license: ["رخصة قيادة", "Driving License"],
    vehicle_license: ["رخصة مركبة", "Vehicle License"],
    medical_certificate: ["شهادة طبية", "Medical Certificate"],
    police_clearance: ["صحيفة جنائية", "Police Clearance"],
    employment_contract: ["عقد عمل", "Employment Contract"],
    bank_letter: ["خطاب بنكي", "Bank Letter"],
    photo: ["صورة", "Photo"],
    other: ["أخرى", "Other"],
  }
  const v = map[type]
  return <span>{v ? (isAr ? v[0] : v[1]) : type}</span>
}

function CodStatusLabel({ status, isAr }: { status: string; isAr: boolean }) {
  const map: Record<string, [string, string, string]> = {
    pending: ["قيد الانتظار", "Pending", "bg-amber-500/15 text-amber-700 dark:text-amber-400"],
    reconciled: ["تمت التسوية", "Reconciled", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"],
    disputed: ["متنازع عليه", "Disputed", "bg-red-500/15 text-red-700 dark:text-red-400"],
    written_off: ["شُطب", "Written Off", "bg-gray-500/15 text-gray-700 dark:text-gray-300"],
  }
  const v = map[status] ?? [status, status, "bg-muted text-muted-foreground"]
  return <Badge className={v[2]}>{isAr ? v[0] : v[1]}</Badge>
}

function ChangeTypeLabel({ type, isAr }: { type: string; isAr: boolean }) {
  const map: Record<string, [string, string]> = {
    initial: ["أولي", "Initial"],
    increase: ["زيادة", "Increase"],
    decrease: ["تخفيض", "Decrease"],
    correction: ["تصحيح", "Correction"],
    category_change: ["تغيير الفئة", "Category Change"],
  }
  const v = map[type]
  return <span>{v ? (isAr ? v[0] : v[1]) : type}</span>
}

function MaintenanceTypeLabel({ type, isAr }: { type: string; isAr: boolean }) {
  const map: Record<string, [string, string]> = {
    preventive: ["وقائية", "Preventive"],
    emergency: ["طارئة", "Emergency"],
    periodic: ["دورية", "Periodic"],
    repair: ["إصلاح", "Repair"],
  }
  const v = map[type]
  return <span>{v ? (isAr ? v[0] : v[1]) : type}</span>
}

function MaintenanceStatusLabel({ status, isAr }: { status: string; isAr: boolean }) {
  const map: Record<string, [string, string, string]> = {
    open: ["مفتوحة", "Open", "bg-amber-500/15 text-amber-700 dark:text-amber-400"],
    in_progress: ["قيد التنفيذ", "In Progress", "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300"],
    completed: ["مكتملة", "Completed", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"],
    cancelled: ["ملغاة", "Cancelled", "bg-gray-500/15 text-gray-700 dark:text-gray-300"],
  }
  const v = map[status] ?? [status, status, "bg-muted text-muted-foreground"]
  return <Badge className={v[2]}>{isAr ? v[0] : v[1]}</Badge>
}

function FormTypeLabel({ type, isAr }: { type: string; isAr: boolean }) {
  return (
    <Badge
      className={
        type === "handover"
          ? "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300"
          : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
      }
    >
      {isAr ? (type === "handover" ? "تسليم" : "استلام") : type === "handover" ? "Handover" : "Return"}
    </Badge>
  )
}

function OverallConditionLabel({ condition, isAr }: { condition: string; isAr: boolean }) {
  const map: Record<string, [string, string, string]> = {
    excellent: ["ممتازة", "Excellent", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"],
    good: ["جيدة", "Good", "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300"],
    fair: ["متوسطة", "Fair", "bg-amber-500/15 text-amber-700 dark:text-amber-400"],
    poor: ["ضعيفة", "Poor", "bg-orange-500/15 text-orange-700 dark:text-orange-400"],
    damaged: ["متضررة", "Damaged", "bg-red-500/15 text-red-700 dark:text-red-400"],
  }
  const v = map[condition] ?? [condition, condition, "bg-muted text-muted-foreground"]
  return <Badge className={v[2]}>{isAr ? v[0] : v[1]}</Badge>
}

function OdometerSourceLabel({ source, isAr }: { source: string; isAr: boolean }) {
  const map: Record<string, [string, string]> = {
    manual: ["يدوي", "Manual"],
    gps: ["GPS", "GPS"],
    obd: ["OBD", "OBD"],
    import: ["استيراد", "Import"],
  }
  const v = map[source]
  return <span>{v ? (isAr ? v[0] : v[1]) : source}</span>
}

/* ───────────────────────── tab components ───────────────────────── */

type DocumentsTabProps = { driverId: string; isAr: boolean }

function DocumentsTab({ driverId, isAr }: DocumentsTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_documents")
        .select("id, doc_type, doc_number, issue_date, expiry_date, issuing_authority, is_verified, notes, file_url")
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("expiry_date", { ascending: true, nullsFirst: false })
        .limit(50)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState message={isAr ? "لا توجد مستندات لهذا السائق" : "No documents for this driver"} />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[560px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "النوع" : "Type"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الرقم" : "Number"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الإصدار" : "Issued"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الانتهاء" : "Expiry"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الجهة" : "Authority"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "التحقق" : "Verified"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3 font-medium text-foreground">
                <DocTypeLabel type={String(r.doc_type ?? "other")} isAr={isAr} />
              </td>
              <td className="px-4 py-3 font-mono text-foreground/80" dir="ltr">
                {String(r.doc_number ?? "—")}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {r.issue_date ? String(r.issue_date) : "—"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {r.expiry_date ? String(r.expiry_date) : "—"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {String(r.issuing_authority ?? "—")}
              </td>
              <td className="px-4 py-3">
                <StatusBadge
                  value={String(r.is_verified)}
                  ok="true"
                  warn={isAr ? (String(r.is_verified) === "true" ? "موثّق" : "غير موثّق") : String(r.is_verified) === "true" ? "Verified" : "Unverified"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type CodTabProps = { driverId: string; isAr: boolean }

function CodTab({ driverId, isAr }: CodTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [platforms, setPlatforms] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const [sessions, pf] = await Promise.all([
        supabase
          .from("driver_cod_sessions")
          .select("id, session_date, session_ref, platform_id, orders_with_cod, cod_collected, cod_submitted, cod_variance, status, submission_method, notes")
          .eq("driver_id", driverId)
          .is("deleted_at", null)
          .order("session_date", { ascending: false })
          .limit(50),
        supabase
          .from("delivery_platforms")
          .select("id, name_ar, name_en")
          .is("deleted_at", null),
      ])
      const map: Record<string, string> = {}
      for (const p of (pf.data ?? []) as Record<string, unknown>[]) {
        map[String(p.id)] = isAr ? String(p.name_ar ?? p.name_en ?? "—") : String(p.name_en ?? p.name_ar ?? "—")
      }
      if (!cancelled) {
        setPlatforms(map)
        setRows(sessions.error ? [] : (sessions.data as Record<string, unknown>[]))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [driverId, isAr])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState message={isAr ? "لا توجد جلسات تسوية COD" : "No COD sessions yet"} />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[680px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Date"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المنصة" : "Platform"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "طلبات COD" : "COD Orders"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المحصّل" : "Collected"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المسلَّم" : "Submitted"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الفارق" : "Variance"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const variance = Number(r.cod_variance ?? 0)
            return (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 text-muted-foreground">{String(r.session_date)}</td>
                <td className="px-4 py-3 font-medium text-foreground">
                  {platforms[String(r.platform_id)] ?? "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80">{String(r.orders_with_cod ?? 0)}</td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {Number(r.cod_collected ?? 0).toLocaleString("en-US")}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {Number(r.cod_submitted ?? 0).toLocaleString("en-US")}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 font-semibold tabular-nums",
                    variance > 0
                      ? "text-red-600 dark:text-red-400"
                      : variance < 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground",
                  )}
                  dir="ltr"
                >
                  {variance > 0 ? "+" : ""}
                  {variance.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-3">
                  <CodStatusLabel status={String(r.status ?? "pending")} isAr={isAr} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type SalaryTabProps = { driverId: string; isAr: boolean }

function SalaryTab({ driverId, isAr }: SalaryTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_salary_history")
        .select("id, effective_date, basic_salary, housing_allowance, transport_allowance, change_type, change_reason, previous_basic_salary, created_at")
        .eq("driver_id", driverId)
        .order("effective_date", { ascending: false })
        .limit(50)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState message={isAr ? "لا يوجد سجل رواتب بعد" : "No salary history yet"} />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[640px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ الفعّال" : "Effective"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الراتب الأساسي" : "Basic"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "السكن" : "Housing"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "النقل" : "Transport"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "النوع" : "Type"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "السبب" : "Reason"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3 text-muted-foreground">{String(r.effective_date)}</td>
              <td className="px-4 py-3 font-semibold tabular-nums text-foreground" dir="ltr">
                {Number(r.basic_salary ?? 0).toLocaleString("en-US")}
              </td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground" dir="ltr">
                {Number(r.housing_allowance ?? 0).toLocaleString("en-US")}
              </td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground" dir="ltr">
                {Number(r.transport_allowance ?? 0).toLocaleString("en-US")}
              </td>
              <td className="px-4 py-3">
                <Badge className="bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300">
                  <ChangeTypeLabel type={String(r.change_type ?? "correction")} isAr={isAr} />
                </Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{String(r.change_reason ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type ComplianceTabProps = { driver: Driver; isAr: boolean }

function ComplianceTab({ driver, isAr }: ComplianceTabProps) {
  const [contactCount, setContactCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { count } = await supabase
        .from("driver_emergency_contacts")
        .select("id", { count: "exact", head: true })
        .eq("driver_id", driver.id)
        .is("deleted_at", null)
      if (!cancelled) setContactCount(count ?? 0)
    })()
    return () => {
      cancelled = true
    }
  }, [driver.id])

  const today = new Date()
  const in30 = (d: Date) => d.getTime() < today.getTime() + 30 * 86400000

  const checks: { label: string; done: boolean; hint?: string }[] = [
    {
      label: isAr ? "صورة وبيانات هوية" : "Photo & identity data",
      done: !!driver.photo_url && !!driver.full_name_en,
    },
    {
      label: isAr ? "إقامة سارية" : "Valid iqama",
      done: !!driver.iqama_number && !!driver.iqama_expiry_date && new Date(driver.iqama_expiry_date) > today,
      hint: driver.iqama_expiry_date ? String(driver.iqama_expiry_date) : undefined,
    },
    {
      label: isAr ? "رخصة قيادة سارية" : "Valid driving license",
      done: !!driver.license_number && !!driver.license_expiry_date && new Date(driver.license_expiry_date) > today,
      hint: driver.license_expiry_date ? String(driver.license_expiry_date) : undefined,
    },
    {
      label: isAr ? "جواز سفر" : "Passport",
      done: !!driver.passport_number,
    },
    {
      label: isAr ? "بيانات تواصل كاملة" : "Full contact details",
      done: !!driver.primary_mobile && !!driver.current_city,
    },
    {
      label: isAr ? "بيانات توظيف" : "Employment data",
      done: !!driver.hire_date && !!driver.contract_type && !!driver.job_title,
    },
    {
      label: isAr ? "راتب و IBAN" : "Salary & IBAN",
      done: !!driver.basic_salary && driver.basic_salary > 0 && !!driver.iban,
    },
    {
      label: isAr ? "جهة اتصال طوارئ" : "Emergency contact",
      done: (contactCount ?? 0) > 0,
    },
  ]

  const doneCount = checks.filter((c) => c.done).length
  const pct = Math.round((doneCount / checks.length) * 100)

  const expiringSoon: string[] = []
  for (const [label, date] of [
    [isAr ? "الإقامة" : "Iqama", driver.iqama_expiry_date],
    [isAr ? "الرخصة" : "License", driver.license_expiry_date],
    [isAr ? "الجواز" : "Passport", driver.passport_expiry_date],
  ] as [string, string | null][]) {
    if (date && new Date(date) > today && in30(new Date(date))) {
      expiringSoon.push(`${label} — ${date}`)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-border/50 bg-card/60 p-5 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {isAr ? "اكتمال الملف" : "Profile completeness"}
          </h3>
          <span className="text-xl font-extrabold tabular-nums text-elite-blue-600 dark:text-elite-blue-300">
            {pct}%
          </span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="mt-5 space-y-2.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-foreground/80">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                    c.done
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {c.done ? "✓" : "·"}
                </span>
                {c.label}
              </span>
              {c.hint && <span className="font-mono text-[11px] text-muted-foreground">{c.hint}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-border/50 bg-card/60 p-5 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-foreground">
            {isAr ? "مؤشرات المخاطر" : "Risk indicators"}
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-muted-foreground">{isAr ? "مخاطر الامتثال" : "Compliance risk"}</dt>
              <dd
                className={cn(
                  "text-xl font-extrabold tabular-nums",
                  (driver.compliance_risk_score ?? 0) >= 70
                    ? "text-red-600 dark:text-red-400"
                    : (driver.compliance_risk_score ?? 0) >= 40
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {driver.compliance_risk_score ?? 0}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{isAr ? "رصيد COD المستحق" : "COD outstanding"}</dt>
              <dd className="text-xl font-extrabold tabular-nums text-foreground" dir="ltr">
                {(driver.cod_outstanding_amount ?? 0).toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{isAr ? "آخر مراجعة" : "Last review"}</dt>
              <dd className="text-sm font-semibold text-foreground">
                {driver.last_compliance_review_at ? String(driver.last_compliance_review_at).slice(0, 10) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{isAr ? "المراجعة القادمة" : "Next review"}</dt>
              <dd className="text-sm font-semibold text-foreground">
                {driver.next_compliance_review_at ? String(driver.next_compliance_review_at).slice(0, 10) : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-border/50 bg-card/60 p-5 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-foreground">
            {isAr ? "وثائق تنتهي قريباً (30 يوم)" : "Expiring soon (30 days)"}
          </h3>
          {expiringSoon.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {isAr ? "لا توجد وثائق تنتهي خلال ٣٠ يوماً" : "No documents expiring within 30 days"}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {expiringSoon.map((s) => (
                <li key={s} className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

type AssignmentsTabProps = { driverId: string; isAr: boolean }

function AssignmentsTab({ driverId, isAr }: AssignmentsTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("vehicle_assignments")
        .select("id, assigned_at, unassigned_at, is_current, assignment_reason, handover_odometer, return_odometer, vehicles(plate_number, make, model)")
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("assigned_at", { ascending: false })
        .limit(20)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState message={isAr ? "لا توجد تعيينات مركبات" : "No vehicle assignments yet"} />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[620px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المركبة" : "Vehicle"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "تاريخ التسليم" : "Assigned"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "تاريخ الاستلام" : "Returned"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "عداد التسليم" : "Handover KM"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "السبب" : "Reason"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.vehicles as Record<string, unknown> | null
            return (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-semibold text-foreground">
                  {v ? `${String(v.make ?? "")} ${String(v.model ?? "")}` : "—"}
                  {v?.plate_number ? (
                    <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {String(v.plate_number)}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.assigned_at ? String(r.assigned_at).slice(0, 10) : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.unassigned_at ? String(r.unassigned_at).slice(0, 10) : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.handover_odometer != null ? `${Number(r.handover_odometer).toLocaleString("en-US")} km` : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{String(r.assignment_reason ?? "—")}</td>
                <td className="px-4 py-3">
                  {String(r.is_current) === "true" ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                      {isAr ? "حالي" : "Current"}
                    </Badge>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground">
                      {isAr ? "سابق" : "Past"}
                    </Badge>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type HandoverTabProps = { driverId: string; isAr: boolean }

function HandoverTab({ driverId, isAr }: HandoverTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("vehicle_handover_forms")
        .select("id, form_type, form_date, odometer_reading, fuel_level, overall_condition, defects_noted, vehicle_assignments(driver_id, vehicles(plate_number, make, model))")
        .eq("vehicle_assignments.driver_id", driverId)
        .is("vehicle_assignments.deleted_at", null)
        .order("form_date", { ascending: false })
        .limit(20)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState message={isAr ? "لا توجد نماذج تسليم/استلام" : "No handover forms yet"} />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[680px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "النوع" : "Type"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Date"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المركبة" : "Vehicle"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "العداد" : "Odometer"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الوقود" : "Fuel"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة العامة" : "Condition"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = r.vehicle_assignments as Record<string, unknown> | null
            const v = (a?.vehicles as Record<string, unknown> | null) ?? null
            return (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <FormTypeLabel type={String(r.form_type ?? "handover")} isAr={isAr} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{String(r.form_date)}</td>
                <td className="px-4 py-3 font-medium text-foreground">
                  {v ? `${String(v.make ?? "")} ${String(v.model ?? "")}` : "—"}
                  {v?.plate_number ? (
                    <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {String(v.plate_number)}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.odometer_reading != null ? `${Number(r.odometer_reading).toLocaleString("en-US")} km` : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{String(r.fuel_level ?? "—")}</td>
                <td className="px-4 py-3">
                  <OverallConditionLabel condition={String(r.overall_condition ?? "good")} isAr={isAr} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type MaintenanceTabProps = { driverId: string; isAr: boolean }

function MaintenanceTab({ driverId, isAr }: MaintenanceTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("vehicle_maintenance_events")
        .select("id, maintenance_type, status, cost, provider, fault_description, date_in, date_out, next_service_km, vehicles(plate_number, make, model)")
        .eq("reported_by_driver_id", driverId)
        .is("deleted_at", null)
        .order("reported_at", { ascending: false })
        .limit(20)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState message={isAr ? "لا توجد بلاغات صيانة من هذا السائق" : "No maintenance events reported by this driver"} />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[680px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المركبة" : "Vehicle"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "النوع" : "Type"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الوصف" : "Description"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "التكلفة" : "Cost"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المزود" : "Provider"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.vehicles as Record<string, unknown> | null
            return (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">
                  {v ? `${String(v.make ?? "")} ${String(v.model ?? "")}` : "—"}
                  {v?.plate_number ? (
                    <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {String(v.plate_number)}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <Badge className="bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300">
                    <MaintenanceTypeLabel type={String(r.maintenance_type ?? "repair")} isAr={isAr} />
                  </Badge>
                </td>
                <td className="max-w-[240px] truncate px-4 py-3 text-muted-foreground">
                  {String(r.fault_description ?? "—")}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.cost != null ? `${Number(r.cost).toLocaleString("en-US")} ${isAr ? "ر.س" : "SAR"}` : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{String(r.provider ?? "—")}</td>
                <td className="px-4 py-3">
                  <MaintenanceStatusLabel status={String(r.status ?? "open")} isAr={isAr} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type OdometerTabProps = { driverId: string; isAr: boolean }

function OdometerTab({ driverId, isAr }: OdometerTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("vehicle_odometer_logs")
        .select("id, reading, recorded_at, source, notes, vehicles(plate_number, make, model)")
        .eq("vehicles.current_driver_id", driverId)
        .is("deleted_at", null)
        .order("recorded_at", { ascending: false })
        .limit(30)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }
  if (rows.length === 0) {
    return <EmptyState message={isAr ? "لا توجد قراءات عداد" : "No odometer readings for the current vehicle"} />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[620px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المركبة" : "Vehicle"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "القراءة" : "Reading"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Recorded"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المصدر" : "Source"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "ملاحظات" : "Notes"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.vehicles as Record<string, unknown> | null
            return (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">
                  {v ? `${String(v.make ?? "")} ${String(v.model ?? "")}` : "—"}
                  {v?.plate_number ? (
                    <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {String(v.plate_number)}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-semibold tabular-nums text-foreground" dir="ltr">
                  {Number(r.reading ?? 0).toLocaleString("en-US")} km
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.recorded_at ? String(r.recorded_at).slice(0, 16).replace("T", " ") : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge className="bg-muted text-muted-foreground">
                    <OdometerSourceLabel source={String(r.source ?? "manual")} isAr={isAr} />
                  </Badge>
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                  {String(r.notes ?? "—")}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ───────────────────────── main tab host ───────────────────────── */

export function DriverTabs({
  driver,
  overview,
}: {
  driver: Driver
  overview?: ReactNode
}) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="overview">
          <Briefcase className="h-3.5 w-3.5" />
          {isAr ? "نظرة عامة" : "Overview"}
        </TabsTrigger>
        <TabsTrigger value="documents">
          <FileText className="h-3.5 w-3.5" />
          {isAr ? "المستندات" : "Documents"}
        </TabsTrigger>
        <TabsTrigger value="cod">
          <Banknote className="h-3.5 w-3.5" />
          {isAr ? "تسوية COD" : "COD"}
        </TabsTrigger>
        <TabsTrigger value="salary">
          <Wallet className="h-3.5 w-3.5" />
          {isAr ? "سجل الرواتب" : "Salary History"}
        </TabsTrigger>
        <TabsTrigger value="assignments">
          <Car className="h-3.5 w-3.5" />
          {isAr ? "التعيينات" : "Assignments"}
        </TabsTrigger>
        <TabsTrigger value="handover">
          <ClipboardCheck className="h-3.5 w-3.5" />
          {isAr ? "التسليم" : "Handover"}
        </TabsTrigger>
        <TabsTrigger value="maintenance">
          <Wrench className="h-3.5 w-3.5" />
          {isAr ? "الصيانة" : "Maintenance"}
        </TabsTrigger>
        <TabsTrigger value="odometer">
          <Gauge className="h-3.5 w-3.5" />
          {isAr ? "العداد" : "Odometer"}
        </TabsTrigger>
        <TabsTrigger value="compliance">
          <ShieldAlert className="h-3.5 w-3.5" />
          {isAr ? "الامتثال" : "Compliance"}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-4">
        {overview}
      </TabsContent>
      <TabsContent value="documents" className="mt-4">
        <DocumentsTab driverId={driver.id} isAr={isAr} />
      </TabsContent>
      <TabsContent value="cod" className="mt-4">
        <CodTab driverId={driver.id} isAr={isAr} />
      </TabsContent>
      <TabsContent value="salary" className="mt-4">
        <SalaryTab driverId={driver.id} isAr={isAr} />
      </TabsContent>
      <TabsContent value="assignments" className="mt-4">
        <AssignmentsTab driverId={driver.id} isAr={isAr} />
      </TabsContent>
      <TabsContent value="handover" className="mt-4">
        <HandoverTab driverId={driver.id} isAr={isAr} />
      </TabsContent>
      <TabsContent value="maintenance" className="mt-4">
        <MaintenanceTab driverId={driver.id} isAr={isAr} />
      </TabsContent>
      <TabsContent value="odometer" className="mt-4">
        <OdometerTab driverId={driver.id} isAr={isAr} />
      </TabsContent>
      <TabsContent value="compliance" className="mt-4">
        <ComplianceTab driver={driver} isAr={isAr} />
      </TabsContent>
    </Tabs>
  )
}
