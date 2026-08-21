"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { fetchCompanyProfile } from "@/lib/settings/actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Globe, Languages, Clock, CalendarDays } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

interface TenantRow {
  timezone: string | null
  default_locale: string | null
}

export default function LanguageSettingsPage() {
  const { t, locale, setLocale } = useTranslation()
  const ar = locale === "ar"

  const [tenant, setTenant] = useState<TenantRow | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchCompanyProfile()
        setTenant(data ? { timezone: data.timezone, default_locale: data.default_locale } : null)
      } catch {
        setTenant(null)
      }
      setIsLoading(false)
    }
    load()
  }, [])

  if (isLoading) {
    return (
      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner className="h-6 w-6 text-elite-blue-600" />
        </div>
      </div>
    )
  }

  const nowPreview = new Date().toLocaleDateString(locale === "ar" ? "ar-SA" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return (
    <div className="page-enter px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.settings.language}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ar ? "اللغة، المنطقة الزمنية، وصيغة العرض" : "Language, timezone, and display format"}
        </p>
      </div>

      <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elite-blue-600/10">
              <Languages className="h-5 w-5 text-elite-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">{ar ? "لغة الواجهة" : "Interface language"}</CardTitle>
              <CardDescription className="text-xs">
                {ar ? "يُحفظ الاختيار تلقائياً في متصفحك" : "Saved automatically in your browser"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setLocale("ar")}
            className={`group relative overflow-hidden rounded-2xl border p-5 text-start transition-all hover-lift ${
              locale === "ar"
                ? "border-elite-blue-500/60 bg-elite-blue-600/10 ring-1 ring-elite-blue-500/40"
                : "border-border/50 bg-background/60 hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">العربية</span>
              {locale === "ar" && <Badge className="bg-elite-blue-600 text-white border-transparent">{ar ? "مفعّلة" : "Active"}</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground" dir="rtl">
              واجهة كاملة باللغة العربية مع اتجاه من اليمين لليسار
            </p>
          </button>
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={`group relative overflow-hidden rounded-2xl border p-5 text-start transition-all hover-lift ${
              locale === "en"
                ? "border-elite-blue-500/60 bg-elite-blue-600/10 ring-1 ring-elite-blue-500/40"
                : "border-border/50 bg-background/60 hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">English</span>
              {locale === "en" && <Badge className="bg-elite-blue-600 text-white border-transparent">{ar ? "مفعّلة" : "Active"}</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
              Full English interface with left-to-right layout
            </p>
          </button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Globe className="h-4 w-4 text-elite-blue-600" />
              {ar ? "المنطقة الزمنية" : "Timezone"}
            </div>
          </CardHeader>
          <CardContent>
            <span dir="ltr" className="text-sm font-medium">
              {tenant?.timezone ?? "Asia/Riyadh"}
            </span>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 text-elite-blue-600" />
              {ar ? "اللغة الافتراضية للمنشأة" : "Tenant default locale"}
            </div>
          </CardHeader>
          <CardContent>
            <span dir="ltr" className="text-sm font-medium">
              {tenant?.default_locale ?? "ar"}
            </span>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4 text-elite-blue-600" />
              {ar ? "معاينة صيغة التاريخ" : "Date format preview"}
            </div>
          </CardHeader>
          <CardContent>
            <span className="text-sm font-medium">{nowPreview}</span>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
