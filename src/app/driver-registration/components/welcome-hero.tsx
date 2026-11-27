"use client"

import { ArrowRight } from "lucide-react"
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
    <div className="min-h-dvh bg-background">
      <RegistrationHeader />
      <main className="mx-auto flex max-w-4xl flex-col items-start px-5 pb-16 pt-14 lg:px-8 lg:pt-20">
        <h1 id="registration-title" className="max-w-3xl text-4xl font-semibold leading-[1.2] tracking-tight text-foreground sm:text-5xl">
          {dict.welcome.title}
        </h1>
        <p className="mt-5 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">
          {dict.welcome.subtitle}
        </p>
        {saved ? (
          <section aria-labelledby="resume-title" className="mt-8 w-full rounded-md border border-border bg-muted/40 p-5 sm:p-6" data-testid="registration-resume">
            <h2 id="resume-title" className="text-xl font-semibold text-foreground">{dict.resume.title}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {dict.resume.body}
              {savedTime ? <span className="ms-1 tabular-nums">({savedTime})</span> : null}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button onClick={onResume} size="lg" className="h-12 gap-2.5 rounded-md bg-foreground px-6 text-sm font-medium text-background hover:bg-foreground/90">
                {dict.resume.continue}
                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              </Button>
              <Button onClick={onStartOver} size="lg" variant="ghost" className="h-12 rounded-md px-5 text-sm font-medium">
                {dict.resume.startOver}
              </Button>
            </div>
          </section>
        ) : (
          <>
            <Button onClick={onStart} size="lg" className="mt-8 h-12 gap-2.5 rounded-md bg-foreground px-6 text-sm font-medium text-background hover:bg-foreground/90">
              {dict.welcome.ctaStart}
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </Button>
            <p className="mt-4 text-sm text-muted-foreground">{dict.welcome.steps}</p>
          </>
        )}
        <ul aria-label={dict.welcome.badge} className="mt-12 grid w-full gap-x-8 gap-y-5 border-t border-border pt-6 sm:grid-cols-3">
          {dict.welcome.trustPoints.map((point) => (
            <li key={point} className="flex items-start gap-2 text-sm leading-6 text-foreground">
              <svg viewBox="0 0 12 12" className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" fill="none" aria-hidden>
                <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {point}
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
