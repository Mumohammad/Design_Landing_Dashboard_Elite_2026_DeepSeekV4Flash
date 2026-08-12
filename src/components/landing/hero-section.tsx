"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DotPattern } from "@/components/dot-pattern"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionTag } from "./shared"
import { DashboardPreview } from "./dashboard-preview"

export function HeroSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  return (
    <section className="relative overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gradient-to-b from-elite-blue-50 via-background to-background dark:from-elite-blue-950/40 dark:via-background dark:to-background" />
      <DotPattern size="md" opacity="low" fadeStyle="ellipse" />

      <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-12 lg:px-8 lg:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Copy */}
          <div className="text-center lg:text-start">
            <Reveal>
              <SectionTag>
                <Sparkles className="h-3.5 w-3.5" />
                {c.hero.badge}
              </SectionTag>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.15] tracking-tight text-foreground sm:text-5xl xl:text-[3.4rem]">
                {c.hero.headlineA}{" "}
                <span className="bg-gradient-to-r from-elite-blue-500 via-elite-blue-600 to-elite-orange-500 bg-clip-text text-transparent">
                  {c.hero.headlineB}
                </span>
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
                {c.hero.subheadline}
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
                <Button
                  asChild
                  className="group h-12 gap-2 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-7 text-sm font-semibold text-white shadow-xl shadow-elite-blue-500/25 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40"
                >
                  <Link href="#platform">
                    {c.hero.ctaPrimary}
                    <Arrow className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 rtl:-scale-x-100" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-12 rounded-xl px-7 text-sm font-semibold">
                  <Link href="/auth/sign-in">{c.hero.ctaSecondary}</Link>
                </Button>
              </div>
            </Reveal>

            {/* Connected module flow */}
            <Reveal delay={320}>
              <p className="mt-12 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {c.hero.flowTitle}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                {c.hero.flow.map((step, i) => (
                  <React.Fragment key={step}>
                    <span className="rounded-full border border-border/60 bg-background/80 px-3.5 py-1.5 text-xs font-bold text-foreground shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-elite-blue-500/40 hover:shadow-md">
                      {step}
                    </span>
                    {i < c.hero.flow.length - 1 && (
                      <Arrow className="h-3.5 w-3.5 shrink-0 text-elite-orange-500 rtl:-scale-x-100" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </Reveal>
          </div>

          {/* Live product preview */}
          <Reveal delay={200} className="relative">
            <div className="relative">
              <div className="absolute -inset-8 rounded-[2.5rem] bg-gradient-to-tr from-elite-blue-500/20 via-transparent to-elite-orange-500/20 blur-3xl" />
              <div className="relative overflow-hidden rounded-2xl border border-white/40 bg-white/60 p-2 shadow-2xl shadow-elite-blue-900/10 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center gap-1.5 px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                  <span className="ms-2 truncate rounded-md bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                    elite-development.app/dashboard
                  </span>
                </div>
                <DashboardPreview />
              </div>
              <span className="absolute -top-3 start-4 rounded-full bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 px-3 py-1 text-[10px] font-bold text-white shadow-md">
                {c.hero.demoLabel}
              </span>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
