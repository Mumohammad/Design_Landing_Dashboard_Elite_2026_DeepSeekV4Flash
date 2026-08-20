"use client"

import { cn } from "@/lib/utils"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote, iconMap, iconGradients } from "./shared"
import { DotPattern } from "@/components/dot-pattern"

export function ComplianceSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="compliance" className="relative scroll-mt-24 overflow-hidden bg-elite-blue-950 py-24">
      {/* Animated background orbs */}
      <div className="absolute -start-32 top-1/4 h-80 w-80 rounded-full bg-elite-blue-500/15 blur-[120px] animate-float-slow" />
      <div className="absolute -end-32 bottom-1/4 h-80 w-80 rounded-full bg-elite-orange-500/10 blur-[100px] animate-float-medium" />
      <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-[80px] animate-float-fast" />

      <DotPattern
        size="lg"
        opacity="low"
        fadeStyle="ellipse"
        className="!bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)]"
      />

      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading dark tag={c.compliance.tag} title={c.compliance.title} subtitle={c.compliance.subtitle} />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {c.compliance.features.map((feature, index) => {
            const Icon = iconMap[feature.icon]
            const gradient = iconGradients[feature.icon] || "from-blue-500 to-cyan-500"
            return (
              <Reveal key={feature.title} delay={index * 80}>
                <div className="group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.08] hover:shadow-xl hover:shadow-elite-blue-500/10">
                  {/* Animated gradient line at top */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/0 to-transparent transition-all duration-500 group-hover:via-white/30" />

                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-xl", gradient, "shadow-black/30")}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-bold text-white">{feature.title}</h3>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-white/60">{feature.desc}</p>

                  {/* Bottom gradient line */}
                  <div className="mt-5 h-px w-0 bg-gradient-to-r from-elite-blue-500/60 to-elite-orange-500/60 transition-all duration-700 group-hover:w-full" />
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
