"use client"

// User detail surface (Module 14) — tenant-scoped profile with live DB
// facts, Hijri dual dates for date display, PDPL masking on the phone field
// via has_user_pdpl_consent() (evaluated server-side in fetchUserDetail),
// employee-code assignment via the sequence helper, and the status
// lifecycle menu.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  KeyRound,
  Loader2,
  Mail,
  MoreHorizontal,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { fetchUserDetail, type UserDetail } from "@/lib/users/queries"
import { assignEmployeeCode } from "@/lib/users/actions"
import {
  ALLOWED_STATUS_TRANSITIONS,
  ROLE_META,
  STATUS_META,
  maskSensitiveValue,
  type UserStatus,
} from "@/lib/users/user-utils"
import { formatDualDate } from "@/lib/formatting/hijri"
import { UserStatusDialog } from "../components/user-status-dialog"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/30 py-2.5 last:border-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  )
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>()
  const userId = params?.id
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const [user, setUser] = useState<UserDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [assigningCode, setAssigningCode] = useState(false)
  const [statusTarget, setStatusTarget] = useState<UserStatus | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    setIsLoading(true)
    try {
      const detail = await fetchUserDetail(userId)
      setUser(detail)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
    setIsLoading(false)
  }, [userId])

  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  async function handleAssignCode() {
    if (!userId) return
    setAssigningCode(true)
    const result = await assignEmployeeCode({ userId })
    setAssigningCode(false)
    if (result.success) {
      toast.success(isAr ? "تم تعيين الرمز الوظيفي" : "Employee code assigned")
      void load()
    } else {
      toast.error(result.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 p-6" aria-busy="true">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (loadFailed || !user) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {isAr ? "المستخدم غير موجود" : "User not found"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "قد يكون الحساب محذوفًا أو خارج نطاق مؤسستك."
              : "The account may be deleted or outside your organization."}
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-xl">
          <Link href="/users">
            <ArrowLeft className="h-4 w-4" />
            {isAr ? "العودة للمستخدمين" : "Back to users"}
          </Link>
        </Button>
      </div>
    )
  }

  const statusMeta = STATUS_META[user.status] ?? STATUS_META.inactive
  const targets = ALLOWED_STATUS_TRANSITIONS[user.status]
  const displayName = user.full_name_ar ?? user.full_name_en ?? user.email

  return (
    <div className="space-y-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-lg font-bold text-white">
            {(user.full_name_ar ?? user.full_name_en ?? "?").trim().slice(0, 1)}
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  statusMeta.className
                )}
              >
                {isAr ? statusMeta.ar : statusMeta.en}
              </span>
              {user.employee_code && (
                <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                  {user.employee_code}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {isAr ? ROLE_META[user.role]?.ar ?? user.role : ROLE_META[user.role]?.en ?? user.role}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/users">
              <ArrowLeft className="h-4 w-4" />
              {isAr ? "رجوع" : "Back"}
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-xl">
                <MoreHorizontal className="h-4 w-4" />
                {isAr ? "إجراءات" : "Actions"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {isAr ? "حالة الحساب" : "Account status"}
              </DropdownMenuLabel>
              {targets.length === 0 ? (
                <DropdownMenuItem disabled className="text-xs">
                  {isAr ? "حالة نهائية — لا تحويلات" : "Terminal status — no transitions"}
                </DropdownMenuItem>
              ) : (
                targets.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    className={cn("text-xs", (s === "locked" || s === "terminated") && "text-destructive")}
                    onClick={() => {
                      setStatusTarget(s)
                      setStatusOpen(true)
                    }}
                  >
                    {isAr ? `تغيير إلى: ${STATUS_META[s].ar}` : `Set to: ${STATUS_META[s].en}`}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Facts grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl border border-border/50 bg-card/60 shadow-sm backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Mail className="h-4 w-4 text-elite-blue-600" />
              {isAr ? "الحساب" : "Account"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <FactRow label="Email" value={<span dir="ltr">{user.email}</span>} />
            <FactRow
              label={isAr ? "التحقق الثنائي" : "Two-factor"}
              value={
                user.two_factor_enabled ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" /> {isAr ? "مفعّل" : "Enabled"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5" /> {isAr ? "غير مفعّل" : "Disabled"}
                  </span>
                )
              }
            />
            <FactRow
              label={isAr ? "تغيير كلمة المرور مطلوب" : "Must change password"}
              value={user.must_change_password ? (isAr ? "نعم" : "Yes") : isAr ? "لا" : "No"}
            />
            <FactRow
              label={isAr ? "آخر دخول" : "Last login"}
              value={
                <span dir="ltr" className="text-xs tabular-nums">
                  {formatDualDate(user.last_login_at, isAr)}
                </span>
              }
            />
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/50 bg-card/60 shadow-sm backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <BadgeCheck className="h-4 w-4 text-elite-blue-600" />
              {isAr ? "الملف الشخصي" : "Profile"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <FactRow
              label={isAr ? "الاسم (عربي)" : "Name (AR)"}
              value={user.full_name_ar ?? "—"}
            />
            <FactRow
              label={isAr ? "الاسم (إنجليزي)" : "Name (EN)"}
              value={<span dir="ltr">{user.full_name_en ?? "—"}</span>}
            />
            <FactRow label={isAr ? "الاسم المفضل" : "Preferred name"} value={user.preferred_name ?? "—"} />
            <FactRow
              label={isAr ? "الجوال" : "Phone"}
              value={
                <span dir="ltr" className="tabular-nums">
                  {maskSensitiveValue(user.phone, user.pdplConsent === true)}
                </span>
              }
            />
            {user.pdplConsent !== true && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                {isAr
                  ? "مقنّع وفق نظام حماية البيانات الشخصية حتى تسجيل موافقة الشروط."
                  : "Masked per PDPL until the terms consent is recorded."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/50 bg-card/60 shadow-sm backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="h-4 w-4 text-elite-blue-600" />
              {isAr ? "المহلات الزمنية" : "Lifecycle"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <FactRow
              label={isAr ? "أُرسلت الدعوة" : "Invited"}
              value={
                <span dir="ltr" className="text-xs tabular-nums">
                  {formatDualDate(user.invited_at, isAr)}
                </span>
              }
            />
            <FactRow
              label={isAr ? "قُبلت الدعوة" : "Invite accepted"}
              value={
                <span dir="ltr" className="text-xs tabular-nums">
                  {formatDualDate(user.accepted_invite_at, isAr)}
                </span>
              }
            />
            <FactRow
              label={isAr ? "أُنشئ الحساب" : "Created"}
              value={
                <span dir="ltr" className="text-xs tabular-nums">
                  {formatDualDate(user.created_at, isAr)}
                </span>
              }
            />
            <FactRow
              label={isAr ? "آخر تحديث" : "Updated"}
              value={
                <span dir="ltr" className="text-xs tabular-nums">
                  {formatDualDate(user.updated_at, isAr)}
                </span>
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* Employee code card */}
      <Card className="rounded-2xl border border-border/50 bg-card/60 shadow-sm backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-elite-blue-600" />
            {isAr ? "الرمز الوظيفي" : "Employee code"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {isAr
              ? "رمز متسلسل على مستوى المؤسسة (EDU-NNNNNN) — يُصدر مرة واحدة عبر مُساعد التسلسل ولا يمكن إعادة تعيينه."
              : "Tenant-scoped sequence code (EDU-NNNNNN) — issued once via the sequence helper and never reissued."}
          </p>
          {user.employee_code ? (
            <span dir="ltr" className="rounded-lg bg-muted px-3 py-1.5 font-mono text-sm">
              {user.employee_code}
            </span>
          ) : (
            <Button
              size="sm"
              className="rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white hover:from-elite-blue-600 hover:to-elite-blue-700"
              onClick={handleAssignCode}
              disabled={assigningCode}
            >
              {assigningCode && <Loader2 className="h-4 w-4 animate-spin" />}
              {isAr ? "تعيين رمز" : "Assign code"}
            </Button>
          )}
        </CardContent>
      </Card>

      <UserStatusDialog
        userId={user.id}
        userName={displayName}
        target={statusTarget}
        open={statusOpen}
        onOpenChange={setStatusOpen}
        onDone={() => void load()}
      />
    </div>
  )
}
