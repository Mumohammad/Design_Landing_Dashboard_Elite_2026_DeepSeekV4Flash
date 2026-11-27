"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal } from "./shared"
import { Plus } from "lucide-react"

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
        <div className="divide-y divide-border">{c.faq.items.map(faq => (
          <details key={faq.q} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-start text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
              {faq.q}<Plus className="size-5 shrink-0 group-open:rotate-45" aria-hidden="true" />
            </summary>
            <p className="max-w-[65ch] pb-5 text-base leading-relaxed">{faq.a}</p>
          </details>
        ))}</div>
      </div>
    </section>
  )
}
