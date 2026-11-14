"use client"

import { useState } from "react"
import Link from "next/link"
import { Mail, MailCheck, Loader2, AlertCircle } from "lucide-react"
import { LogoMark } from "@/components/logo"
import { useTranslation } from "@/hooks/use-translation"
import { REDIRECTS } from "@/lib/redirects"

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // Send through the server route: it applies the shared per-IP rate
      // limit (3/hour, fail-closed) server-side — a direct browser
      // resetPasswordForEmail call bypasses the limiter entirely (audit H2).
      // The link always completes on the DASHBOARD deployment (where the
      // fresh session cookie is written) via /auth/confirm?type=recovery →
      // /auth/reset-password. (Supabase only accepts redirectTo values
      // registered in its Redirect URLs allow-list.)
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          code?: string
        } | null
        setError(
          payload?.code === "AUTH_RATE_LIMITED"
            ? t.auth.tooManyAttempts
            : payload?.code === "RATE_LIMIT_UNAVAILABLE"
              ? t.auth.serviceUnavailable
              : t.auth.genericError
        )
        return
      }
      setSent(true)
    } catch {
      setError(t.auth.genericError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <LogoMark size={56} showIndicator />
      </div>

      <div className="rounded-lg border border-border bg-card shadow-none p-6 md:p-8">
        <div className="flex flex-col gap-2 text-start mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{t.pages.forgotPassword}</h1>
          <p className="text-sm text-muted-foreground">{t.auth.forgotPasswordSubtitle}</p>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 text-center py-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="size-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">{t.auth.resetLinkSent}</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="grid gap-2">
              <label htmlFor="email" className="text-sm font-medium">
                {t.auth.email}
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.auth.emailPlaceholder}
                  className="flex h-11 w-full rounded-md border border-input bg-background ps-10 pe-3 py-2 text-sm shadow-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-foreground hover:bg-foreground/90 text-base font-medium text-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 cursor-pointer"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {t.auth.sendResetLink}
            </button>
          </form>
        )}
      </div>

      <div className="text-center text-sm">
        <Link
          href={REDIRECTS.signInUrl}
          className="font-medium text-foreground underline underline-offset-4 hover:opacity-80 transition"
        >
          {t.auth.backToSignIn}
        </Link>
      </div>
    </div>
  )
}
