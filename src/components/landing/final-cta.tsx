"use client"

import Link from "next/link"
import { ArrowLeft, ArrowRight, ArrowUpRight, Sparkles, Zap, Shield, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
        <div className="relative overflow-hidden rounded-[2rem] bg-elite-blue-950">

          {/* Gradient border effects */}
          <div className="absolute inset-x-0 bottom-0 h-px bg-transparent" />

          <div className="relative flex flex-col items-center gap-8 px-6 py-20 text-center sm:px-12 lg:py-24">

            <h2 className="max-w-3xl text-3xl font-bold leading-tight text-white sm:text-4xl">
              {c.finalCta.title}
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">{c.finalCta.subtitle}</p>

            <div className="mt-2 flex flex-col gap-4 sm:flex-row">
              <Button
                asChild
                className="group h-13 gap-2.5 rounded-2xl bg-elite-orange-500 px-9 text-sm font-bold text-white shadow-elite-orange-500/30 transition-all duration-300 hover:bg-elite-orange-600 hover:shadow-elite-orange-500/50 hover:scale-[1.02] active:scale-[0.98]"
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
                className="h-13 gap-2.5 rounded-2xl border-white/15 bg-white/5 px-9 text-sm font-bold text-white transition-all duration-300 hover:border-white/30 hover:bg-white/10 hover:text-white"
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
