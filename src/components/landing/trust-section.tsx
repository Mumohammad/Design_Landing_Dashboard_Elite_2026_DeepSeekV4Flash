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
        const gradient = iconGradients[item.icon] || "bg-transparent text-elite-blue-600! dark:text-elite-blue-300! shadow-none h-auto! w-auto! justify-start! rounded-none"
        return (
          <Reveal key={item.title} delay={(index % 4) * 80}>
            <div className="group card-premium h-full p-6 transition-all duration-300">
              {/* Icon with gradient background */}
              <div className="relative">
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl text-white transition-all duration-300 group-hover:scale-110", gradient, "")}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>

              <h3 className="mt-5 text-lg font-semibold text-foreground transition-colors">{item.title}</h3>
              <p className="mt-2.5 text-base leading-relaxed text-foreground/75">{item.desc}</p>

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
