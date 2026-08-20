"use client"

import Link from "next/link"
import { ArrowLeft, ArrowRight, ArrowUpRight, Sparkles, Zap, Shield, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DotPattern } from "@/components/dot-pattern"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal } from "./shared"

export function FinalCta() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  return (
    <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-elite-blue-950 via-[#0c1f38] to-elite-blue-900">
          {/* Animated background elements */}
          <DotPattern
            size="md"
            opacity="low"
            fadeStyle="ellipse"
            className="!bg-[radial-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)]"
          />
          <div className="absolute -end-32 -top-32 h-96 w-96 rounded-full bg-elite-blue-500/20 blur-[100px] animate-float-slow" />
          <div className="absolute -bottom-32 -start-32 h-96 w-96 rounded-full bg-elite-orange-500/15 blur-[100px] animate-float-medium" />
          <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-elite-blue-400/10 blur-[80px] animate-float-fast" />

          {/* Gradient border effects */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-elite-blue-500/50 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-elite-orange-500/30 to-transparent" />

          <div className="relative flex flex-col items-center gap-8 px-6 py-20 text-center sm:px-12 lg:py-24">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/70 backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5 text-elite-orange-400" />
              {locale === "ar" ? "ابدأ الآن" : "Get Started Today"}
            </div>

            <h2 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
              {c.finalCta.title}
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">{c.finalCta.subtitle}</p>

            <div className="mt-2 flex flex-col gap-4 sm:flex-row">
              <Button
                asChild
                className="group h-13 gap-2.5 rounded-2xl bg-gradient-to-r from-elite-orange-500 to-elite-orange-600 px-9 text-sm font-bold text-white shadow-2xl shadow-elite-orange-500/30 transition-all duration-300 hover:from-elite-orange-600 hover:to-elite-orange-700 hover:shadow-elite-orange-500/50 hover:scale-[1.02] active:scale-[0.98]"
              >
                <Link href="/driver-registration" target="_blank" rel="noopener noreferrer">
                  <Zap className="h-4 w-4 transition-transform group-hover:rotate-12" />
                  {c.finalCta.applyAsDriver}
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-13 gap-2.5 rounded-2xl border-white/15 bg-white/5 px-9 text-sm font-bold text-white backdrop-blur-md transition-all duration-300 hover:border-white/30 hover:bg-white/10 hover:text-white hover:shadow-lg hover:shadow-white/5"
              >
                <Link href="#platform">
                  {c.finalCta.ctaPrimary}
                  <Arrow className="h-4 w-4 rtl:-scale-x-100" />
                </Link>
              </Button>
            </div>

            <p className="mt-2 max-w-md text-sm text-white/40">{c.finalCta.applyAsDriverDesc}</p>

            {/* Trust indicators */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-6 text-xs text-white/40">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-elite-blue-400" />
                <span>{locale === "ar" ? "تشفير على مستوى المؤسسات" : "Enterprise-grade encryption"}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>{locale === "ar" ? "إعداد في 5 دقائق" : "5-minute setup"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-elite-orange-400" />
                <span>{locale === "ar" ? "بدون بطاقة ائتمان" : "No credit card required"}</span>
              </div>
            </div>

            <p className="mt-2 text-xs text-white/30">{c.finalCta.note}</p>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
