"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal } from "./shared"

export function TrustSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  return (
    <section id="trust" className="scroll-mt-8 bg-muted py-24 lg:py-32">
      <div className="mx-auto grid max-w-7xl gap-16 px-5 lg:grid-cols-2 lg:gap-24 lg:px-8">
        {[{ ...c.benefits, heading: locale === "ar" ? "وقت أقل. رؤية أوضح." : "Less work. More clarity." }, { ...c.trust, heading: locale === "ar" ? "الثقة في أساس العمل." : "Control at the foundation." }].map(group => <div key={group.tag}>
          <Reveal>
            <h2 className="text-[clamp(1.8rem,3vw,2.7rem)] font-semibold leading-[1.15] tracking-tight">{group.heading}</h2>
            <p className="mt-5 text-base leading-relaxed">{group.subtitle}</p>
          </Reveal>
          <dl className="mt-9 space-y-6">{group.items.map((item, index) => <Reveal key={item.title} delay={index % 3 * 60}>
            <dt className="text-lg font-semibold">{item.title}</dt>
            <dd className="mt-2 text-base leading-relaxed">{item.desc}</dd>
          </Reveal>)}</dl>
        </div>)}
      </div>
    </section>
  )
}
