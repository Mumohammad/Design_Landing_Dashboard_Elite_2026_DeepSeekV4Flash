"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { User, Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react"
import { LogoMark } from "@/components/logo"
import { useTranslation } from "@/hooks/use-translation"

export default function AcceptInvitePage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    // TODO: Phase 2 — wire to Supabase Auth signUp or admin invite acceptance
    setLoading(true)
    await new Promise((r) => setTimeout(r, 600))
    setLoading(false)
    router.push("/auth/sign-in")
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="stagger-1 flex justify-center">
        <LogoMark size={56} showIndicator />
      </div>

      <div className="rounded-2xl border border-border/50 shadow-modern-lg backdrop-blur-sm bg-card/80 dark:bg-card/60 p-6 md:p-8">
        <div className="stagger-2 flex flex-col gap-1.5 text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t.pages.acceptInvite}</h1>
          <p className="text-sm text-muted-foreground">{t.auth.acceptInviteSubtitle}</p>
        </div>

        <form onSubmit={onSubmit} className="stagger-3 grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="fullName" className="text-sm font-medium">
              {t.auth.fullName}
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="fullName"
                type="text"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="flex h-11 w-full rounded-md border border-input bg-transparent ps-10 pe-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
              />
            </div>
          </div>

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
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value)
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

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 hover:from-elite-blue-600 hover:to-elite-blue-700 text-base font-semibold text-white shadow-lg shadow-elite-blue-500/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 cursor-pointer"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {t.auth.acceptInviteButton}
          </button>
        </form>
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
