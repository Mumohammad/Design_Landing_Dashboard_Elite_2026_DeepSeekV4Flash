"use client"

// MFA Settings Page — TOTP enrollment, verification, and management.
//
// For admin/owner roles, MFA is mandatory and cannot be disabled.
// For other roles, MFA is optional.
//
// The QR code is the SVG returned by our own Supabase Auth server inside the
// enroll response and is rendered locally. The TOTP URI/secret is NEVER sent
// to third-party QR services (the previous api.qrserver.com usage leaked it).

import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import {
  Shield, ShieldCheck, ShieldOff, QrCode, KeyRound,
  CheckCircle2, AlertTriangle, Smartphone
} from "lucide-react"
import {
  enrollMfa, verifyMfaCode, unenrollMfa, listMfaFactors,
  isMfaRequired
} from "@/lib/auth/mfa"

type MfaFactor = {
  id: string
  type: string
  friendly_name?: string
  status: string
}

export default function MfaSettingsPage() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [factors, setFactors] = useState<MfaFactor[]>([])
  const [mfaRequired, setMfaRequired] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [enrollFactorId, setEnrollFactorId] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadFactors = useCallback(async () => {
    try {
      const [factorsResult, requiredResult] = await Promise.all([
        listMfaFactors(),
        isMfaRequired(),
      ])
      if (factorsResult.success && factorsResult.factors) {
        setFactors(factorsResult.factors)
      }
      setMfaRequired(requiredResult)
    } catch {
      setError(ar ? "تعذر تحميل بيانات MFA" : "Failed to load MFA data")
    }
    setIsLoading(false)
  }, [ar])

  // Initial load on mount. Two fixes live here:
  //  1. The original effect referenced loadFactors without invoking it, so the
  //     page stayed on the spinner forever.
  //  2. react-hooks/set-state-in-effect forbids calling a state-setting
  //     function synchronously in the effect body — so the fetch runs in
  //     .then/.catch callbacks (allowed) with an `active` unmount guard.
  useEffect(() => {
    let active = true
    Promise.all([listMfaFactors(), isMfaRequired()])
      .then(([factorsResult, requiredResult]) => {
        if (!active) return
        if (factorsResult.success && factorsResult.factors) {
          setFactors(factorsResult.factors)
        }
        setMfaRequired(requiredResult)
        setIsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError(ar ? "تعذر تحميل بيانات MFA" : "Failed to load MFA data")
        setIsLoading(false)
      })
    return () => { active = false }
  }, [ar])

  const isEnabled = factors.some((f) => f.status === "verified")

  async function handleEnroll() {
    setEnrolling(true)
    setError(null)
    setSuccess(null)

    const result = await enrollMfa()

    if (result.success && result.qrCode) {
      setQrSvg(result.qrCode)
      setSecret(result.secret ?? null)
      setEnrollFactorId(result.factorId ?? null)
    } else {
      setError(result.error ?? "Enrollment failed")
    }
    setEnrolling(false)
  }

  async function handleVerify() {
    if (!enrollFactorId || verifyCode.length !== 6) return

    setVerifying(true)
    setError(null)

    const result = await verifyMfaCode(enrollFactorId, verifyCode)

    if (result.success) {
      setSuccess(ar ? "تم تفعيل التحقق الثنائي بنجاح" : "Two-factor authentication enabled successfully")
      setQrSvg(null)
      setSecret(null)
      setEnrollFactorId(null)
      setVerifyCode("")
      await loadFactors()
    } else {
      setError(result.error ?? "Verification failed")
    }
    setVerifying(false)
  }

  async function handleUnenroll(factorId: string) {
    if (!confirm(ar ? "هل أنت متأكد من تعطيل التحقق الثنائي؟" : "Are you sure you want to disable two-factor authentication?")) {
      return
    }

    setError(null)
    const result = await unenrollMfa(factorId)

    if (result.success) {
      setSuccess(ar ? "تم تعطيل التحقق الثنائي" : "Two-factor authentication disabled")
      await loadFactors()
    } else {
      setError(result.error ?? "Unenrollment failed")
    }
  }

  if (isLoading) {
    return (
      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner className="h-6 w-6 text-elite-blue-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {ar ? "التحقق الثنائي (MFA)" : "Two-Factor Authentication"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {mfaRequired
            ? (ar ? "مطلوب لحسابات المدير العام والمدير" : "Required for admin and manager accounts")
            : (ar ? "أضف طبقة حماية إضافية لحسابك" : "Add an extra layer of security to your account")}
        </p>
      </div>

      {/* Status Card */}
      <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
              isEnabled ? "bg-emerald-500/10" : "bg-amber-500/10"
            }`}>
              {isEnabled ? (
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              ) : (
                <Shield className="h-5 w-5 text-amber-600" />
              )}
            </div>
            <div>
              <CardTitle className="text-base">
                {ar ? "حالة التحقق الثنائي" : "MFA Status"}
              </CardTitle>
              <CardDescription className="text-xs">
                {isEnabled
                  ? (ar ? "التحقق الثنائي مفعل لحسابك" : "Two-factor authentication is enabled for your account")
                  : (ar ? "التحقق الثنائي غير مفعل" : "Two-factor authentication is not enabled")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Badge */}
          <div className="flex items-center justify-between rounded-xl border border-border/50 px-3.5 py-2.5">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Smartphone className="h-4 w-4 text-elite-blue-600" />
              {ar ? "تطبيق المصادقة" : "Authenticator app"}
            </span>
            {isEnabled ? (
              <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20">
                {ar ? "مفعل" : "Enabled"}
              </Badge>
            ) : (
              <Badge className="bg-gray-500/15 text-gray-600 border-gray-500/20">
                {ar ? "غير مفعل" : "Not enabled"}
              </Badge>
            )}
          </div>

          {/* Enroll Button */}
          {!isEnabled && !qrSvg && (
            <Button
              onClick={handleEnroll}
              disabled={enrolling}
              className="w-full rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/25"
            >
              {enrolling ? (
                <LoadingSpinner className="h-4 w-4 mr-2" />
              ) : (
                <QrCode className="h-4 w-4 mr-2" />
              )}
              {ar ? "تفعيل التحقق الثنائي" : "Enable two-factor authentication"}
            </Button>
          )}

          {/* Unenroll Button */}
          {isEnabled && !mfaRequired && (
            <Button
              onClick={() => {
                const verifiedFactor = factors.find((f) => f.status === "verified")
                if (verifiedFactor) handleUnenroll(verifiedFactor.id)
              }}
              variant="outline"
              className="w-full rounded-xl border-red-500/30 text-red-600 hover:bg-red-500/10"
            >
              <ShieldOff className="h-4 w-4 mr-2" />
              {ar ? "تعطيل التحقق الثنائي" : "Disable two-factor authentication"}
            </Button>
          )}

          {mfaRequired && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {ar
                ? "التحقق الثنائي مطلوب لدورك ولا يمكن تعطيله"
                : "Two-factor authentication is required for your role and cannot be disabled"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enrollment QR Code */}
      {qrSvg && (
        <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elite-blue-600/10">
                <QrCode className="h-5 w-5 text-elite-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">
                  {ar ? "امسح رمز QR" : "Scan QR Code"}
                </CardTitle>
                <CardDescription className="text-xs">
                  {ar
                    ? "افتح تطبيق المصادقة وامسح الرمز"
                    : "Open your authenticator app and scan this code"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* QR Code — SVG from our own auth server, rendered locally */}
            <div className="flex justify-center">
              <div className="rounded-xl border border-border/50 bg-white p-4" dir="ltr">
                <div
                  className="h-[200px] w-[200px] [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              </div>
            </div>

            {/* Manual Entry Secret */}
            {secret && (
              <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {ar ? "المعرف اليدوي" : "Manual entry key"}
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-foreground break-all" dir="ltr">
                  {secret}
                </p>
              </div>
            )}

            {/* Verification Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {ar ? "أدخل الرمز من تطبيق المصادقة" : "Enter the code from your authenticator app"}
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                  className="flex-1 rounded-xl font-mono text-center text-lg tracking-[0.3em]"
                  dir="ltr"
                />
                <Button
                  onClick={handleVerify}
                  disabled={verifying || verifyCode.length !== 6}
                  className="rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white"
                >
                  {verifying ? (
                    <LoadingSpinner className="h-4 w-4" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <Button
              onClick={() => {
                setQrSvg(null)
                setSecret(null)
                setEnrollFactorId(null)
                setVerifyCode("")
              }}
              variant="ghost"
              size="sm"
              className="rounded-xl"
            >
              {ar ? "إلغاء" : "Cancel"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Messages */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600" role="alert">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}
    </div>
  )
}
