"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Shield, ShieldCheck, KeyRound, Lock, Clock, AlertTriangle } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

interface SecurityPolicy {
  key: string
  value: string
}

interface MyAccount {
  full_name_ar: string | null
  full_name_en: string | null
  email: string
  two_factor_enabled: boolean
  must_change_password: boolean
  failed_login_attempts: number
  locked_until: string | null
  last_login_at: string | null
  password_changed_at: string | null
}

function fmtDate(date: string | null): string {
  if (!date) return "—"
  try {
    return new Date(date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return date
  }
}

export default function SecuritySettingsPage() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [account, setAccount] = useState<MyAccount | null>(null)
  const [policies, setPolicies] = useState<SecurityPolicy[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: me } = await supabase
          .from("users")
          .select(
            "full_name_ar,full_name_en,email,two_factor_enabled,must_change_password,failed_login_attempts,locked_until,last_login_at,password_changed_at"
          )
          .eq("auth_user_id", user.id)
          .is("deleted_at", null)
          .maybeSingle<MyAccount>()
        setAccount(me ?? null)
      }

      const { data: policyRows } = await supabase
        .from("system_settings")
        .select("key,value")
        .ilike("key", "security.%")
        .is("deleted_at", null)
        .order("key", { ascending: true })

      if (!policyRows) setError(true)
      else setPolicies(policyRows as SecurityPolicy[])
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

  const policyLabel = (key: string): { label: string; unit?: string } => {
    const map: Record<string, { label: string; unit?: string }> = {
      "security.max_failed_login_attempts": { label: ar ? "الحد الأقصى لمحاولات الدخول" : "Max failed login attempts" },
      "security.lockout_duration_minutes": { label: ar ? "مدة قفل الحساب" : "Lockout duration", unit: ar ? "دقيقة" : "min" },
      "security.password_min_length": { label: ar ? "الحد الأدنى لطول كلمة المرور" : "Min password length", unit: ar ? "حرف" : "chars" },
      "security.password_expiry_days": { label: ar ? "انتهاء صلاحية كلمة المرور" : "Password expiry", unit: ar ? "يوم" : "days" },
      "security.password_reuse_count": { label: ar ? "منع إعادة استخدام كلمات المرور" : "Reuse prevention (last N)" },
      "security.require_2fa": { label: ar ? "فرض التحقق الثنائي" : "Require 2FA" },
      "security.session_access_token_hours": { label: ar ? "صلاحية رمز الوصول" : "Access token TTL", unit: ar ? "ساعة" : "h" },
      "security.session_refresh_token_days": { label: ar ? "صلاحية رمز التحديث" : "Refresh token TTL", unit: ar ? "يوم" : "days" },
    }
    return map[key] ?? { label: key }
  }

  const isLocked = account?.locked_until ? new Date(account.locked_until) > new Date() : false

  return (
    <div className="px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.settings.securitySettings}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ar ? "حالة حسابك وسياسات الأمان الخاصة بالمنشأة" : "Your account status and organization security policies"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Account status */}
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elite-blue-600/10">
                <Shield className="h-5 w-5 text-elite-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">{ar ? "حالة حسابي" : "My account"}</CardTitle>
                <CardDescription className="text-xs">
                  {account?.full_name_ar ?? account?.full_name_en ?? account?.email}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-border/50 px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-elite-blue-600" />
                {ar ? "التحقق الثنائي (2FA)" : "Two-factor auth"}
              </span>
              {account?.two_factor_enabled ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20">{ar ? "مفعل" : "Enabled"}</Badge>
              ) : (
                <Badge className="bg-gray-500/15 text-gray-600 border-gray-500/20">{ar ? "غير مفعل" : "Not enabled"}</Badge>
              )}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/50 px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <KeyRound className="h-4 w-4 text-elite-blue-600" />
                {ar ? "تغيير كلمة المرور" : "Change password"}
              </span>
              {account?.must_change_password ? (
                <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/20">{ar ? "مطلوب" : "Required"}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {fmtDate(account?.password_changed_at ?? null)}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/50 px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 text-elite-blue-600" />
                {ar ? "آخر تسجيل دخول" : "Last login"}
              </span>
              <span dir="ltr" className="text-xs text-muted-foreground">
                {fmtDate(account?.last_login_at ?? null)}
              </span>
            </div>
            {isLocked && (
              <div className="flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-600">
                <Lock className="h-4 w-4 shrink-0" />
                {ar ? "الحساب مقفل مؤقتاً" : "Account temporarily locked"}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Policy values */}
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elite-blue-600/10">
                <KeyRound className="h-5 w-5 text-elite-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">{ar ? "سياسات الأمان" : "Security policies"}</CardTitle>
                <CardDescription className="text-xs">
                  {ar ? "قيم مطبقة على مستوى المنشأة" : "Values enforced at the organization level"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {policies.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {ar ? "لا توجد سياسات أمان مسجلة." : "No security policies recorded."}
              </div>
            )}
            {policies.map((p) => {
              const meta = policyLabel(p.key)
              const isFlag = p.value === "true" || p.value === "false"
              return (
                <div key={p.key} className="flex items-center justify-between rounded-xl border border-border/50 px-3.5 py-2.5">
                  <span className="text-sm text-muted-foreground">{meta.label}</span>
                  {isFlag ? (
                    <Badge className={
                      p.value === "true"
                        ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20"
                        : "bg-gray-500/15 text-gray-600 border-gray-500/20"
                    }>
                      {p.value === "true" ? (ar ? "مفعل" : "Enabled") : ar ? "معطل" : "Disabled"}
                    </Badge>
                  ) : (
                    <span dir="ltr" className="text-sm font-medium tabular-nums">
                      {p.value}
                      {meta.unit ? <span className="text-xs text-muted-foreground ms-1">{meta.unit}</span> : null}
                    </span>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {error && (
        <p className="text-xs text-red-500">
          {ar ? "تعذر تحميل بعض السياسات." : "Some policies failed to load."}
        </p>
      )}
    </div>
  )
}
