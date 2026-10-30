"use client"

import { friendlyError } from "@/lib/errors/friendly"
import { LocalizedText } from "@/components/localized-text"
import { useEffect, useRef, useState } from "react"
import { useActionState } from "react"
import { settingsMessage, companyFieldIssue, wpsFieldIssue } from "@/lib/settings/schema"
import { useTranslation } from "@/hooks/use-translation"
import { updateCompanyProfile, updateCompanyWpsSettings, fetchCompanyProfile, uploadCompanyLogo, removeCompanyLogo, type CompanyProfileInput, type CompanyProfile, type SettingsActionResult } from "@/lib/settings/actions"
import { LOGO_ACCEPT, logoPrepMessage, prepareLogoFile } from "@/lib/branding/logo-client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Building2, AlertTriangle, Save, CheckCircle2, Landmark, ImageIcon, Upload, Trash2 } from "lucide-react"
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
  const [buildingNumber, setBuildingNumber] = useState("")
  const [additionalNumber, setAdditionalNumber] = useState("")
  const [district, setDistrict] = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [country, setCountry] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [timezone, setTimezone] = useState("Asia/Riyadh")
  const [defaultLocale, setDefaultLocale] = useState("ar")
  const [molReference, setMolReference] = useState("")
  const [wpsIban, setWpsIban] = useState("")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoMessage, setLogoMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  async function onLogoSelected(file: File | undefined) {
    if (!file) return
    setLogoMessage(null)
    const prepared = await prepareLogoFile(file)
    if (!prepared.ok) {
      setLogoMessage({ ok: false, text: logoPrepMessage(prepared.error, ar) })
      return
    }
    setLogoBusy(true)
    const result = await uploadCompanyLogo(prepared.dataUrl)
    setLogoBusy(false)
    if (logoInput.current) logoInput.current.value = ""
    if (result.success && result.logoUrl) {
      setLogoUrl(result.logoUrl)
      if (result.configuration_version) setTenant(previous => previous ? { ...previous, configuration_version: result.configuration_version! } : previous)
      setLogoMessage({ ok: true, text: ar ? "تم حفظ الشعار." : "Logo saved." })
    } else {
      setLogoMessage({ ok: false, text: friendlyError(result.error, ar, ar ? "تعذر حفظ الشعار." : "Unable to save the logo.") })
    }
  }

  async function onLogoRemove() {
    setLogoMessage(null)
    setLogoBusy(true)
    const result = await removeCompanyLogo()
    setLogoBusy(false)
    if (result.success) {
      setLogoUrl(null)
      if (result.configuration_version) setTenant(previous => previous ? { ...previous, configuration_version: result.configuration_version! } : previous)
      setLogoMessage({ ok: true, text: ar ? "تمت إزالة الشعار." : "Logo removed." })
    } else {
      setLogoMessage({ ok: false, text: friendlyError(result.error, ar, ar ? "تعذر إزالة الشعار." : "Unable to remove the logo.") })
    }
  }

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
        setBuildingNumber(data.building_number ?? "")
        setAdditionalNumber(data.additional_number ?? "")
        setDistrict(data.district ?? "")
        setPostalCode(data.postal_code ?? "")
        setCountry(data.country ?? "")
        setPhone(data.phone ?? "")
        setEmail(data.email ?? "")
        setTimezone(data.timezone ?? "Asia/Riyadh")
        setDefaultLocale(data.default_locale ?? "ar")
        setMolReference(data.mol_reference ?? "")
        setWpsIban(data.wps_iban ?? "")
        setLogoUrl(data.logo_url ?? null)
      } catch {
        setLoadError(true)
      }
      setIsLoading(false)
    }
    load()
  }, [])

  const [state, formAction, isPending] = useActionState<(SettingsActionResult & { localMessage?: string }) | null, FormData>(
    async () => {
      const input: CompanyProfileInput = {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        legal_name: legalName.trim() || null,
        cr_number: crNumber.trim() || null,
        vat_number: vatNumber.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        region: region.trim() || null,
        building_number: buildingNumber.trim() || null,
        additional_number: additionalNumber.trim() || null,
        district: district.trim() || null,
        postal_code: postalCode.trim() || null,
        country: country.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        timezone: timezone.trim(),
        default_locale: defaultLocale,
      }
      const issue = companyFieldIssue(input, locale)
      if (issue) return { success: false, error: issue, localMessage: issue }
      const result = await updateCompanyProfile(input, tenant?.configuration_version ?? 0)
      if (result.success && result.configuration_version) setTenant(previous => previous ? { ...previous, configuration_version: result.configuration_version! } : previous)
      return result
    },
    null
  )

  const [wpsState, wpsAction, isSavingWps] = useActionState<(SettingsActionResult & { localMessage?: string }) | null, FormData>(
    async () => {
      const issue = wpsFieldIssue({ molReference, wpsIban }, locale)
      if (issue) return { success: false, error: issue, localMessage: issue }
      const result = await updateCompanyWpsSettings({ molReference, wpsIban }, tenant?.configuration_version ?? 0)
      if (result.success && result.configuration_version) setTenant(previous => previous ? { ...previous, configuration_version: result.configuration_version! } : previous)
      return result
    },
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

      <Card className="rounded-2xl border border-border/50 bg-card shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-elite-blue-600 dark:text-elite-blue-300">
              <ImageIcon className="h-5 w-5 text-elite-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">{ar ? "شعار الشركة" : "Company logo"}</CardTitle>
              <CardDescription className="text-xs">
                {ar
                  ? "يظهر في الفواتير وفي القائمة الجانبية. PNG أو JPEG أو WebP حتى 5 ميجابايت."
                  : "Shown on invoices and in the sidebar. PNG, JPEG, or WebP up to 5 MB."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/30">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={ar ? "شعار الشركة" : "Company logo"} className="h-full w-full object-contain" data-testid="company-logo-preview" />
            ) : (
              <ImageIcon className="h-7 w-7 text-muted-foreground" />
            )}
          </div>
          <input
            ref={logoInput}
            id="companyLogo"
            type="file"
            accept={LOGO_ACCEPT}
            className="sr-only"
            onChange={(e) => onLogoSelected(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" disabled={logoBusy} onClick={() => logoInput.current?.click()}>
            {logoBusy ? <LoadingSpinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {logoUrl ? (ar ? "تغيير الشعار" : "Change logo") : (ar ? "رفع الشعار" : "Upload logo")}
          </Button>
          {logoUrl && (
            <Button type="button" variant="ghost" disabled={logoBusy} onClick={onLogoRemove} className="text-red-600 hover:text-red-700">
              <Trash2 className="h-4 w-4" />
              {ar ? "إزالة" : "Remove"}
            </Button>
          )}
          {logoMessage && (
            <span role="status" className={logoMessage.ok ? "text-sm text-emerald-600" : "text-sm text-red-500"}>{logoMessage.text}</span>
          )}
        </CardContent>
      </Card>

      <form action={formAction}><fieldset disabled={!tenant?.can_manage || isPending || loadError} className="min-w-0">
        <Card className="rounded-2xl border border-border/50 bg-card shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl text-elite-blue-600 dark:text-elite-blue-300">
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
              <FormField id="address" label={ar ? "الشارع (العنوان الوطني)" : "Street (National Address)"} value={address} onChange={setAddress} dir="auto" />
            </div>
            <FormField id="district" label={ar ? "الحي" : "District"} value={district} onChange={setDistrict} dir="auto" />
            <FormField id="buildingNumber" label={ar ? "رقم المبنى" : "Building number"} value={buildingNumber} onChange={(v) => setBuildingNumber(v.replace(/\D/g, "").slice(0, 4))} dir="ltr" placeholder="1234" />
            <FormField id="additionalNumber" label={ar ? "الرقم الإضافي" : "Additional number"} value={additionalNumber} onChange={(v) => setAdditionalNumber(v.replace(/\D/g, "").slice(0, 4))} dir="ltr" placeholder="5678" />
            <FormField id="postalCode" label={ar ? "الرمز البريدي" : "Postal code"} value={postalCode} onChange={(v) => setPostalCode(v.replace(/\D/g, "").slice(0, 5))} dir="ltr" placeholder="12345" />
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
          <Button type="submit" disabled={isPending || !nameAr.trim() || !nameEn.trim()} className="bg-elite-blue-600 hover:bg-elite-blue-700">
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
            <span className="text-sm text-red-500" role="alert" data-testid="company-settings-error">{state.localMessage ?? (state.code ? settingsMessage(state.code, locale) : friendlyError(state.error, ar))}</span>
          )}
        </div>
      </fieldset></form>

      <form action={wpsAction}><fieldset disabled={!tenant?.can_manage || isSavingWps || loadError} className="min-w-0">
        <Card className="rounded-2xl border border-border/50 bg-card shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl text-elite-blue-600 dark:text-elite-blue-300">
                <Landmark className="h-5 w-5 text-elite-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base"><LocalizedText text="WPS —" /> {ar ? "نظام حماية الأجور" : "Wage Protection System"}</CardTitle>
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
                className="bg-elite-blue-600 hover:bg-elite-blue-700"
              >
                {isSavingWps ? <LoadingSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {t.common.saveChanges}
              </Button>
              {wpsState?.success && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> {t.common.saved}
                </span>
              )}
              {wpsState?.error && <span className="text-sm text-red-500" role="alert" data-testid="wps-settings-error">{wpsState.localMessage ?? (wpsState.code ? settingsMessage(wpsState.code, locale) : friendlyError(wpsState.error, ar))}</span>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {ar
                ? "تُستخدم هذه البيانات عند تصدير ملف WPS من صفحة الرواتب."
                : "Used when exporting the WPS SIF file from the payroll page."}
            </p>
          </CardContent>
        </Card>
      </fieldset></form>
    </div>
  )
}
