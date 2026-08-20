"use client"

import { cn } from "@/lib/utils"
import { Sparkles } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading } from "./shared"

export function WorkflowSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  const columns: [number[], number[]] = [
    c.workflow.steps.slice(0, 5).map((_, i) => i),
    c.workflow.steps.slice(5, 10).map((_, i) => i + 5),
  ]

  return (
    <section id="workflow" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-24 lg:px-8">
      <SectionHeading tag={c.workflow.tag} title={c.workflow.title} subtitle={c.workflow.subtitle} />

      <div className="mt-14 grid gap-10 lg:grid-cols-2">
        {columns.map((indices, col) => (
          <div key={col} className="relative">
            {/* Animated gradient timeline line */}
            <div className="absolute inset-y-2 start-[1.35rem] w-px bg-gradient-to-b from-elite-blue-500/40 via-border to-elite-orange-500/40" />
            <div className="space-y-4">
              {indices.map((i) => {
                const step = c.workflow.steps[i]
                const isLast = i === c.workflow.steps.length - 1
                const isEarly = i < 3
                return (
                  <Reveal key={step.title} delay={col * 100 + i * 50}>
                    <div className="group relative flex items-start gap-4">
                      <span
                        className={cn(
                          "relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold transition-all duration-300",
                          isLast
                            ? "bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-white shadow-xl shadow-elite-orange-500/25 animate-pulse"
                            : isEarly
                              ? "border border-elite-blue-500/40 bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300 shadow-md shadow-elite-blue-500/10"
                              : "border border-border/60 bg-background text-muted-foreground shadow-sm group-hover:border-elite-blue-500/40 group-hover:text-elite-blue-600 group-hover:shadow-md dark:group-hover:text-elite-blue-300"
                        )}
                      >
                        {isLast ? <Sparkles className="h-4 w-4" /> : i + 1}
                      </span>
                      <div className="min-w-0 flex-1 card-premium px-5 py-4 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-black/5">
                        <p className="font-bold text-foreground">{step.title}</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">{step.desc}</p>
                      </div>
                    </div>
                  </Reveal>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
