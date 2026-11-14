"use client"

import Link from "next/link"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { REDIRECTS, withLocale } from "@/lib/redirects"
import { HeadlineLine, Reveal } from "./shared"

export function HeroSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight
  const lines = locale === "ar" ? ["تشغيلك،", "مترابط."] : ["Logistics,", "connected."]
  return (
    <section className="bg-elite-blue-950 text-white">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:py-20 lg:px-8 lg:py-24">
        <div className="grid items-end gap-10 lg:grid-cols-[.42fr_.58fr] lg:gap-12">
          <div className="order-2 lg:order-1">
            <Reveal delay={180}>
              <p className="max-w-[36ch] text-base leading-relaxed text-white sm:text-lg">{c.hero.subheadline}</p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
                <Link href="#platform" className="inline-flex min-h-12 items-center gap-3 bg-white px-5 py-3 text-sm font-semibold text-elite-blue-950 transition-transform hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{c.hero.ctaPrimary}<Arrow className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href={withLocale(REDIRECTS.signInUrl, locale)} className="py-3 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">{c.hero.ctaSecondary}</Link>
              </div>
            </Reveal>
          </div>
          <h1 className="order-1 text-[clamp(3.5rem,8.1vw,7.3rem)] font-medium leading-[.98] tracking-[-.055em] lg:order-2">
            {lines.map((line, index) => <HeadlineLine key={line} delay={index * 110}>{line}</HeadlineLine>)}
          </h1>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-5 pb-7 text-sm lg:flex-row lg:px-8">
        <p>{c.hero.flowTitle}</p>
        <p className="flex flex-wrap gap-x-5 gap-y-2">{c.hero.flow.map(step => <span key={step}>{step}</span>)}</p>
      </div>
    </section>
  )
}
