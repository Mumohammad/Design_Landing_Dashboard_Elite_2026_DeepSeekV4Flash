"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading } from "./shared"

export function FaqSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const [openIndex, setOpenIndex] = React.useState<number | null>(0)

  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 lg:px-8">
      <SectionHeading tag={c.faq.tag} title={c.faq.title} subtitle={c.faq.subtitle} />

      <div className="mt-10 space-y-3">
        {c.faq.items.map((faq, index) => {
          const open = openIndex === index
          return (
            <Reveal key={faq.q} delay={Math.min(index * 40, 200)}>
              <div
                className={cn(
                  "overflow-hidden rounded-2xl border transition-all duration-300",
                  open
                    ? "border-elite-blue-500/30 bg-card shadow-lg shadow-elite-blue-500/5"
                    : "border-border/50 bg-card/70 hover:border-border"
                )}
              >
                <button
                  onClick={() => setOpenIndex(open ? null : index)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start"
                >
                  <span className="font-semibold text-foreground">{faq.q}</span>
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-300",
                      open
                        ? "rotate-180 border-elite-blue-500/40 bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300"
                        : "border-border/60 text-muted-foreground"
                    )}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </span>
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-300 ease-out",
                    open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}
