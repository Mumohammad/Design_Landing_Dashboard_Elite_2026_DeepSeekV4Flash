"use client"

import { cn } from "@/lib/utils"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, iconMap, iconGradients } from "./shared"

function IconGrid({
  items,
}: {
  items: { icon: keyof typeof iconMap; title: string; desc: string }[]
}) {
  return (
    <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, index) => {
        const Icon = iconMap[item.icon]
        const gradient = iconGradients[item.icon] || "from-blue-500 to-cyan-500"
        return (
          <Reveal key={item.title} delay={(index % 4) * 80}>
            <div className="group card-premium h-full p-6 transition-all duration-300">
              {/* Icon with gradient background */}
              <div className="relative">
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-xl", gradient, "shadow-black/10")}>
                  <Icon className="h-5 w-5" />
                </div>
                {/* Glow on hover */}
                <div className={cn("absolute inset-0 -z-10 rounded-2xl opacity-0 blur-xl transition-all duration-500 group-hover:opacity-30", `bg-gradient-to-br ${gradient}`)} />
              </div>

              <h3 className="mt-5 text-sm font-bold text-foreground transition-colors">{item.title}</h3>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{item.desc}</p>

              {/* Bottom gradient line */}
              <div className="mt-5 h-px w-0 bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 transition-all duration-700 group-hover:w-full opacity-0 group-hover:opacity-40" />
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
    <section id="trust" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-24">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading tag={c.benefits.tag} title={c.benefits.title} subtitle={c.benefits.subtitle} />
        <IconGrid items={c.benefits.items} />

        <div className="mt-24">
          <SectionHeading tag={c.trust.tag} title={c.trust.title} subtitle={c.trust.subtitle} />
          <IconGrid items={c.trust.items} />
        </div>
      </div>
    </section>
  )
}
