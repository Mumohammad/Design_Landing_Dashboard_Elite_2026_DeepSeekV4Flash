"use client"

import { ArrowRight, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDriverRegistration } from "@/contexts/driver-registration-context"
import { RegistrationHeader } from "./fields"

export function WelcomeHero({
  onStart,
  saved = null,
  onResume,
  onStartOver,
}: {
  onStart: () => void
  saved?: { savedAt: number } | null
  onResume?: () => void
  onStartOver?: () => void
}) {
  const { dict, locale } = useDriverRegistration()
  const savedTime = saved
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : locale, { hour: "numeric", minute: "2-digit" }).format(
        new Date(saved.savedAt)
      )
    : null

  return (
    <div className="min-h-screen bg-background">
      <RegistrationHeader />

      <main className="mx-auto grid max-w-5xl gap-10 px-4 pb-16 pt-12 lg:grid-cols-[1.25fr_1fr] lg:items-end lg:gap-16 lg:px-8 lg:pt-24">
        <section aria-labelledby="registration-title">
          <h1
            id="registration-title"
            className="max-w-[18ch] text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl"
          >
            {dict.welcome.title}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground/80">{dict.welcome.subtitle}</p>

          {saved ? (
            <div className="mt-10 bg-elite-blue-50 p-6 dark:bg-elite-blue-950/40" data-testid="registration-resume">
              <h2 className="text-xl font-bold text-foreground">{dict.resume.title}</h2>
              <p className="mt-2 max-w-md text-base text-foreground/80">
                {dict.resume.body}
                {savedTime ? <span className="ms-1 tabular-nums">({savedTime})</span> : null}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  onClick={onResume}
                  size="lg"
                  className="h-12 gap-2 rounded-none bg-elite-blue-600 px-7 text-base font-bold text-white hover:bg-elite-blue-700 active:translate-y-px"
                >
                  {dict.resume.continue}
                  <ArrowRight className="h-5 w-5 rtl:-scale-x-100" aria-hidden />
                </Button>
                <Button
                  onClick={onStartOver}
                  size="lg"
                  variant="ghost"
                  className="h-12 rounded-none px-5 text-base font-semibold text-foreground hover:bg-background/70"
                >
                  {dict.resume.startOver}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button
                onClick={onStart}
                size="lg"
                className="group h-14 gap-2.5 rounded-none bg-elite-blue-600 px-10 text-base font-bold text-white transition-colors hover:bg-elite-blue-700 active:translate-y-px"
              >
                {dict.welcome.ctaStart}
                <ArrowRight
                  className="h-5 w-5 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
                  aria-hidden
                />
              </Button>
              <p className="text-base font-semibold text-foreground/70">{dict.welcome.steps}</p>
            </div>
          )}
        </section>

        <ul className="space-y-px bg-border/0" aria-label={dict.welcome.badge}>
          {dict.welcome.trustPoints.map((point) => (
            <li key={point} className="flex items-center gap-4 bg-muted/60 px-5 py-5 text-base font-semibold text-foreground">
              <Check className="h-5 w-5 shrink-0 text-elite-orange-600" aria-hidden />
              {point}
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
