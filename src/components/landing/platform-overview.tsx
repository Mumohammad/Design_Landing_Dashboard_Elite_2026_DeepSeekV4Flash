"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, iconMap } from "./shared"

export function PlatformOverview() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="platform" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 lg:px-8">
      <SectionHeading tag={c.modules.tag} title={c.modules.title} subtitle={c.modules.subtitle} />

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {c.modules.items.map((module, index) => {
          const Icon = iconMap[module.icon]
          return (
            <Reveal key={module.title} delay={(index % 4) * 60}>
              <div className="group h-full rounded-2xl border border-border/50 bg-card p-5 transition-all duration-300 hover:border-elite-blue-500/40 hover:shadow-lg hover:shadow-elite-blue-500/10">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-elite-blue-500/10 to-elite-orange-500/10 text-elite-blue-600 transition-transform duration-300 group-hover:scale-110 dark:text-elite-blue-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-bold text-foreground">{module.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{module.desc}</p>
              </div>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}
