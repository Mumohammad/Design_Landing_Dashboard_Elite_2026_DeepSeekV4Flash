// NOTE: Uses CSS keyframe stagger (stagger-1..5) as fallback for framer-motion.
// When framer-motion is installed, replace with <motion.div> + containerVariants/itemVariants per Design DNA.
"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { createClient } from "@/lib/supabase/client"
import { DASHBOARD_PATH, safeReturnPath, withLocale } from "@/lib/redirects"
import { Eye, EyeOff, Lock, Mail, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { useTranslation } from "@/hooks/use-translation"

const loginFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

type LoginFormValues = z.infer<typeof loginFormSchema>

function subscribeToSearch(onChange: () => void) {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

function getSearchSnapshot() {
  return window.location.search
}

function getServerSearchSnapshot() {
  return ""
}

export function LoginForm1({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [submissionError, setErrorMessage] = useState<string | null | undefined>(undefined)
  const search = useSyncExternalStore(subscribeToSearch, getSearchSnapshot, getServerSearchSnapshot)
  const params = new URLSearchParams(search)
  // ?registered=1 → the user just finished company registration (step 2→4 of
  // the product flow) — show a success banner above the form.
  const registered = params.get("registered") === "1"
  // Translate middleware notices during render so changing locale keeps the
  // current notice without overwriting a later sign-in response.
  const code = params.get("error")
  const redirectError = code === "AUTH_ACCOUNT_LOCKED" ? t.auth.accountLocked
    : code === "AUTH_ACCOUNT_INACTIVE" ? t.auth.accountInactive
      : code === "AUTH_PROFILE_NOT_FOUND" ? t.auth.profileNotFound : null
  const errorMessage = submissionError === undefined ? redirectError : submissionError

  // Already signed in (session cookie lives on this deployment)? Go straight
  // to the dashboard instead of showing a redundant login form (req. E).
  // Skipped when the URL carries an auth-error marker (the session may be
  // half-state — let the user see the message and act).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error")) return
    let cancelled = false
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user && !cancelled) {
        router.replace(withLocale(safeReturnPath(new URLSearchParams(window.location.search).get("returnTo") ?? DASHBOARD_PATH), locale))
        router.refresh()
      }
    })
    return () => { cancelled = true }
  }, [locale, router])

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  async function onSubmit(values: LoginFormValues) {
    setErrorMessage(null)
    setIsLoading(true)
    try {
      // Sign in through the server route: it applies the shared per-IP rate
      // limit (fail-closed), establishes the SSR session server-side, and
      // writes the sb-* auth cookies onto its response — a direct browser
      // signInWithPassword call would bypass the limiter entirely (audit H2).
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email.trim(), password: values.password }),
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          code?: string
        } | null
        setErrorMessage(
          payload?.code === "AUTH_RATE_LIMITED"
            ? t.auth.tooManyAttempts
            : payload?.code === "RATE_LIMIT_UNAVAILABLE"
              ? t.auth.serviceUnavailable
              : t.auth.invalidCredentials
        )
        return
      }

      // Signed in — the route response carried the fresh session cookies.
      // Honor the ?returnTo= param (open-redirect guarded); the default is
      // the centralized dashboard destination (absolute when this code runs
      // under the two-deployment production topology).
      const returnTo = new URLSearchParams(window.location.search).get("returnTo")
      const safeReturnTo = withLocale(safeReturnPath(returnTo ?? DASHBOARD_PATH), locale)
      // A full same-origin navigation reads the cookies just set by the API
      // and avoids any unauthenticated prefetched router response.
      window.location.replace(safeReturnTo)
    } catch {
      // Network / unexpected failure — show the generic error.
      setErrorMessage(t.auth.invalidCredentials)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="stagger-2 border-border/50 shadow-modern-lg backdrop-blur-sm bg-card/80 dark:bg-card/60 rounded-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-semibold">
            {t.auth.welcomeBack}
          </CardTitle>
          <CardDescription>
            {t.auth.signInSubtitle}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid gap-6">
                <div className="grid gap-4">
                  {/* Email field */}
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem className="stagger-3">
                        <FormLabel>{t.auth.email}</FormLabel>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <FormControl>
                            <Input
                              type="email"
                              placeholder={t.auth.emailPlaceholder}
                              className="h-11 pl-10"
                              disabled={isLoading}
                              {...field}
                            />
                            </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {/* Password field */}
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem className="stagger-4">
                        <div className="flex items-center justify-between">
                          <FormLabel>{t.auth.password}</FormLabel>
                          <a
                            href="/auth/forgot-password"
                            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
                          >
                            {t.auth.forgotPassword}
                          </a>
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <FormControl>
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder={t.auth.passwordPlaceholder}
                              className="h-11 pl-10 pr-10"
                              disabled={isLoading}
                              {...field}
                            />
                            </FormControl>
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                              tabIndex={-1}
                              aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                            >
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {/* Remember me */}
                  <div className="flex items-center gap-2">
                    <Checkbox id="remember" disabled={isLoading} />
                    <label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer">
                      {t.auth.rememberMe}
                    </label>
                  </div>
                  {/* Post-registration success banner (step 2 → 4 of the flow) */}
                  {registered && !errorMessage && (
                    <div
                      role="status"
                      className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-sm"
                    >
                      <p className="font-semibold text-emerald-600">{t.auth.registrationSuccessTitle}</p>
                      <p className="mt-0.5 text-xs text-emerald-600/80">{t.auth.registrationSuccessBody}</p>
                    </div>
                  )}
                  {/* Error message */}
                  {errorMessage && (
                    <div
                      role="alert"
                      className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive"
                    >
                      {errorMessage}
                    </div>
                  )}
                  {/* Submit button — elite-blue gradient CTA */}
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="stagger-5 w-full h-11 text-base font-semibold bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 hover:from-elite-blue-600 hover:to-elite-blue-700 text-white shadow-lg shadow-elite-blue-500/20 rounded-xl transition-all"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t.auth.signingIn}
                      </>
                    ) : (
                      t.auth.signInButton
                    )}
                  </Button>
                </div>
                {/* Terms */}
                <div className="text-center text-xs text-muted-foreground">
                  {t.auth.termsPrivacy}
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
