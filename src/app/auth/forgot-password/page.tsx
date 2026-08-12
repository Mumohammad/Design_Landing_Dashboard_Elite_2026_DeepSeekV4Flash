"use client"

import { useState } from "react"
import Link from "next/link"
import { Mail, MailCheck, Loader2 } from "lucide-react"
import { LogoMark } from "@/components/logo"
import { useTranslation } from "@/hooks/use-translation"

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    // TODO: Phase 2 — wire to Supabase Auth resetPasswordForEmail
    setLoading(true)
    await new Promise((r) => setTimeout(r, 600))
    setLoading(false)
    setSent(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="stagger-1 flex justify-center">
        <LogoMark size={56} showIndicator />
      </div>

      <div className="rounded-2xl border border-border/50 shadow-modern-lg backdrop-blur-sm bg-card/80 dark:bg-card/60 p-6 md:p-8">
        <div className="stagger-2 flex flex-col gap-1.5 text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t.pages.forgotPassword}</h1>
          <p className="text-sm text-muted-foreground">{t.auth.forgotPasswordSubtitle}</p>
        </div>

        {sent ? (
          <div className="stagger-3 flex flex-col items-center gap-3 text-center py-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="size-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">{t.auth.resetLinkSent}</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="stagger-3 grid gap-4">
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
                  className="flex h-11 w-full rounded-md border border-input bg-transparent ps-10 pe-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 hover:from-elite-blue-600 hover:to-elite-blue-700 text-base font-semibold text-white shadow-lg shadow-elite-blue-500/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 cursor-pointer"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {t.auth.sendResetLink}
            </button>
          </form>
        )}
      </div>

      <div className="stagger-4 text-center text-sm">
        <Link
          href="/auth/sign-in"
          className="font-medium text-primary underline underline-offset-4 hover:opacity-80 transition"
        >
          {t.auth.backToSignIn}
        </Link>
      </div>
    </div>
  )
}
