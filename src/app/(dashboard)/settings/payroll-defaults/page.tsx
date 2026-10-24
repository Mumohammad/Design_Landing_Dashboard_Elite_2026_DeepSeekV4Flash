"use client"

import { useEffect, useState } from "react"
import { useActionState } from "react"
import { settingsMessage } from "@/lib/settings/schema"
import { useTranslation } from "@/hooks/use-translation"
import { updateSystemSettings, fetchPayrollDefaults, type PayrollSetting, type SettingsActionResult } from "@/lib/settings/actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Save, CheckCircle2, CreditCard } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

function keyMeta(key: string, ar: boolean): { label: string; desc: string; unit?: string } {
  const map: Record<string, { ar: string; en: string; descAr: string; descEn: string; unit?: string }> = {
    "payroll.default_working_days": {
      ar: "أيام العمل الافتراضية شهرياً",
      en: "Default working days / month",
      descAr: "قيمة مرجعية تُراجع عند إعداد قواعد راتب السائق",
      descEn: "Reference value reviewed when preparing driver pay rules",
    },
    "payroll.saudi_minimum_wage": {
      ar: "حد تنبيه الأجر للمواطنين",
      en: "Saudi employee pay advisory",
      descAr: "تنبيه عند انخفاض صافي راتب المواطن السعودي عن هذا المبلغ",
      descEn: "Advisory when a Saudi national's net falls below this",
      unit: "SAR",
    },
    "payroll.min_net_floor": {
      ar: "الحد الأدنى لصافي الراتب",
      en: "Minimum net payroll floor",
      descAr: "قيمة مرجعية للحد الأدنى تُراجع لكل قاعدة راتب",
      descEn: "Reference floor reviewed for each driver pay rule",
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

  const [rows, setRows] = useState<PayrollSetting[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [version, setVersion] = useState(0)
  const [canManage, setCanManage] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const bundle = await fetchPayrollDefaults()
        const list = bundle.rows
        setVersion(bundle.configuration_version)
        setCanManage(bundle.can_manage)
        if (!list.length) {
          setLoadError(true)
        } else {
          setRows(list)
          const v: Record<string, string> = {}
          for (const r of list) v[r.key] = r.value
          setValues(v)
        }
      } catch {
        setLoadError(true)
      }
      setIsLoading(false)
    }
    load()
  }, [])

  const [state, formAction, isPending] = useActionState<SettingsActionResult | null, FormData>(
    async () => {
      const updates = Object.entries(values)
        .filter(([, v]) => v !== "")
        .map(([key, value]) => ({ key, value }))
      if (updates.length === 0) return { success: false, error: ar ? "لا توجد قيم للتحديث." : "Nothing to update." }
      const result = await updateSystemSettings(updates, version)
      if (result.success && result.configuration_version) setVersion(result.configuration_version)
      return result
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


  return (
    <div className="page-enter px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.settings.payrollDefaults}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ar ? "قيم مرجعية لإعداد قواعد رواتب السائقين واعتمادها" : "Reference values for preparing reviewed driver pay rules"}
        </p>
      </div>

      <form action={formAction}><fieldset disabled={isPending || loadError || !canManage} className="min-w-0">
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
                        {ar ? "خاص — مسؤولو الإعدادات" : "Private — settings managers"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      aria-label={meta.label}
                      min={r.key === "payroll.default_working_days" ? 1 : 0}
                      max={r.key === "payroll.default_working_days" ? 31 : 999999999.99}
                      step={r.key === "payroll.default_working_days" ? "1" : "0.01"}
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
          {state?.error && <span className="text-sm text-red-500">{state.code ? settingsMessage(state.code, locale) : state.error}</span>}
        </div>
      </fieldset></form>
    </div>
  )
}
