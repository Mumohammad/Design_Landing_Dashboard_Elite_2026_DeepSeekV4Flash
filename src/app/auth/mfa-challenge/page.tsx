"use client"

// MFA Challenge Page — AAL2 step-up after password sign-in.
//
// Flow: if the user has a verified TOTP factor, Supabase marks the password-only
// session as aal1 with nextLevel=aal2. This page runs challenge → verify via the
// official SDK to raise the session to aal2, then redirects to the dashboard.
// Users without a verified factor (or already at aal2) pass straight through.
//
// Enforcement note: src/proxy.ts should redirect aal1 sessions that have a
// verified factor (or a privileged role) to this page — see PR #1 / FIX-04.

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { REDIRECTS, DASHBOARD_PATH, safeReturnPath } from "@/lib/redirects"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { ShieldCheck, AlertTriangle, LogOut } from "lucide-react"

function MfaChallengeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { locale } = useTranslation()
  const ar = locale === "ar"
  // The dashboard destination (absolute under the two-deployment topology).
  // useSearchParams() is SSR/prerender-safe (window is not available on the server).
  const dashboardUrl = safeReturnPath(
    searchParams.get("returnTo") ?? DASHBOARD_PATH
  )

  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function boot() {
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace("/auth/sign-in")
        return
      }

      const { data: aal, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

      // Already elevated, or no verified factor → nothing to challenge.
      if (aalError || !aal || aal.currentLevel === "aal2" || aal.nextLevel !== "aal2") {
        router.replace(dashboardUrl)
        return
      }

      const { data: factors } = await supabase.auth.mfa.listFactors()
      const verified = factors?.totp?.find((f) => f.status === "verified")
      if (!verified) {
        router.replace(dashboardUrl)
        return
      }

      if (active) {
        setFactorId(verified.id)
        setIsLoading(false)
      }
    }

    void boot()
    return () => { active = false }
  }, [router])

  async function handleVerify() {
    if (!factorId || code.length !== 6) return

    setVerifying(true)
    setError(null)
    const supabase = createClient()

    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId })

    if (challengeError || !challenge) {
      setError(ar ? "تعذر بدء التحقق — حاول مجدداً" : "Could not start verification — try again")
      setVerifying(false)
      return
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    })

    if (verifyError) {
      setError(ar ? "الرمز غير صحيح أو منتهي — أعد المحاولة" : "Invalid or expired code — try again")
      setCode("")
      setVerifying(false)
      return
    }

    router.replace(dashboardUrl)
    router.refresh()
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    // Full-page nav to the centralized sign-out route → clears cookies and
    // lands on the public landing page.
    window.location.href = REDIRECTS.signOutUrl
  }

  if (isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <LoadingSpinner className="h-6 w-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="w-full">
      <Card className="w-full rounded-lg border border-border bg-card shadow-none">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-xl leading-snug"><h1>
                {ar ? "التحقق الثنائي مطلوب" : "Two-factor verification required"}</h1>
              </CardTitle>
              <CardDescription className="mt-2 text-sm leading-6">
                {ar
                  ? "أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة لإكمال تسجيل الدخول"
                  : "Enter the 6-digit code from your authenticator app to finish signing in"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="mfa-code" className="text-sm font-medium text-foreground">
              {ar ? "رمز التحقق" : "Verification code"}
            </label>
            <div className="flex gap-2">
              <Input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") void handleVerify() }}
                className="h-11 flex-1 rounded-md text-center font-mono text-lg tracking-[0.3em]"
                dir="ltr"
              />
              <Button
                onClick={() => void handleVerify()}
                disabled={verifying || code.length !== 6}
                aria-label={ar ? "تأكيد رمز التحقق" : "Verify code"}
                className="h-11 rounded-md bg-foreground text-background hover:bg-foreground/90"
              >
                {verifying ? <LoadingSpinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Button
            onClick={() => void handleSignOut()}
            variant="ghost"
            size="sm"
            className="w-full rounded-md text-muted-foreground"
          >
            <LogOut className="mr-1.5 h-4 w-4 rtl:ml-1.5 rtl:mr-0" />
            {ar ? "تسجيل الخروج والعودة" : "Sign out and go back"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default function MfaChallengePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-40 items-center justify-center">
          <LoadingSpinner className="h-6 w-6 text-muted-foreground" />
        </div>
      }
    >
      <MfaChallengeContent />
    </Suspense>
  )
}
