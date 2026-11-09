"use client"

import Link from "next/link"
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal } from "./shared"

export function FinalCta() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight
  return (
    <section className="bg-elite-blue-500 py-24 text-white lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <h2 className="text-[clamp(2.4rem,6.9vw,6.5rem)] font-medium leading-[1.02] tracking-[-.045em]">{locale === "ar" ? <>عملية واحدة.<br />مساحة عمل واحدة.</> : <>One operation.<br />One workspace.</>}</h2>
        </Reveal>
        <div className="mt-12 grid items-end gap-10 md:grid-cols-2 md:gap-8 lg:gap-10">
          <Reveal delay={100}>
            <p className="max-w-[44ch] text-lg leading-relaxed">{c.finalCta.subtitle}</p>
            <p className="mt-5 text-sm text-white/80">{c.finalCta.note}</p>
          </Reveal>
          <Reveal delay={180}>
            <div className="flex flex-wrap gap-4">
              <Link href="#platform" className="inline-flex min-h-12 items-center gap-3 bg-white px-5 py-3 text-sm font-semibold text-elite-blue-950 transition-transform hover:-translate-y-0.5 active:translate-y-0">{c.finalCta.ctaPrimary}<Arrow className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/driver-registration" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-3 px-2 py-3 text-sm font-semibold underline underline-offset-4 transition-opacity hover:opacity-70">{c.finalCta.applyAsDriver}<ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </div>
            <p className="mt-5 max-w-[52ch] text-sm leading-relaxed text-white/85">{c.finalCta.applyAsDriverDesc}</p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
