"use client"

import { cn } from "@/lib/utils"
import { Plus, Equal } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, iconMap } from "./shared"

export function CostControl() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="cost" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 lg:px-8">
      <SectionHeading tag={c.cost.tag} title={c.cost.title} subtitle={c.cost.subtitle} />

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* Cost per driver breakdown */}
        <Reveal>
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/50 bg-card">
            <div className="border-b border-border/50 px-6 py-4">
              <p className="text-sm font-bold text-foreground">{c.cost.costTitle}</p>
              <p className="text-xs text-muted-foreground">{c.cost.result}</p>
            </div>
            <div className="flex-1 space-y-2.5 px-6 py-5">
              {c.cost.costRows.map((row) => {
                const Icon = row.kind === "plus" ? Plus : Equal
                const isTotal = row.kind === "total"
                return (
                  <div
                    key={row.label}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl px-4 py-2.5",
                      isTotal &&
                        "bg-gradient-to-r from-elite-blue-500/10 to-elite-orange-500/10 ring-1 ring-inset ring-elite-blue-500/20"
                    )}
                  >
                    <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-md",
                          isTotal
                            ? "bg-elite-blue-500/15 text-elite-blue-500"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      {row.label}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-extrabold tabular-nums",
                        isTotal ? "text-elite-blue-600 dark:text-elite-blue-300" : "text-foreground"
                      )}
                    >
                      {row.amount}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="border-t border-border/40 px-6 py-4 text-[13px] leading-relaxed text-muted-foreground">
              {c.cost.note}
            </p>
          </div>
        </Reveal>

        {/* Value cards */}
        <div className="flex flex-col gap-4">
          {c.cost.cards.map((card, index) => {
            const Icon = iconMap[card.icon]
            return (
              <Reveal key={card.title} delay={index * 80}>
                <div className="group flex items-start gap-4 rounded-2xl border border-border/50 bg-card p-5 transition-all duration-300 hover:border-elite-blue-500/40 hover:shadow-lg hover:shadow-elite-blue-500/10">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-elite-blue-500/10 to-elite-orange-500/10 text-elite-blue-600 transition-transform duration-300 group-hover:scale-110 dark:text-elite-blue-300">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-foreground">{card.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{card.desc}</p>
                  </div>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
