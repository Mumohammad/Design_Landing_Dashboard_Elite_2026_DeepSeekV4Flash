"use client"

import { cn } from "@/lib/utils"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote, iconMap, iconGradients } from "./shared"

export function ComplianceSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="compliance" className="relative scroll-mt-24 overflow-hidden bg-elite-blue-950 py-24">


      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading dark tag={c.compliance.tag} title={c.compliance.title} subtitle={c.compliance.subtitle} />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {c.compliance.features.map((feature, index) => {
            const Icon = iconMap[feature.icon]
            const gradient = iconGradients[feature.icon] || "bg-transparent text-elite-blue-600! dark:text-elite-blue-300! shadow-none h-auto! w-auto! justify-start! rounded-none"
            return (
              <Reveal key={feature.title} delay={index * 80}>
                <div className="group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.08] hover:shadow-elite-blue-500/10">

                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl text-white transition-all duration-300 group-hover:scale-110", gradient, "")}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-bold text-white">{feature.title}</h3>
                  <p className="mt-2.5 text-base leading-relaxed text-white/80">{feature.desc}</p>

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
