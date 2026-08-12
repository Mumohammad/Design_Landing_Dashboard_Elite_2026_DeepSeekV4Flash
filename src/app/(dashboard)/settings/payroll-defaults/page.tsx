"use client"

import { useEffect, useState } from "react"
import { useActionState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { updateSystemSettings } from "@/lib/settings/actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Save, CheckCircle2, CreditCard } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

interface SettingRow {
  id: string
  key: string
  value: string
  is_public: boolean
}

const PAYROLL_KEYS = [
  "payroll.default_working_days",
  "payroll.saudi_minimum_wage",
  "payroll.min_net_floor",
  "payroll.waiver_threshold_admin",
]

function keyMeta(key: string, ar: boolean): { label: string; desc: string; unit?: string } {
  const map: Record<string, { ar: string; en: string; descAr: string; descEn: string; unit?: string }> = {
    "payroll.default_working_days": {
      ar: "أيام العمل الافتراضية شهرياً",
      en: "Default working days / month",
      descAr: "أساس احتساب الراتب الأساسي النسبي",
      descEn: "Base for the prorated base salary",
    },
    "payroll.saudi_minimum_wage": {
      ar: "الحد الأدنى لأجور السعوديين",
      en: "Saudi minimum wage",
      descAr: "تنبيه عند انخفاض صافي راتب المواطن السعودي عن هذا المبلغ",
      descEn: "Advisory when a Saudi national's net falls below this",
      unit: "SAR",
    },
    "payroll.min_net_floor": {
      ar: "الحد الأدنى لصافي الراتب",
      en: "Minimum net payroll floor",
      descAr: "حد أدنى إلزامي لصافي راتب أي سائق",
      descEn: "Hard floor applied to any driver's net pay",
      unit: "SAR",
    },
    "payroll.waiver_threshold_admin": {
      ar: "حد إعفاء المسؤول",
      en: "Admin waiver threshold",
      descAr: "الحد الأقصى للمخالفة التي يمكن إعفاؤها دون موافقة المدير العام",
      descEn: "Max violation amount waivable without GM approval",
      unit: "SAR",
    },
  }
  const m = map[key]
  if (!m) return { label: key, desc: "" }
  return {
    label: ar ? m.ar : m.en,
    desc: ar ? m.descAr : m.descEn,
    unit: m.unit,
  }
}

export default function PayrollDefaultsSettingsPage() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [rows, setRows] = useState<SettingRow[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from("system_settings")
        .select("id,key,value,is_public")
        .in("key", PAYROLL_KEYS)
        .is("deleted_at", null)
        .order("key", { ascending: true })
      if (!data) {
        setLoadError(true)
        setIsLoading(false)
        return
      }
      const list = data as SettingRow[]
      setRows(list)
      const v: Record<string, string> = {}
      for (const r of list) v[r.key] = r.value
      setValues(v)
      setIsLoading(false)
    }
    load()
  }, [])

  const [state, formAction, isPending] = useActionState(
    async (_prev: { success: boolean; error?: string } | null, _form: FormData) => {
      const updates = Object.entries(values)
        .filter(([, v]) => v !== "")
        .map(([key, value]) => ({ key, value }))
      if (updates.length === 0) return { success: false, error: ar ? "لا توجد قيم للتحديث." : "Nothing to update." }
      return updateSystemSettings(updates)
    },
    null
  )

  if (isLoading) {
    return (
      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner className="h-6 w-6 text-elite-blue-600" />
        </div>
      </div>
    )
  }

  const minWage = Number(values["payroll.saudi_minimum_wage"] ?? 0)
  const belowWageAdvisory = minWage > 0 && minWage < 4000

  return (
    <div className="px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.settings.payrollDefaults}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ar ? "الضوابط الافتراضية المستخدمة في محرك حساب الرواتب" : "Defaults consumed by the payroll calculation engine"}
        </p>
      </div>

      {belowWageAdvisory && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            {ar
              ? "الحد الأدنى لأجور السعوديين المعتمد هو 4000 ريال. القيمة الحالية أقل من ذلك وقد تشغّل تحذيرات التوظيف."
              : "The official Saudi minimum wage for nationals is 4,000 SAR. The current value is below it, which may trigger compliance warnings."}
          </p>
        </div>
      )}

      <form action={formAction}>
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elite-blue-600/10">
                <CreditCard className="h-5 w-5 text-elite-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">{ar ? "ضوابط الرواتب" : "Payroll controls"}</CardTitle>
                <CardDescription className="text-xs">
                  {ar ? "تخزَّن كإعدادات نظام على مستوى المنشأة" : "Stored as tenant-scoped system settings"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {rows.length === 0 && !loadError && (
              <p className="text-sm text-muted-foreground">
                {ar ? "لا توجد إعدادات رواتب مسجلة بعد." : "No payroll settings recorded yet."}
              </p>
            )}
            {loadError && (
              <p className="text-sm text-red-500">
                {ar ? "تعذر تحميل الإعدادات." : "Failed to load settings."}
              </p>
            )}
            {rows.map((r) => {
              const meta = keyMeta(r.key, ar)
              const isPublic = r.is_public
              return (
                <div
                  key={r.id}
                  className="flex flex-col gap-2 rounded-xl border border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{meta.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{meta.desc}</p>
                    {!isPublic && (
                      <span className="mt-1 inline-block rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] text-amber-600">
                        {ar ? "خاص — المدير العام فقط" : "Private — GM only"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      dir="ltr"
                      value={values[r.key] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [r.key]: e.target.value }))}
                      className="h-9 w-32 text-end tabular-nums"
                    />
                    {meta.unit && <span className="w-10 text-xs text-muted-foreground">{meta.unit}</span>}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <div className="mt-5 flex items-center gap-3">
          <Button
            type="submit"
            disabled={isPending}
            className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
          >
            {isPending ? <LoadingSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {t.common.saveChanges}
          </Button>
          {state?.success && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> {t.common.saved}
            </span>
          )}
          {state?.error && <span className="text-sm text-red-500">{state.error}</span>}
        </div>
      </form>
    </div>
  )
}
