"use client"

import { useEffect, useState } from "react"
import { useActionState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { updateCompanyProfile, updateCompanyWpsSettings, fetchCompanyProfile, type CompanyProfileInput, type CompanyProfile } from "@/lib/settings/actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Building2, AlertTriangle, Save, CheckCircle2, Landmark } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

function FormField({
  id,
  label,
  value,
  onChange,
  dir,
  placeholder,
  type,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  dir?: "ltr" | "rtl" | "auto"
  placeholder?: string
  type?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        dir={dir}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  )
}

export default function CompanySettingsPage() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [tenant, setTenant] = useState<CompanyProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [nameAr, setNameAr] = useState("")
  const [nameEn, setNameEn] = useState("")
  const [legalName, setLegalName] = useState("")
  const [crNumber, setCrNumber] = useState("")
  const [vatNumber, setVatNumber] = useState("")
  const [address, setAddress] = useState("")
  const [city, setCity] = useState("")
  const [region, setRegion] = useState("")
  const [country, setCountry] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [timezone, setTimezone] = useState("Asia/Riyadh")
  const [defaultLocale, setDefaultLocale] = useState("ar")
  const [molReference, setMolReference] = useState("")
  const [wpsIban, setWpsIban] = useState("")

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchCompanyProfile()
        if (!data) {
          setLoadError(true)
          setIsLoading(false)
          return
        }
        setTenant(data)
        setNameAr(data.name_ar ?? "")
        setNameEn(data.name_en ?? "")
        setLegalName(data.legal_name ?? "")
        setCrNumber(data.cr_number ?? "")
        setVatNumber(data.vat_number ?? "")
        setAddress(data.address ?? "")
        setCity(data.city ?? "")
        setRegion(data.region ?? "")
        setCountry(data.country ?? "")
        setPhone(data.phone ?? "")
        setEmail(data.email ?? "")
        setTimezone(data.timezone ?? "Asia/Riyadh")
        setDefaultLocale(data.default_locale ?? "ar")
        setMolReference(data.mol_reference ?? "")
        setWpsIban(data.wps_iban ?? "")
      } catch {
        setLoadError(true)
      }
      setIsLoading(false)
    }
    load()
  }, [])

  const [state, formAction, isPending] = useActionState(
    async (_prev: { success: boolean; error?: string } | null, _form: FormData) => {
      const input: CompanyProfileInput = {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        legal_name: legalName.trim() || null,
        cr_number: crNumber.trim() || null,
        vat_number: vatNumber.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        region: region.trim() || null,
        country: country.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        timezone: timezone.trim() || null,
        default_locale: defaultLocale || null,
      }
      return updateCompanyProfile(input)
    },
    null
  )

  const [wpsState, wpsAction, isSavingWps] = useActionState(
    async (_prev: { success: boolean; error?: string } | null, _form: FormData) =>
      updateCompanyWpsSettings({ molReference, wpsIban }),
    null
  )

  const hasPlaceholders = crNumber.includes("PLACEHOLDER") || vatNumber.includes("PLACEHOLDER")

  if (isLoading) {
    return (
      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner className="h-6 w-6 text-elite-blue-600" />
        </div>
      </div>
    )
  }

  if (loadError || !tenant) {
    return (
      <div className="px-4 lg:px-6 py-4">
        <Card className="rounded-2xl border border-border/50">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-3" />
            <p className="text-sm text-muted-foreground">
              {ar ? "تعذر تحميل بيانات الشركة." : "Could not load company data."}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="page-enter px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.settings.companyProfile}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ar ? "السجل التجاري، الرقم الضريبي، بيانات الاتصال" : "Commercial registration, VAT, and contact details"}
        </p>
      </div>

      {hasPlaceholders && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            {ar
              ? "السجل التجاري أو الرقم الضريبي يحتوي على قيمة مؤقتة (PLACEHOLDER). حدّثها بالقيم الحقيقية قبل الاستخدام الرسمي."
              : "The CR or VAT number still contains a placeholder value. Update it with the real values before official use."}
          </p>
        </div>
      )}

      <form action={formAction}>
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elite-blue-600/10">
                <Building2 className="h-5 w-5 text-elite-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">{ar ? "بيانات الشركة" : "Company data"}</CardTitle>
                <CardDescription className="text-xs">
                  {ar ? "تظهر هذه البيانات في الفواتير وتقارير الرواتب" : "Shown on invoices and payroll reports"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField id="nameAr" label={ar ? "الاسم بالعربية" : "Arabic name"} value={nameAr} onChange={setNameAr} dir="rtl" />
            <FormField id="nameEn" label={ar ? "الاسم بالإنجليزية" : "English name"} value={nameEn} onChange={setNameEn} dir="ltr" />
            <div className="sm:col-span-2">
              <FormField
                id="legalName"
                label={ar ? "الاسم القانوني" : "Legal name"}
                value={legalName}
                onChange={setLegalName}
                dir="ltr"
              />
            </div>
            <FormField
              id="crNumber"
              label={ar ? "السجل التجاري" : "CR number"}
              value={crNumber}
              onChange={setCrNumber}
              dir="ltr"
              placeholder="1010XXXXXX"
            />
            <FormField
              id="vatNumber"
              label={ar ? "الرقم الضريبي" : "VAT number"}
              value={vatNumber}
              onChange={setVatNumber}
              dir="ltr"
              placeholder="300000000000003"
            />
            <div className="sm:col-span-2">
              <FormField id="address" label={ar ? "العنوان" : "Address"} value={address} onChange={setAddress} dir="auto" />
            </div>
            <FormField id="city" label={ar ? "المدينة" : "City"} value={city} onChange={setCity} dir="auto" />
            <FormField id="region" label={ar ? "المنطقة" : "Region"} value={region} onChange={setRegion} dir="auto" />
            <FormField id="country" label={ar ? "الدولة" : "Country"} value={country} onChange={setCountry} dir="ltr" />
            <FormField id="phone" label={ar ? "الهاتف" : "Phone"} value={phone} onChange={setPhone} dir="ltr" />
            <FormField id="email" label="Email" value={email} onChange={setEmail} dir="ltr" type="email" />
            <FormField id="timezone" label={ar ? "المنطقة الزمنية" : "Timezone"} value={timezone} onChange={setTimezone} dir="ltr" />
            <FormField
              id="defaultLocale"
              label={ar ? "اللغة الافتراضية" : "Default locale"}
              value={defaultLocale}
              onChange={setDefaultLocale}
              dir="ltr"
            />
          </CardContent>
        </Card>

        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={isPending || !nameAr.trim() || !nameEn.trim()} className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800">
            {isPending ? (
              <LoadingSpinner className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t.common.saveChanges}
          </Button>
          {state?.success && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> {t.common.saved}
            </span>
          )}
          {state?.error && (
            <span className="text-sm text-red-500">{state.error}</span>
          )}
        </div>
      </form>

      <form action={wpsAction}>
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elite-blue-600/10">
                <Landmark className="h-5 w-5 text-elite-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">WPS — {ar ? "نظام حماية الأجور" : "Wage Protection System"}</CardTitle>
                <CardDescription className="text-xs">
                  {ar
                    ? "البيانات المطلوبة لتوليد ملفات SIF المصرفية"
                    : "Required to generate bank SIF files for salary disbursement"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="molReference">{ar ? "مرجع وزارة العمل" : "MOL reference"}</Label>
              <Input
                id="molReference"
                dir="ltr"
                value={molReference}
                onChange={(e) => setMolReference(e.target.value)}
                placeholder="MOL-1234567890"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wpsIban">{ar ? "الآيبان المصرفي (لتحويل الرواتب)" : "Company IBAN (salary transfers)"}</Label>
              <Input
                id="wpsIban"
                dir="ltr"
                value={wpsIban}
                onChange={(e) => setWpsIban(e.target.value.toUpperCase())}
                placeholder="SA00 0000 0000 0000 0000 0000"
                className="h-9 font-mono"
              />
            </div>
          </CardContent>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={isSavingWps || !molReference.trim() || !wpsIban.trim()}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isSavingWps ? <LoadingSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {t.common.saveChanges}
              </Button>
              {wpsState?.success && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> {t.common.saved}
                </span>
              )}
              {wpsState?.error && <span className="text-sm text-red-500">{wpsState.error}</span>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {ar
                ? "تُستخدم هذه البيانات عند تصدير ملف WPS من صفحة الرواتب."
                : "Used when exporting the WPS SIF file from the payroll page."}
            </p>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
