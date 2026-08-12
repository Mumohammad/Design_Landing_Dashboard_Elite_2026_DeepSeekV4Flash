"use client"

import Link from "next/link"
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react"
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
        <div className="relative overflow-hidden rounded-3xl bg-elite-blue-950">
          <DotPattern
            size="md"
            opacity="low"
            fadeStyle="ellipse"
            className="!bg-[radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)]"
          />
          <div className="absolute -end-24 -top-24 h-72 w-72 rounded-full bg-elite-blue-500/20 blur-3xl" />
          <div className="absolute -bottom-24 -start-24 h-72 w-72 rounded-full bg-elite-orange-500/15 blur-3xl" />

          <div className="relative flex flex-col items-center gap-6 px-6 py-16 text-center sm:px-12">
            <h2 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
              {c.finalCta.title}
            </h2>
            <p className="max-w-xl text-white/75">{c.finalCta.subtitle}</p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="group h-12 gap-2 rounded-xl bg-gradient-to-r from-elite-orange-500 to-elite-orange-600 px-8 text-sm font-bold text-white shadow-xl shadow-elite-orange-500/30 transition-all hover:from-elite-orange-600 hover:to-elite-orange-700 hover:shadow-elite-orange-500/50"
              >
                <Link href="/driver-registration" target="_blank" rel="noopener noreferrer">
                  {c.finalCta.applyAsDriver}
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 gap-2 rounded-xl border-white/20 bg-white/5 px-8 text-sm font-bold text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="#platform">
                  {c.finalCta.ctaPrimary}
                  <Arrow className="h-4 w-4 rtl:-scale-x-100" />
                </Link>
              </Button>
            </div>
            <p className="mt-3 max-w-md text-sm text-white/60">{c.finalCta.applyAsDriverDesc}</p>
            <p className="mt-2 text-xs text-white/40">{c.finalCta.note}</p>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
