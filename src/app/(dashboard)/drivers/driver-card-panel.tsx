"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import {
  AlertTriangle,
  Bike,
  Briefcase,
  Building2,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  CreditCard,
  FileText,
  Fingerprint,
  Flag,
  Hash,
  HeartPulse,
  Loader2,
  Mail,
  MapPin,
  Minus,
  Phone,
  RefreshCw,
  ShieldCheck,
  Star,
  User,
  Wallet,
  XCircle,
} from "lucide-react"

type CardKey = "car" | "work" | "residence" | "health" | "wallet"

type ComplianceStatus =
  | "verified"
  | "valid"
  | "expiring"
  | "missing"
  | "expired"
  | "suspended"
  | "blocked"
  | "review"

type RequirementStatus = "valid" | "expiring" | "expired" | "missing" | "review"

interface Person {
  name: string
  phone: string
  idNumber: string
  email?: string
  avatar?: string | null
  [key: string]: unknown
}

interface CardStatus {
  title: string
  status: ComplianceStatus
  statusLabel: string
  expiry?: string | null
  daysLeft?: number | null
  blocking?: string | null
  progress?: number | null
  [key: string]: unknown
}

interface ComplianceRequirement {
  requirement: string
  label: string
  labelAr?: string
  appliesTo: string[]
  status: RequirementStatus
  blocking: boolean
  expiryDate?: string | null
  daysUntilExpiry?: number | null
  notes?: string | null
}

interface ComplianceEvaluation {
  overall_status?: string
  can_receive_orders?: boolean
  blocking_count?: number
  warning_count?: number
  evaluated_at?: string
  requirements?: ComplianceRequirement[]
  [key: string]: unknown
}

export interface CardPanelDriver {
  id: string
  tenant_id: string
  driver_code?: string
  status?: string
  person?: Person
  cards: Record<CardKey, CardStatus>
  evaluation?: ComplianceEvaluation | null
}

interface UploadedDoc {
  name: string
  path: string
  url?: string | null
  uploadedAt: string
  size?: number | null
  mime?: string | null
}

interface DriverCardPanelProps {
  driver: CardPanelDriver
  onDataRefresh?: () => void
  onUploadDocument?: (requirementKey: string, file: File) => Promise<void>
}

const CARD_ORDER: CardKey[] = ["car", "work", "residence", "health", "wallet"]

const DOC_BUCKET = "driver-documents"
const PHOTO_BUCKET = "driver-photos"
const DOC_MAX_BYTES = 10 * 1024 * 1024
const PHOTO_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_DOC_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const REQUIREMENT_DOC_TYPE: Record<string, string> = {
  national_id: "national_id",
  driving_license: "driving_license",
  vehicle_registration: "vehicle_registration",
  insurance: "insurance",
  photo: "photo",
}

const CARD_META: Record<
  CardKey,
  { icon: typeof Car; en: string; ar: string; accent: string }
> = {
  car: { icon: Car, en: "Vehicle", ar: "المركبة", accent: "#1E5A99" },
  work: { icon: Briefcase, en: "Work", ar: "العمل", accent: "#F5A623" },
  residence: { icon: MapPin, en: "Residence", ar: "الإقامة", accent: "#2E86C1" },
  health: { icon: HeartPulse, en: "Health", ar: "الصحة", accent: "#E74C3C" },
  wallet: { icon: Wallet, en: "Wallet", ar: "المحفظة", accent: "#27AE60" },
}

const STATUS_STYLE: Record<
  ComplianceStatus,
  { label: string; ar: string; classes: string; icon: typeof Check }
> = {
  verified: {
    label: "Verified",
    ar: "موثّق",
    classes:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    icon: ShieldCheck,
  },
  valid: {
    label: "Valid",
    ar: "ساري",
    classes:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    icon: CheckCircle2,
  },
  expiring: {
    label: "Expiring",
    ar: "قارب على الانتهاء",
    classes:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    icon: AlertTriangle,
  },
  missing: {
    label: "Missing",
    ar: "مفقود",
    classes: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
    icon: Circle,
  },
  expired: {
    label: "Expired",
    ar: "منتهي",
    classes: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    icon: XCircle,
  },
  suspended: {
    label: "Suspended",
    ar: "موقوف",
    classes: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    icon: Minus,
  },
  blocked: {
    label: "Blocked",
    ar: "محظور",
    classes: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    icon: XCircle,
  },
  review: {
    label: "In Review",
    ar: "قيد المراجعة",
    classes: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",
    icon: Clock,
  },
}

const FALLBACK_STATUS = STATUS_STYLE.missing

function normalizeStatus(raw: unknown): ComplianceStatus {
  if (typeof raw !== "string") return "missing"
  const value = raw.toLowerCase()
  if (value === "verified") return "verified"
  if (value === "valid" || value === "ok" || value === "compliant") return "valid"
  if (value === "expiring" || value === "warning" || value === "expiring_soon")
    return "expiring"
  if (value === "missing" || value === "incomplete") return "missing"
  if (value === "expired") return "expired"
  if (value === "suspended") return "suspended"
  if (value === "blocked") return "blocked"
  if (value === "review" || value === "pending" || value === "in_review") return "review"
  return "missing"
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function fmtDays(days: number | null | undefined, isAr: boolean): string | null {
  if (days === null || days === undefined) return null
  if (days < 0) return isAr ? `منتهي منذ ${Math.abs(days)} يوم` : `${Math.abs(days)}d overdue`
  if (days === 0) return isAr ? "ينتهي اليوم" : "Expires today"
  return isAr ? `متبقٍ ${days} يوم` : `${days}d left`
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "string" && value.trim().length > 0) return value
    if (typeof value === "number") return String(value)
  }
  return undefined
}

function RequirementBadge({ status, isAr }: { status: RequirementStatus; isAr: boolean }) {
  const style = STATUS_STYLE[status] ?? FALLBACK_STATUS
  const Icon = style.icon
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.classes}`}
    >
      <Icon className="h-3 w-3" />
      {isAr ? style.ar : style.label}
    </span>
  )
}

function RequirementIcon({ requirement }: { requirement: string }) {
  const map: Record<string, typeof FileText> = {
    national_id: Fingerprint,
    driving_license: CreditCard,
    vehicle_registration: Car,
    insurance: ShieldCheck,
    photo: User,
  }
  const Icon = map[requirement] ?? FileText
  return <Icon className="h-4 w-4 text-muted-foreground" />
}

export function DriverCardPanel({
  driver,
  onDataRefresh,
  onUploadDocument,
}: DriverCardPanelProps) {
  const person = useMemo(() => (driver.person ?? {}) as Person, [driver.person])
  const isAr = true

  const name =
    person.name ??
    pickString(person, ["full_name", "full_name_en", "full_name_ar", "driver_name"]) ??
    "—"
  const phone =
    pickString(person, [
      "phone",
      "mobile",
      "primary_mobile",
      "secondary_mobile",
      "mobile_number",
      "phone_number",
    ]) ?? "—"
  const idNumber =
    pickString(person, [
      "national_id",
      "iqama_number",
      "national_id_iqama",
      "id_number",
      "iqama",
      "identity_number",
    ]) ?? "—"
  const email = person.email ?? pickString(person, ["work_email", "personal_email"])

  const evaluation = driver.evaluation ?? null
  const requirements = evaluation?.requirements ?? []
  const overallStatus = normalizeStatus(
    evaluation?.overall_status ?? driver.status ?? "missing",
  )
  const overall = STATUS_STYLE[overallStatus] ?? FALLBACK_STATUS

  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [docs, setDocs] = useState<UploadedDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploadingReq, setUploadingReq] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingReqRef = useRef<string | null>(null)

  const personAvatar =
    person.avatar ?? pickString(person, ["photo_url", "avatar_url", "photo"]) ?? null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!personAvatar) {
        setPhotoPreviewUrl(null)
        return
      }
      if (/^https?:\/\//i.test(personAvatar)) {
        if (!cancelled) setPhotoPreviewUrl(personAvatar)
        return
      }
      try {
        const supabase = createClient()
        const { data, error } = await supabase.storage
          .from(PHOTO_BUCKET)
          .createSignedUrl(personAvatar, 3600)
        if (!cancelled) setPhotoPreviewUrl(error ? null : (data?.signedUrl ?? null))
      } catch {
        if (!cancelled) setPhotoPreviewUrl(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [personAvatar])

  const loadDocs = useCallback(async () => {
    setDocsLoading(true)
    try {
      const supabase = createClient()
      const prefix = `${driver.tenant_id}/${driver.id}`
      const { data, error } = await supabase.storage.from(DOC_BUCKET).list(prefix, {
        limit: 50,
        sortBy: { column: "created_at", order: "desc" },
      })
      if (error) {
        setDocs([])
        return
      }
      const mapped: UploadedDoc[] = (data ?? [])
        .filter((item) => item.name && !item.name.endsWith("/"))
        .map((item) => ({
          name: item.name,
          path: `${prefix}/${item.name}`,
          uploadedAt: item.created_at ?? "",
          size: item.metadata?.size ?? null,
          mime: item.metadata?.mimetype ?? null,
        }))
      setDocs(mapped)
    } catch {
      setDocs([])
    } finally {
      setDocsLoading(false)
    }
  }, [driver.id, driver.tenant_id])

  useEffect(() => {
    void loadDocs()
  }, [loadDocs])

  const openDoc = useCallback(async (path: string) => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase.storage
        .from(DOC_BUCKET)
        .createSignedUrl(path, 300)
      if (error || !data?.signedUrl) {
        toast.error(isAr ? "تعذر فتح المستند" : "Could not open document")
        return
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer")
    } catch {
      toast.error(isAr ? "تعذر فتح المستند" : "Could not open document")
    }
  }, [isAr])

  const triggerUpload = useCallback((requirementKey: string) => {
    pendingReqRef.current = requirementKey
    fileInputRef.current?.click()
  }, [])

  const uploadRequirementFile = useCallback(
    async (requirementKey: string, file: File) => {
      if (onUploadDocument) {
        setUploadingReq(requirementKey)
        try {
          await onUploadDocument(requirementKey, file)
          await loadDocs()
          onDataRefresh?.()
        } finally {
          setUploadingReq(null)
        }
        return
      }

      const isPhoto = requirementKey === "photo"
      if (isPhoto) {
        if (!/^image\//.test(file.type)) {
          toast.error(isAr ? "يُسمح بالصور فقط" : "Only image files are allowed")
          return
        }
        if (file.size > PHOTO_MAX_BYTES) {
          toast.error(isAr ? "الصورة كبيرة جدًا (الحد الأقصى 5MB)" : "Image is too large (max 5MB)")
          return
        }
      } else {
        if (!ALLOWED_DOC_TYPES.has(file.type)) {
          toast.error(
            isAr ? "نوع الملف غير مدعوم (PDF أو صورة)" : "Unsupported file type (PDF or image only)",
          )
          return
        }
        if (file.size > DOC_MAX_BYTES) {
          toast.error(isAr ? "الملف كبير جدًا (الحد الأقصى 10MB)" : "File is too large (max 10MB)")
          return
        }
      }

      setUploadingReq(requirementKey)
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const tenantId =
          driver.tenant_id ||
          (session?.user?.user_metadata?.tenant_id as string | undefined) ||
          ""
        if (!tenantId) {
          toast.error(isAr ? "تعذر تحديد المستأجر" : "Could not resolve tenant")
          return
        }

        const docType = REQUIREMENT_DOC_TYPE[requirementKey] ?? requirementKey
        const safeName = file.name.replace(/[^\w.\-]+/g, "-").toLowerCase()
        const bucket = isPhoto ? PHOTO_BUCKET : DOC_BUCKET
        const path = isPhoto
          ? `${tenantId}/${driver.id}/photo-${Date.now()}-${safeName}`
          : `${tenantId}/${driver.id}/${docType}-${Date.now()}-${safeName}`

        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type,
        })
        if (uploadError) {
          toast.error(uploadError.message)
          return
        }

        if (isPhoto) {
          const { updateDriverPhoto } = await import("@/app/actions/drivers/driver-photo")
          const result = await updateDriverPhoto({ driverId: driver.id, filePath: path })
          if (!result.success) {
            toast.error(result.error)
            return
          }
          onPhotoSuccess(result.signedUrl)
        } else {
          toast.success(isAr ? "تم رفع المستند" : "Document uploaded")
        }

        await loadDocs()
        onDataRefresh?.()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : isAr ? "فشل الرفع" : "Upload failed")
      } finally {
        setUploadingReq(null)
      }
    },
    [driver.id, driver.tenant_id, isAr, loadDocs, onDataRefresh, onUploadDocument],
  )

  const onPhotoSuccess = useCallback((signedUrl: string | null) => {
    setPhotoPreviewUrl(signedUrl)
    toast.success("تم تحديث الصورة")
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadDocs()
      onDataRefresh?.()
    } finally {
      setRefreshing(false)
    }
  }, [loadDocs, onDataRefresh])

  const cardEntries = CARD_ORDER.map((key) => {
    const meta = CARD_META[key]
    const card = driver.cards?.[key]
    const status = normalizeStatus(card?.status)
    const style = STATUS_STYLE[status] ?? FALLBACK_STATUS
    return { key, meta, card, status, style }
  })

  const completedCards = cardEntries.filter(
    (entry) => entry.status === "verified" || entry.status === "valid",
  ).length

  return (
    <div dir="rtl" className="space-y-4 text-right">
      {/* Person section */}
      <div className="rounded-2xl border border-border/50 bg-card/70 p-4">
        <div className="flex items-start gap-3">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted">
            {photoPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoPreviewUrl}
                alt={name}
                className="h-full w-full object-cover"
              />
            ) : (
              <User className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold">{name}</h3>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${overall.classes}`}
              >
                <overall.icon className="h-3 w-3" />
                {isAr ? overall.ar : overall.label}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                <span dir="ltr">{phone}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5" />
                <span dir="ltr">{idNumber}</span>
              </span>
              {email ? (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  <span dir="ltr">{email}</span>
                </span>
              ) : null}
              {driver.driver_code ? (
                <span className="inline-flex items-center gap-1.5">
                  <Flag className="h-3.5 w-3.5" />
                  <span dir="ltr">{driver.driver_code}</span>
                </span>
              ) : null}
            </div>
            <button
              type="button"
              disabled={uploadingReq === "photo"}
              onClick={() => triggerUpload("photo")}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              {uploadingReq === "photo" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Camera className="h-3 w-3" />
              )}
              {photoPreviewUrl ? "تغيير الصورة" : "رفع صورة"}
            </button>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            title={isAr ? "تحديث" : "Refresh"}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cardEntries.map(({ key, meta, card, status, style }) => {
          const Icon = meta.icon
          const StatusIcon = style.icon
          const expiry = card?.expiry ?? null
          const daysLeft = card?.daysLeft ?? null
          const daysLabel = fmtDays(daysLeft, isAr)
          const progress =
            typeof card?.progress === "number"
              ? Math.max(0, Math.min(100, card.progress))
              : null
          return (
            <div
              key={key}
              className="rounded-xl border border-border/50 bg-card/60 p-3 transition-colors hover:border-border"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-medium">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${meta.accent}1A`, color: meta.accent }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  {isAr ? meta.ar : meta.en}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.classes}`}
                >
                  <StatusIcon className="h-3 w-3" />
                  {isAr ? style.ar : style.label}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {fmtDate(expiry)}
                  </span>
                  {daysLabel ? <span>{daysLabel}</span> : null}
                </div>
                {card?.blocking ? (
                  <p className="text-red-600 dark:text-red-400">{card.blocking}</p>
                ) : null}
                {progress !== null ? (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        status === "verified" || status === "valid"
                          ? "bg-emerald-500"
                          : status === "expiring" || status === "review"
                            ? "bg-amber-500"
                            : status === "missing"
                              ? "bg-slate-400"
                              : "bg-red-500"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {/* Requirements */}
      <div className="rounded-2xl border border-border/50 bg-card/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            {isAr ? "متطلبات الامتثال" : "Compliance requirements"}
          </h4>
          <span className="text-[11px] text-muted-foreground">
            {isAr
              ? `${completedCards} من ${CARD_ORDER.length} بطاقات سارية`
              : `${completedCards}/${CARD_ORDER.length} cards valid`}
          </span>
        </div>
        {requirements.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "لا توجد متطلبات مسجلة بعد. حدّث البيانات لإعادة التقييم."
              : "No requirements recorded yet. Refresh to re-evaluate."}
          </p>
        ) : (
          <ul className="space-y-2">
            {requirements.map((req) => (
              <li
                key={req.requirement}
                className="flex items-center gap-2 rounded-xl border border-border/40 bg-background/40 px-3 py-2"
              >
                <RequirementIcon requirement={req.requirement} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {isAr ? (req.labelAr ?? req.label) : req.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDate(req.expiryDate)}
                    {req.daysUntilExpiry !== null && req.daysUntilExpiry !== undefined
                      ? ` · ${fmtDays(req.daysUntilExpiry, isAr) ?? ""}`
                      : ""}
                    {req.blocking ? (isAr ? " · حاجب" : " · blocking") : ""}
                  </p>
                </div>
                <RequirementBadge status={req.status} isAr={isAr} />
                {(req.status === "missing" ||
                  req.status === "expired" ||
                  req.status === "expiring") && (
                  <button
                    type="button"
                    disabled={uploadingReq === req.requirement}
                    onClick={() => triggerUpload(req.requirement)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
                  >
                    {uploadingReq === req.requirement ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                    )}
                    {isAr ? "رفع" : "Upload"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Documents */}
      <div className="rounded-2xl border border-border/50 bg-card/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold">{isAr ? "المستندات" : "Documents"}</h4>
          <span className="text-[11px] text-muted-foreground">
            {docsLoading ? (isAr ? "جارٍ التحميل…" : "Loading…") : `${docs.length}`}
          </span>
        </div>
        {docs.length === 0 && !docsLoading ? (
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "لا توجد مستندات مرفوعة بعد."
              : "No documents uploaded yet."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {docs.slice(0, 8).map((doc) => (
              <li key={doc.path}>
                <button
                  type="button"
                  onClick={() => void openDoc(doc.path)}
                  className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-right text-xs transition-colors hover:border-border/60 hover:bg-muted/60"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" dir="ltr">
                    {doc.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {fmtDate(doc.uploadedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0]
          const reqKey = pendingReqRef.current
          event.target.value = ""
          pendingReqRef.current = null
          if (file && reqKey) void uploadRequirementFile(reqKey, file)
        }}
      />
    </div>
  )
}

export default DriverCardPanel
