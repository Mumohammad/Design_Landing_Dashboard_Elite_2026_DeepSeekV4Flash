"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote, iconMap } from "./shared"

export function ComplianceSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="compliance" className="relative scroll-mt-24 overflow-hidden bg-elite-blue-950 py-20">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading dark tag={c.compliance.tag} title={c.compliance.title} subtitle={c.compliance.subtitle} />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {c.compliance.features.map((feature, index) => {
            const Icon = iconMap[feature.icon]
            return (
              <Reveal key={feature.title} delay={index * 70}>
                <div className="group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/10">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-elite-blue-500/30 to-elite-orange-500/30 text-white transition-transform duration-300 group-hover:scale-110">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-bold text-white">{feature.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-white/60">{feature.desc}</p>
                </div>
              </Reveal>
            )
          })}
        </div>

        <DemoNote dark>{c.compliance.note}</DemoNote>
      </div>
    </section>
  )
}
