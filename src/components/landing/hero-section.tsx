"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Sparkles, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DotPattern } from "@/components/dot-pattern"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionTag } from "./shared"
import { DashboardPreview } from "./dashboard-preview"

function FloatingOrb({
  className,
  size,
  delay = 0,
  speed = "slow",
}: {
  className?: string
  size: number
  delay?: number
  speed?: "slow" | "medium" | "fast"
}) {
  const animClass =
    speed === "slow"
      ? "animate-float-slow"
      : speed === "medium"
        ? "animate-float-medium"
        : "animate-float-fast"

  return (
    <div
      className={`absolute rounded-full blur-3xl opacity-40 dark:opacity-30 ${animClass} ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        animationDelay: `${delay}s`,
      }}
    />
  )
}

export function HeroSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  return (
    <section className="relative overflow-hidden">
      {/* ── Animated gradient mesh background ── */}
      <div className="absolute inset-0 gradient-mesh" />
      <div className="absolute inset-0 dot-grid-premium opacity-50" />

      {/* ── Floating orbs ── */}
      <FloatingOrb className="bg-elite-blue-500/30 top-[-5%] left-[10%]" size={400} delay={0} speed="slow" />
      <FloatingOrb className="bg-elite-orange-500/20 top-[20%] right-[-5%]" size={300} delay={2} speed="medium" />
      <FloatingOrb className="bg-elite-blue-400/15 bottom-[10%] left-[30%]" size={250} delay={4} speed="fast" />
      <FloatingOrb className="bg-elite-orange-400/10 bottom-[-10%] right-[20%]" size={350} delay={1} speed="slow" />

      {/* ── Radial gradient overlay ── */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-transparent to-background" />

      <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-16 lg:px-8 lg:pt-20">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          {/* ── Copy ── */}
          <div className="text-center lg:text-start">
            <Reveal>
              <SectionTag>
                <Sparkles className="h-3.5 w-3.5" />
                {c.hero.badge}
              </SectionTag>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="mt-7 text-4xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-5xl xl:text-[3.6rem]">
                {c.hero.headlineA}{" "}
                <span className="text-gradient-elite">
                  {c.hero.headlineB}
                </span>
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
                {c.hero.subheadline}
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
                <Button
                  asChild
                  className="group relative h-13 gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-2xl shadow-elite-blue-500/30 transition-all duration-300 hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/50 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Link href="#platform">
                    <Zap className="h-4 w-4 transition-transform group-hover:rotate-12" />
                    {c.hero.ctaPrimary}
                    <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:-scale-x-100" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-13 rounded-2xl border-border/60 px-8 text-sm font-bold backdrop-blur-sm transition-all duration-300 hover:border-elite-blue-500/40 hover:bg-elite-blue-500/5 hover:shadow-lg hover:shadow-elite-blue-500/10"
                >
                  <Link href="/auth/sign-in">{c.hero.ctaSecondary}</Link>
                </Button>
              </div>
            </Reveal>

            {/* ── Connected module flow ── */}
            <Reveal delay={320}>
              <p className="mt-14 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
                {c.hero.flowTitle}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                {c.hero.flow.map((step, i) => (
                  <React.Fragment key={step}>
                    <span className="group relative rounded-xl border border-border/50 bg-card/60 px-4 py-2 text-xs font-bold text-foreground shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-elite-blue-500/40 hover:bg-elite-blue-500/5 hover:shadow-lg hover:shadow-elite-blue-500/10">
                      {step}
                    </span>
                    {i < c.hero.flow.length - 1 && (
                      <div className="relative flex items-center">
                        <div className="h-px w-3 bg-gradient-to-r from-elite-blue-500/50 to-elite-orange-500/50" />
                        <Arrow className="absolute -right-1 h-3 w-3 text-elite-orange-500 rtl:-scale-x-100" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </Reveal>
          </div>

          {/* ── Live product preview ── */}
          <Reveal delay={200} className="relative">
            <div className="relative">
              {/* Ambient glow behind the preview */}
              <div className="absolute -inset-12 rounded-[3rem] bg-gradient-to-tr from-elite-blue-500/25 via-elite-orange-500/10 to-elite-blue-500/20 blur-3xl animate-pulse-glow" />

              {/* Glass frame around dashboard preview */}
              <div className="relative overflow-hidden rounded-3xl border border-white/30 bg-white/40 p-2.5 shadow-2xl shadow-elite-blue-900/15 backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
                {/* Browser chrome bar */}
                <div className="flex items-center gap-2 rounded-2xl bg-card/80 px-4 py-2.5 backdrop-blur-md">
                  <span className="h-3 w-3 rounded-full bg-rose-400/80 transition-colors group-hover:bg-rose-500" />
                  <span className="h-3 w-3 rounded-full bg-amber-400/80 transition-colors group-hover:bg-amber-500" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400/80 transition-colors group-hover:bg-emerald-500" />
                  <div className="ms-3 flex-1 rounded-xl bg-muted/50 px-3 py-1.5 text-center text-[10px] text-muted-foreground">
                    elite-development.app/dashboard
                  </div>
                </div>
                <div className="mt-2 overflow-hidden rounded-2xl">
                  <DashboardPreview />
                </div>
              </div>

              {/* Floating badge */}
              <span className="absolute -top-4 start-6 z-10 rounded-2xl bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 px-4 py-1.5 text-[11px] font-bold text-white shadow-xl shadow-elite-blue-500/30">
                {c.hero.demoLabel}
              </span>

              {/* Secondary floating accent */}
              <div className="absolute -bottom-3 end-8 z-10 rounded-2xl border border-border/50 bg-card/80 px-4 py-2 backdrop-blur-xl shadow-lg">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15">
                    <Zap className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  </span>
                  <span className="text-[11px] font-bold text-foreground">
                    {locale === "ar" ? "99.9% وقت التشغيل" : "99.9% Uptime"}
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
