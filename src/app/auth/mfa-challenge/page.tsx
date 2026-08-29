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

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { ShieldCheck, AlertTriangle, LogOut } from "lucide-react"

export default function MfaChallengePage() {
  const router = useRouter()
  const { locale } = useTranslation()
  const ar = locale === "ar"

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
        router.replace("/dashboard")
        return
      }

      const { data: factors } = await supabase.auth.mfa.listFactors()
      const verified = factors?.totp?.find((f) => f.status === "verified")
      if (!verified) {
        router.replace("/dashboard")
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

    router.replace("/dashboard")
    router.refresh()
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace("/auth/sign-in")
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSpinner className="h-6 w-6 text-elite-blue-600" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md rounded-2xl border border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elite-blue-600/10">
              <ShieldCheck className="h-5 w-5 text-elite-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">
                {ar ? "التحقق الثنائي مطلوب" : "Two-factor verification required"}
              </CardTitle>
              <CardDescription className="text-xs">
                {ar
                  ? "أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة لإكمال تسجيل الدخول"
                  : "Enter the 6-digit code from your authenticator app to finish signing in"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {ar ? "رمز التحقق" : "Verification code"}
            </label>
            <div className="flex gap-2">
              <Input
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
                className="flex-1 rounded-xl text-center font-mono text-lg tracking-[0.3em]"
                dir="ltr"
              />
              <Button
                onClick={() => void handleVerify()}
                disabled={verifying || code.length !== 6}
                className="rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white"
              >
                {verifying ? <LoadingSpinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Button
            onClick={() => void handleSignOut()}
            variant="ghost"
            size="sm"
            className="w-full rounded-xl text-muted-foreground"
          >
            <LogOut className="mr-1.5 h-4 w-4 rtl:ml-1.5 rtl:mr-0" />
            {ar ? "تسجيل الخروج والعودة" : "Sign out and go back"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
