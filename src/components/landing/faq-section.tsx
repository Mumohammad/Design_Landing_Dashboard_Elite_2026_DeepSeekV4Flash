"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal } from "./shared"

export function FaqSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  return (
    <section id="faq" className="scroll-mt-8 bg-muted py-24 lg:py-32">
      <div className="mx-auto grid max-w-7xl items-start gap-10 px-5 lg:grid-cols-[.65fr_1.35fr] lg:gap-16 lg:px-8">
        <Reveal>
          <h2 className="text-[clamp(2rem,3.5vw,3.3rem)] font-semibold leading-tight tracking-tight">{c.faq.title}</h2>
          <p className="mt-5 text-base leading-relaxed">{c.faq.subtitle}</p>
        </Reveal>
        <div className="columns-1 gap-10 md:columns-2">{c.faq.items.map((faq, index) => <Reveal key={faq.q} className="mb-7 break-inside-avoid" delay={index % 3 * 60}>
          <p className="text-base leading-relaxed">
            <strong className="font-semibold">{faq.q}</strong>{" "}{faq.a}</p>
        </Reveal>)}</div>
      </div>
    </section>
  )
}
