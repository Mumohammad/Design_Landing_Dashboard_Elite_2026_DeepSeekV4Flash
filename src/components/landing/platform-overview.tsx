"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, iconMap, iconGradients } from "./shared"
import { cn } from "@/lib/utils"

const moduleAccents: Record<string, string> = {
  drivers: "hover:border-blue-500/40",
  fleet: "hover:border-emerald-500/40",
  vehicles: "hover:border-violet-500/40",
  orders: "hover:border-amber-500/40",
  payroll: "hover:border-emerald-500/40",
  attendance: "hover:border-blue-500/40",
  violations: "hover:border-red-500/40",
  maintenance: "hover:border-orange-500/40",
  expenses: "hover:border-cyan-500/40",
  documents: "hover:border-indigo-500/40",
  compliance: "hover:border-emerald-500/40",
  reports: "hover:border-purple-500/40",
}

export function PlatformOverview() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="platform" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-24 lg:px-8">
      <SectionHeading tag={c.modules.tag} title={c.modules.title} subtitle={c.modules.subtitle} />

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {c.modules.items.map((module, index) => {
          const Icon = iconMap[module.icon]
          const gradient = iconGradients[module.icon] || "from-blue-500 to-cyan-500"
          return (
            <Reveal key={module.title} delay={(index % 4) * 80}>
              <div
                className={cn(
                  "group relative h-full overflow-hidden rounded-2xl border border-border/40 bg-card/70 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-border hover:shadow-xl hover:shadow-black/5",
                  moduleAccents[module.icon]
                )}
              >
                {/* Animated gradient accent line at top */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-elite-blue-500/0 to-transparent transition-all duration-500 group-hover:via-elite-blue-500/50" />

                {/* Icon with gradient and glow */}
                <div className="relative">
                  <div
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-xl",
                      gradient,
                      "shadow-black/10"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  {/* Glow on hover */}
                  <div
                    className={cn(
                      "absolute inset-0 -z-10 rounded-2xl opacity-0 blur-xl transition-all duration-500 group-hover:opacity-30",
                      `bg-gradient-to-br ${gradient}`
                    )}
                  />
                </div>

                <h3 className="mt-5 text-base font-bold text-foreground transition-colors">{module.title}</h3>
                <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{module.desc}</p>

                {/* Bottom gradient line */}
                <div className="mt-5 h-px w-0 bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 transition-all duration-700 group-hover:w-full opacity-0 group-hover:opacity-40" />
              </div>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}
