"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

export function ComplianceSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  return (
    <section id="compliance" className="scroll-mt-8 bg-elite-blue-950 py-24 text-white lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHeading dark tag={c.compliance.tag} title={locale === "ar" ? "جاهزية تبدأ بالسجل." : "Readiness starts with records."} subtitle={c.compliance.subtitle} />
        <dl className="mt-14 space-y-10">{c.compliance.features.map((feature, index) => <Reveal key={feature.title} delay={index * 70}>
          <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
            <dt className="text-[clamp(1.6rem,3.5vw,3.2rem)] font-medium leading-tight tracking-tight">{feature.title}</dt>
            <dd className="max-w-[58ch] text-base leading-relaxed text-white/85 lg:pt-2 lg:text-lg">{feature.desc}</dd>
          </div>
        </Reveal>)}</dl>
        <DemoNote dark>{c.compliance.note}</DemoNote>
      </div>
    </section>
  )
}
