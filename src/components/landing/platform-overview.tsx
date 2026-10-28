"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, iconMap, iconGradients } from "./shared"
import { cn } from "@/lib/utils"

const moduleAccents: Record<string, string> = {
  drivers: "hover:border-elite-blue-500/40",
  fleet: "hover:border-elite-blue-500/40",
  vehicles: "hover:border-elite-blue-500/40",
  orders: "hover:border-elite-blue-500/40",
  payroll: "hover:border-elite-blue-500/40",
  attendance: "hover:border-elite-blue-500/40",
  violations: "hover:border-elite-blue-500/40",
  maintenance: "hover:border-elite-blue-500/40",
  expenses: "hover:border-elite-blue-500/40",
  documents: "hover:border-elite-blue-500/40",
  compliance: "hover:border-elite-blue-500/40",
  reports: "hover:border-elite-blue-500/40",
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
          const gradient = iconGradients[module.icon] || "bg-transparent text-elite-blue-600! dark:text-elite-blue-300! shadow-none h-auto! w-auto! justify-start! rounded-none"
          return (
            <Reveal key={module.title} delay={(index % 4) * 80}>
              <div
                className={cn(
                  "group relative h-full overflow-hidden rounded-2xl border border-border/40 bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-border",
                  moduleAccents[module.icon]
                )}
              >

                {/* Icon with gradient and glow */}
                <div className="relative">
                  <div
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-2xl text-white transition-all duration-300 group-hover:scale-110",
                      gradient,
                      ""
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>

                <h3 className="mt-5 text-lg font-semibold text-foreground transition-colors">{module.title}</h3>
                <p className="mt-2.5 text-base leading-relaxed text-foreground/75">{module.desc}</p>

              </div>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}
