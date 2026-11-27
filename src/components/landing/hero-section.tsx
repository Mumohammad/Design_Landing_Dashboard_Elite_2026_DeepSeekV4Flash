"use client"

import Link from "next/link"
import Image from "next/image"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { REDIRECTS, withLocale } from "@/lib/redirects"

export function HeroSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight
  return (
    <section className="bg-elite-blue-950 text-white">
      <div className="mx-auto grid max-w-7xl items-center gap-9 px-5 pb-12 pt-8 sm:pb-16 lg:grid-cols-[.94fr_1.06fr] lg:gap-12 lg:px-8 lg:py-20">
        <div className="min-w-0">
          <h1 className="max-w-[14ch] text-balance text-[clamp(2.85rem,5.8vw,5.5rem)] font-semibold leading-[1.02] tracking-[-.045em] rtl:leading-[1.3] rtl:tracking-normal">{c.hero.headlineA}</h1>
          <p className="mt-6 max-w-[46ch] text-base leading-relaxed text-white/85 sm:text-lg">{c.hero.subheadline}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href={withLocale(REDIRECTS.registerUrl, locale)} className="inline-flex min-h-12 items-center gap-3 bg-white px-5 py-3 text-sm font-semibold text-elite-blue-950 hover:bg-elite-blue-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{c.hero.ctaPrimary}<Arrow className="size-4" aria-hidden="true" /></Link>
            <a href="#platform" className="inline-flex min-h-12 items-center py-3 text-sm font-semibold underline underline-offset-4">{c.hero.ctaSecondary}</a>
          </div>
        </div>
        <Image src="/Bike-2026.png" alt="" width={1365} height={768} preload sizes="(min-width: 1280px) 630px, (min-width: 1024px) 50vw, 100vw" className="aspect-[16/10] w-full object-cover lg:aspect-[5/4]" />
      </div>
    </section>
  )
}
