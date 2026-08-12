"use client"

import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  getDocumentDownloadUrl,
  reviewApplication,
} from "@/lib/applications/actions"
import type {
  ApplicationStatus,
  DriverApplication,
  DriverApplicationDocument,
} from "@/types/applications"
import type { LucideIcon } from "lucide-react"
import {
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Car,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  IdCard,
  Loader2,
  Phone,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

const STATUS_META: Record<
  ApplicationStatus,
  { ar: string; en: string; className: string }
> = {
  submitted: {
    ar: "مقدَّم",
    en: "Submitted",
    className:
      "bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/20",
  },
  under_review: {
    ar: "قيد المراجعة",
    en: "Under Review",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20",
  },
  approved: {
    ar: "مقبول",
    en: "Approved",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
  },
  rejected: {
    ar: "مرفوض",
    en: "Rejected",
    className:
      "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
}

const WORK_TYPE_META: Record<string, { ar: string; en: string }> = {
  full_time: { ar: "دوام كامل", en: "Full-time" },
  freelancer: { ar: "مستقل", en: "Freelancer" },
}

const CATEGORY_META: Record<string, { ar: string; en: string }> = {
  sponsored_type_1: { ar: "كفيل نوع ١", en: "Sponsored T1" },
  sponsored_type_2: { ar: "كفيل نوع ٢", en: "Sponsored T2" },
  freelancer: { ar: "مستقل", en: "Freelancer" },
}

const IDENTITY_META: Record<string, { ar: string; en: string }> = {
  iqama: { ar: "إقامة", en: "Iqama" },
  national_id: { ar: "هوية وطنية", en: "National ID" },
  passport: { ar: "جواز سفر", en: "Passport" },
}

const DOCUMENT_TYPE_META: Record<string, { ar: string; en: string }> = {
  profile_photo: { ar: "الصورة الشخصية", en: "Profile Photo" },
  identity: { ar: "وثيقة الهوية", en: "Identity Document" },
  license: { ar: "رخصة القيادة", en: "Driving License" },
  vehicle_reg: { ar: "استمارة المركبة", en: "Vehicle Registration" },
  vehicle_insurance: { ar: "تأمين المركبة", en: "Vehicle Insurance" },
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d)
}

function fmtBytes(v: number | null | undefined): string {
  if (v === null || v === undefined) return ""
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`
  return `${(v / (1024 * 1024)).toFixed(1)} MB`
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

export default function ApplicationDetailPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const isAr = locale === "ar"

  const rawId = params?.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId

  const [app, setApp] = useState<DriverApplication | null>(null)
  const [documents, setDocuments] = useState<DriverApplicationDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState<ApplicationStatus | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const platformCodes = useMemo(
    () =>
      Array.isArray(app?.platform_codes) ? app.platform_codes : [],
    [app]
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      setIsLoading(true)
      setError(null)
      const supabase = createClient()

      const [appRes, docRes] = await Promise.all([
        supabase
          .from("driver_applications")
          .select("*")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("driver_application_documents")
          .select("*")
          .eq("application_id", id)
          .order("uploaded_at", { ascending: true }),
      ])

      if (cancelled) return
      if (appRes.error) {
        setError(appRes.error.message)
        setApp(null)
      } else {
        setApp((appRes.data as DriverApplication | null) ?? null)
      }
      setDocuments((docRes.data as DriverApplicationDocument[] | null) ?? [])
      setIsLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  const handleReview = async (status: ApplicationStatus) => {
    if (!app || busy) return
    setBusy(status)
    const result = await reviewApplication({
      applicationId: app.id,
      status,
      note: note || null,
    })
    setBusy(null)
    if (result.success) {
      toast.success(
        isAr
          ? status === "approved"
            ? "تم قبول الطلب"
            : status === "rejected"
              ? "تم رفض الطلب"
              : "تم تحديث حالة الطلب"
          : status === "approved"
            ? "Application approved"
            : status === "rejected"
              ? "Application rejected"
              : "Application status updated"
      )
      setNote("")
      setReloadKey((k) => k + 1)
    } else {
      toast.error(result.error || t.common.error)
    }
  }

  const handleDownload = async (doc: DriverApplicationDocument) => {
    if (downloadingId) return
    setDownloadingId(doc.id)
    const result = await getDocumentDownloadUrl(doc.id)
    setDownloadingId(null)
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer")
    } else {
      toast.error(result.error || t.common.error)
    }
  }

  const isTerminal = app?.status === "approved" || app?.status === "rejected"

  if (isLoading) {
    return (
      <div className="space-y-6 px-4 py-4 lg:px-6">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error || !app) {
    return (
      <div className="space-y-4 px-4 py-4 lg:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/applications")}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          {t.common.back}
        </Button>
        <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "تعذّر العثور على الطلب"
              : "Application not found"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => router.push("/applications")}
          >
            {t.nav.applications}
          </Button>
        </div>
      </div>
    )
  }

  const statusMeta = STATUS_META[app.status]
  const isArLocale = app.locale === "ar" || app.locale === "ur"
  const workType = WORK_TYPE_META[app.work_type]
  const category = app.driver_category
    ? CATEGORY_META[app.driver_category]
    : null
  const identityType = IDENTITY_META[app.identity_type]

  return (
    <div className="space-y-6 px-4 py-4 lg:px-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/applications")}
        className="w-fit gap-1.5"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {t.common.back}
      </Button>

      {/* ── Profile header ── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 p-6 shadow-sm backdrop-blur-sm">
        <div
          className="absolute top-0 right-0 h-32 w-32 rounded-full opacity-[0.06]"
          style={{ backgroundColor: "#8B5CF6", transform: "translate(30%, -30%)" }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-2xl font-bold text-white shadow-lg shadow-violet-500/20">
              {app.full_name?.slice(0, 1) || "?"}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {app.full_name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-xs text-foreground">
                  {app.application_number}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    statusMeta.className
                  )}
                >
                  {isAr ? statusMeta.ar : statusMeta.en}
                </span>
                {category && (
                  <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-foreground/80">
                    {isAr ? category.ar : category.en}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 sm:gap-6">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                {isAr ? "تاريخ التقديم" : "Submitted"}
              </span>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {fmtDate(app.submitted_at)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                {isAr ? "نوع العمل" : "Work Type"}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {workType ? (isAr ? workType.ar : workType.en) : "—"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                {isAr ? "لغة الطلب" : "Locale"}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold text-foreground",
                  isArLocale && "text-right"
                )}
                dir={isArLocale ? "rtl" : "ltr"}
              >
                {app.locale.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Info sections ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InfoGroup icon={User} title={isAr ? "البيانات الشخصية" : "Personal"}>
          <InfoRow
            label={isAr ? "الاسم الأول" : "First Name"}
            value={app.first_name}
          />
          <InfoRow
            label={isAr ? "الاسم الأوسط" : "Middle Name"}
            value={app.middle_name || "—"}
          />
          <InfoRow
            label={isAr ? "اسم العائلة" : "Last Name"}
            value={app.last_name}
          />
          <InfoRow
            label={isAr ? "الاسم الكامل" : "Full Name"}
            value={app.full_name}
          />
          <InfoRow
            label={isAr ? "تاريخ الميلاد" : "Date of Birth"}
            value={fmtDate(app.date_of_birth)}
          />
          <InfoRow
            label={isAr ? "الجنسية" : "Nationality"}
            value={app.nationality || "—"}
          />
          <InfoRow
            label={isAr ? "الجنس" : "Gender"}
            value={
              app.gender
                ? isAr
                  ? app.gender === "male"
                    ? "ذكر"
                    : "أنثى"
                  : app.gender === "male"
                    ? "Male"
                    : "Female"
                : "—"
            }
          />
        </InfoGroup>

        <InfoGroup icon={Phone} title={isAr ? "التواصل" : "Contact"}>
          <InfoRow
            label={isAr ? "الجوال" : "Mobile"}
            value={<span dir="ltr">{app.mobile}</span>}
          />
          <InfoRow
            label={isAr ? "جوال بديل" : "Alternative Mobile"}
            value={
              app.alternative_mobile ? (
                <span dir="ltr">{app.alternative_mobile}</span>
              ) : (
                "—"
              )
            }
          />
          <InfoRow
            label={isAr ? "البريد الإلكتروني" : "Email"}
            value={
              app.email ? <span dir="ltr">{app.email}</span> : "—"
            }
          />
          <InfoRow
            label={isAr ? "المدينة" : "City"}
            value={app.city || "—"}
          />
          <InfoRow
            label={isAr ? "الحي" : "District"}
            value={app.district || "—"}
          />
          <InfoRow
            label={isAr ? "العنوان" : "Address"}
            value={app.address || "—"}
          />
        </InfoGroup>

        <InfoGroup icon={IdCard} title={isAr ? "الهوية" : "Identity"}>
          <InfoRow
            label={isAr ? "نوع الهوية" : "Identity Type"}
            value={identityType ? (isAr ? identityType.ar : identityType.en) : "—"}
          />
          <InfoRow
            label={isAr ? "رقم الهوية" : "Identity No."}
            value={
              app.identity_number ? (
                <span dir="ltr">{app.identity_number}</span>
              ) : (
                "—"
              )
            }
          />
          <InfoRow
            label={isAr ? "انتهاء الهوية" : "Identity Expiry"}
            value={fmtDate(app.identity_expiry)}
          />
        </InfoGroup>

        <InfoGroup icon={BadgeCheck} title={isAr ? "رخصة القيادة" : "Driving License"}>
          <InfoRow
            label={isAr ? "رقم الرخصة" : "License No."}
            value={
              app.license_number ? (
                <span dir="ltr">{app.license_number}</span>
              ) : (
                "—"
              )
            }
          />
          <InfoRow
            label={isAr ? "نوع الرخصة" : "License Type"}
            value={app.license_type || "—"}
          />
          <InfoRow
            label={isAr ? "دولة الإصدار" : "Issuing Country"}
            value={app.license_country || "—"}
          />
          <InfoRow
            label={isAr ? "انتهاء الرخصة" : "License Expiry"}
            value={fmtDate(app.license_expiry)}
          />
        </InfoGroup>

        <InfoGroup icon={Briefcase} title={isAr ? "العمل" : "Work"}>
          <InfoRow
            label={isAr ? "نوع العمل" : "Work Type"}
            value={workType ? (isAr ? workType.ar : workType.en) : "—"}
          />
          <InfoRow
            label={isAr ? "فئة السائق" : "Driver Category"}
            value={category ? (isAr ? category.ar : category.en) : "—"}
          />
          <InfoRow
            label={isAr ? "المنصات" : "Platforms"}
            value={
              platformCodes.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {platformCodes.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-xs text-foreground/80"
                    >
                      {c}
                    </span>
                  ))}
                </span>
              ) : (
                "—"
              )
            }
          />
        </InfoGroup>

        <InfoGroup icon={Car} title={isAr ? "المركبة" : "Vehicle"}>
          <InfoRow
            label={isAr ? "لديه مركبة؟" : "Has Vehicle?"}
            value={
              app.has_vehicle === null || app.has_vehicle === undefined
                ? "—"
                : app.has_vehicle
                  ? t.common.yes
                  : t.common.no
            }
          />
          {app.has_vehicle && (
            <>
              <InfoRow
                label={isAr ? "الملكية" : "Ownership"}
                value={app.vehicle_ownership || "—"}
              />
              <InfoRow
                label={isAr ? "النوع" : "Type"}
                value={app.vehicle_type || "—"}
              />
              <InfoRow
                label={isAr ? "الماركة" : "Make"}
                value={app.vehicle_make || "—"}
              />
              <InfoRow
                label={isAr ? "الموديل" : "Model"}
                value={app.vehicle_model || "—"}
              />
              <InfoRow
                label={isAr ? "السنة" : "Year"}
                value={app.vehicle_year ? String(app.vehicle_year) : "—"}
              />
              <InfoRow
                label={isAr ? "رقم اللوحة" : "Plate No."}
                value={app.vehicle_plate || "—"}
              />
              <InfoRow
                label={isAr ? "انتهاء الاستمارة" : "Registration Expiry"}
                value={fmtDate(app.vehicle_reg_expiry)}
              />
              <InfoRow
                label={isAr ? "انتهاء التأمين" : "Insurance Expiry"}
                value={fmtDate(app.vehicle_insurance_expiry)}
              />
            </>
          )}
        </InfoGroup>
      </div>

      {/* ── Consent ── */}
      <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold text-foreground">
            {isAr ? "الموافقات" : "Consent"}
          </h3>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-foreground/80">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2
              className={cn(
                "h-4 w-4",
                app.consent_terms
                  ? "text-emerald-500"
                  : "text-muted-foreground/40"
              )}
            />
            {isAr ? "الشروط والأحكام" : "Terms & Conditions"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2
              className={cn(
                "h-4 w-4",
                app.consent_privacy
                  ? "text-emerald-500"
                  : "text-muted-foreground/40"
              )}
            />
            {isAr ? "سياسة الخصوصية" : "Privacy Policy"}
          </span>
          {app.consent_at && (
            <span className="text-xs text-muted-foreground">
              {fmtDate(app.consent_at)}
            </span>
          )}
        </div>
      </div>

      {/* ── Documents ── */}
      <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
          <FileText className="h-4 w-4 text-elite-blue-500" />
          <h3 className="text-sm font-semibold text-foreground">
            {isAr ? "المستندات" : "Documents"}
          </h3>
          <span className="ms-auto text-xs text-muted-foreground">
            {documents.length} {isAr ? "مستند" : "files"}
          </span>
        </div>

        {documents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {isAr ? "لا توجد مستندات" : "No documents uploaded"}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {documents.map((doc) => {
              const meta =
                DOCUMENT_TYPE_META[doc.document_type] ?? {
                  ar: doc.document_type,
                  en: doc.document_type,
                }
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/60 p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-elite-blue-500/10">
                    <FileText className="h-5 w-5 text-elite-blue-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {isAr ? meta.ar : meta.en}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" dir="ltr">
                      {doc.file_name}
                      {doc.file_size != null && ` · ${fmtBytes(doc.file_size)}`}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => handleDownload(doc)}
                    disabled={downloadingId === doc.id}
                  >
                    {downloadingId === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    <span>{isAr ? "تنزيل" : "Download"}</span>
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Review note (visible even after terminal review) ── */}
      {app.review_note && (
        <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-sm text-foreground/80">
            <span className="font-medium">
              {isAr ? "ملاحظة المراجعة:" : "Review note:"}
            </span>{" "}
            {app.review_note}
          </p>
        </div>
      )}

      {/* ── Review action bar ── */}
      {!isTerminal && (
        <div className="sticky bottom-4 z-10 rounded-2xl border border-border/60 bg-card/90 p-4 shadow-lg backdrop-blur-md">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {isAr ? "ملاحظة (اختياري)" : "Review note (optional)"}
              </label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  isAr
                    ? "أضف ملاحظة للمتقدم أو للفريق الداخلي..."
                    : "Add a note for the applicant or internal team..."
                }
                className="h-10 min-h-10 resize-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => handleReview("under_review")}
                disabled={!!busy}
                className="gap-1.5"
              >
                {busy === "under_review" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Clock className="h-4 w-4" />
                )}
                {isAr ? "قيد المراجعة" : "Under Review"}
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleReview("rejected")}
                disabled={!!busy}
                className="gap-1.5"
              >
                {busy === "rejected" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {isAr ? "رفض" : "Reject"}
              </Button>
              <Button
                onClick={() => handleReview("approved")}
                disabled={!!busy}
                className="gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-600 hover:to-emerald-700"
              >
                {busy === "approved" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {isAr ? "قبول" : "Approve"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
