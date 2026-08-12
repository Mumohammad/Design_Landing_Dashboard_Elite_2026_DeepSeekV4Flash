"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, iconMap } from "./shared"

function IconGrid({
  items,
}: {
  items: { icon: keyof typeof iconMap; title: string; desc: string }[]
}) {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, index) => {
        const Icon = iconMap[item.icon]
        return (
          <Reveal key={item.title} delay={(index % 4) * 60}>
            <div className="group h-full rounded-2xl border border-border/50 bg-card p-5 transition-all duration-300 hover:border-elite-blue-500/40 hover:shadow-lg hover:shadow-elite-blue-500/10">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-elite-blue-500/10 to-elite-orange-500/10 text-elite-blue-600 transition-transform duration-300 group-hover:scale-110 dark:text-elite-blue-300">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-sm font-bold text-foreground">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{item.desc}</p>
            </div>
          </Reveal>
        )
      })}
    </div>
  )
}

export function TrustSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="trust" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-20">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading tag={c.benefits.tag} title={c.benefits.title} subtitle={c.benefits.subtitle} />
        <IconGrid items={c.benefits.items} />

        <div className="mt-20">
          <SectionHeading tag={c.trust.tag} title={c.trust.title} subtitle={c.trust.subtitle} />
          <IconGrid items={c.trust.items} />
        </div>
      </div>
    </section>
  )
}
