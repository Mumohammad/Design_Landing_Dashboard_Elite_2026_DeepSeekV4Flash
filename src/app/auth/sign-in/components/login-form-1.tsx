// NOTE: Uses CSS keyframe stagger (stagger-1..5) as fallback for framer-motion.
// When framer-motion is installed, replace with <motion.div> + containerVariants/itemVariants per Design DNA.
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { createClient } from "@/lib/supabase/client"
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

export function LoginForm1({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { t } = useTranslation()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Surface auth-flow redirect params set by the middleware (locked/inactive).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get("error")
    if (code === "AUTH_ACCOUNT_LOCKED") {
      setErrorMessage(t.auth.accountLocked)
    } else if (code === "AUTH_ACCOUNT_INACTIVE") {
      setErrorMessage(t.auth.accountInactive)
    } else if (code === "AUTH_PROFILE_NOT_FOUND") {
      setErrorMessage(t.auth.profileNotFound)
    }
  }, [t])

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
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      })

      if (error) {
        // Map known Supabase auth error codes to friendly bilingual messages.
        setErrorMessage(
          error.code === "email_not_confirmed"
            ? t.auth.emailNotConfirmed
            : t.auth.invalidCredentials
        )
        return
      }

      // Signed in — the SSR client has persisted the session cookie.
      // Honor the middleware's ?returnTo= param (open-redirect guarded).
      const returnTo = new URLSearchParams(window.location.search).get("returnTo")
      const safeReturnTo =
        returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
          ? returnTo
          : "/dashboard"
      router.push(safeReturnTo)
      router.refresh()
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
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="email"
                              placeholder={t.auth.emailPlaceholder}
                              className="h-11 pl-10"
                              disabled={isLoading}
                              {...field}
                            />
                          </div>
                        </FormControl>
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
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder={t.auth.passwordPlaceholder}
                              className="h-11 pl-10 pr-10"
                              disabled={isLoading}
                              {...field}
                            />
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
                        </FormControl>
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
