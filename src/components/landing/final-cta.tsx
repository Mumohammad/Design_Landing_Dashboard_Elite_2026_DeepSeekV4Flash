"use client"

import Link from "next/link"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal } from "./shared"
import { REDIRECTS, withLocale } from "@/lib/redirects"

export function FinalCta() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight
  return (
    <section className="bg-elite-blue-700 py-20 text-white lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reveal>
          <h2 className="max-w-[20ch] text-balance text-[clamp(2.4rem,5.5vw,5rem)] font-medium leading-[1.1] tracking-tight rtl:leading-[1.35] rtl:tracking-normal">{c.finalCta.title}</h2>
        </Reveal>
        <div className="mt-8 grid items-start gap-10 md:grid-cols-2 lg:gap-16">
          <Reveal delay={100}>
            <p className="max-w-[44ch] text-lg leading-relaxed">{c.finalCta.subtitle}</p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href={withLocale(REDIRECTS.registerUrl, locale)} className="inline-flex min-h-12 items-center gap-3 bg-white px-5 py-3 text-sm font-semibold text-elite-blue-950 hover:bg-elite-blue-50">{c.finalCta.ctaPrimary}<Arrow className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href={withLocale(REDIRECTS.signInUrl, locale)} className="inline-flex min-h-12 items-center px-2 py-3 text-sm font-semibold underline underline-offset-4">{c.finalCta.ctaSecondary}</Link>
            </div>
          </Reveal>
          <Reveal delay={180}>
            <h3 id="driver-applications" tabIndex={-1} className="scroll-mt-8 text-xl font-semibold">{c.finalCta.applyAsDriver}</h3>
            <p className="mt-3 max-w-[45ch] text-base leading-relaxed">{c.finalCta.applyAsDriverDesc}</p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
