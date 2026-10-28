"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Lock, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react"
import { LogoMark } from "@/components/logo"
import { useTranslation } from "@/hooks/use-translation"
import { createClient } from "@/lib/supabase/client"
import { DASHBOARD_PATH, withLocale } from "@/lib/redirects"
import { changeOwnPassword, requestPasswordReauthentication } from "@/lib/auth/change-password"
import { isValidNewPassword, newPasswordHint, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@/lib/auth/password-policy"

type FormError = { en: string; ar: string }
const genericError: FormError = { en: "Unable to complete this request. Try again.", ar: "تعذر إكمال الطلب. حاول مجدداً." }

export function PasswordForm({ mode = "recovery" }: { mode?: "recovery" | "required" | "account" }) {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<FormError | null>(null)
  const [done, setDone] = useState(false)
  const [requiresMfa, setRequiresMfa] = useState(false)
  const [requiresReauthentication, setRequiresReauthentication] = useState(false)
  const [nonce, setNonce] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [reviewAccess, setReviewAccess] = useState(false)
  const isAr = locale === "ar"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || done) return
    setReviewAccess(false)
    if (password !== confirm) {
      setMismatch(true)
      setError({ en: "Passwords do not match.", ar: "كلمتا المرور غير متطابقتين." })
      return
    }
    setMismatch(false)
    if (!isValidNewPassword(password)) { setError({ en: newPasswordHint("en"), ar: newPasswordHint("ar") }); return }
    setError(null)
    setReviewAccess(false)
    setLoading(true)
    try {
      const supabase = createClient()
      // The recovery link from resetPasswordForEmail redirects here with a
      // `code` query param; exchange it for a session, then set the new
      // password. If no session exists (direct visit), updateUser rejects.
      const code = new URLSearchParams(window.location.search).get("code")
      if (mode === "recovery" && code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) { setError({ en: "Recovery link is unavailable. Request a new link.", ar: "تعذر استخدام رابط الاستعادة. اطلب رابطاً جديداً." }); return }
        const url = new URL(window.location.href)
        url.searchParams.delete("code")
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
      }
      const result = await changeOwnPassword({ password, ...(nonce ? { nonce } : {}) })
      if (!result.success) {
        setError({ en: result.error ?? genericError.en, ar: result.errorAr ?? genericError.ar })
        setRequiresMfa(result.requiresMfa === true)
        setReviewAccess(result.reviewAccess === true)
        setRequiresReauthentication(result.requiresReauthentication === true)
        return
      }
      setDone(true)
      setPassword(""); setConfirm(""); setNonce("")
    } catch {
      setReviewAccess(true)
      setError({ en: "Unable to confirm the change. Check account access. If another change is required, choose a different new password.", ar: "تعذر تأكيد التغيير. راجع الوصول إلى حسابك. إذا طُلب تغيير آخر، اختر كلمة جديدة مختلفة." })
    } finally {
      setLoading(false)
    }
  }

  async function sendCode() {
    if (loading || done) return
    setLoading(true); setError(null); setCodeSent(false)
    try {
      const result = await requestPasswordReauthentication()
      if (result.success) setCodeSent(true)
      else { setError({ en: result.error ?? genericError.en, ar: result.errorAr ?? genericError.ar }); setRequiresMfa(result.requiresMfa === true) }
    } catch { setError(genericError) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="stagger-1 flex justify-center">
        <LogoMark size={56} showIndicator />
      </div>

      <div className="rounded-2xl border border-border/50 shadow-modern-lg bg-card dark:bg-card/60 p-6 md:p-8">
        <div className="stagger-2 flex flex-col gap-1.5 text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{mode === "recovery" ? t.pages.resetPassword : t.pages.changePassword}</h1>
          <p className="text-sm text-muted-foreground">{mode === "required"
            ? isAr ? "يجب تغيير كلمة المرور قبل متابعة استخدام حسابك." : "Change your password before continuing to your account."
            : t.auth.resetPasswordSubtitle}</p>
        </div>

        <form onSubmit={onSubmit} className="stagger-3 grid gap-4">
          {error && (
            <div id="password-form-error" role="alert" className="flex items-center gap-2 rounded-lg border border-red-700/30 bg-red-700/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              <AlertCircle className="size-4 shrink-0" />
              <span>{isAr ? error.ar : error.en}</span>
            </div>
          )}
          {done && (
            <div role="status" className="rounded-lg border border-emerald-700/30 bg-emerald-700/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
              {t.auth.passwordUpdated}
            </div>
          )}
          {!done && <>
          <div className="grid gap-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t.auth.newPassword}
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                disabled={loading || done}
                aria-describedby="password-policy"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.auth.passwordPlaceholder}
                className="flex h-11 w-full rounded-md border border-input bg-transparent ps-10 pe-10 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p id="password-policy" className="text-sm text-muted-foreground">{newPasswordHint(locale)}</p>
          </div>

          <div className="grid gap-2">
            <label htmlFor="confirm" className="text-sm font-medium">
              {t.auth.confirmPassword}
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="confirm"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                disabled={loading || done}
                autoComplete="new-password"
                aria-invalid={mismatch || undefined}
                aria-describedby={mismatch ? "password-form-error" : undefined}
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value)
                  if (mismatch) setError(null)
                  setMismatch(false)
                }}
                placeholder={t.auth.passwordPlaceholder}
                className={`flex h-11 w-full rounded-md border bg-transparent ps-10 pe-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 placeholder:text-muted-foreground ${
                  mismatch
                    ? "border-destructive focus-visible:ring-destructive"
                    : "border-input focus-visible:ring-ring"
                }`}
              />
            </div>
          </div>

          {requiresMfa && <Link href={withLocale("/auth/mfa-challenge?returnTo=%2Fauth%2Fchange-password", locale)} className="text-sm font-medium underline underline-offset-4">
            {isAr ? "إكمال التحقق بتطبيق المصادقة" : "Verify with your authenticator"}
          </Link>}
          {reviewAccess && <Link href={withLocale(DASHBOARD_PATH, locale)} className="text-sm font-medium underline underline-offset-4">{isAr ? "مراجعة الوصول إلى حسابي" : "Check account access"}</Link>}
          {requiresReauthentication && <div className="grid gap-2">
            <button type="button" onClick={() => void sendCode()} disabled={loading || done} className="text-start text-sm font-medium underline underline-offset-4 disabled:opacity-50">{isAr ? "إرسال رمز التحقق" : "Send verification code"}</button>
            {codeSent && <p role="status" className="text-sm">{isAr ? "تم إرسال رمز التحقق إلى بريدك." : "Verification code sent to your email."}</p>}
            <label htmlFor="password-nonce" className="text-sm font-medium">{isAr ? "رمز التحقق من البريد" : "Email verification code"}</label>
            <input id="password-nonce" value={nonce} onChange={e => setNonce(e.target.value)} maxLength={128} autoComplete="one-time-code" inputMode="numeric" disabled={loading || done} className="h-11 rounded-md border border-input bg-transparent px-3 text-sm" />
          </div>}
          <button
            type="submit"
            disabled={loading || done}
            className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-elite-blue-500 hover:bg-elite-blue-600 text-base font-semibold text-white shadow-elite-blue-500/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 cursor-pointer"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {t.auth.setPasswordButton}
          </button>
          </>}
          {done && <button type="button" onClick={() => router.replace(withLocale(DASHBOARD_PATH, locale))} className="h-11 rounded-xl bg-primary px-4 font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {isAr ? "متابعة إلى حسابي" : "Continue to my account"}
          </button>}
        </form>
      </div>

      <div className="stagger-4 text-center text-sm">
        {mode === "recovery" ? <Link href="/auth/sign-in" className="font-medium text-primary underline underline-offset-4">{t.auth.backToSignIn}</Link>
          : <a href="/auth/sign-out" className="font-medium text-primary underline underline-offset-4">{isAr ? "تسجيل الخروج واستخدام حساب آخر" : "Sign out and use another account"}</a>}
      </div>
    </div>
  )
}
