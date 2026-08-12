"use client"

import { cn } from "@/lib/utils"
import { Plus, Minus, Equal, Settings2, Landmark } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

export function PayrollShowcase() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="payroll" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 lg:px-8">
      <SectionHeading tag={c.payroll.tag} title={c.payroll.title} subtitle={c.payroll.subtitle} />

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* Example calculation */}
        <Reveal>
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/70 backdrop-blur-sm">
            <div className="flex items-center gap-2.5 border-b border-border/50 bg-elite-blue-500/5 px-6 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-elite-blue-500 to-elite-blue-700 text-white shadow-lg shadow-elite-blue-500/20">
                <Landmark className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-bold text-foreground">{c.payroll.calcTitle}</p>
                <p className="text-xs text-muted-foreground">450 {locale === "ar" ? "طلبًا" : "orders"} · 26 {locale === "ar" ? "يومًا" : "days"}</p>
              </div>
            </div>
            <div className="flex-1 space-y-2.5 px-6 py-5">
              {c.payroll.calcRows.map((row) => (
                <div
                  key={row.label}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl px-4 py-2.5",
                    row.strong
                      ? "bg-gradient-to-r from-elite-blue-500/10 to-elite-orange-500/10 ring-1 ring-inset ring-elite-blue-500/20"
                      : "bg-background/50"
                  )}
                >
                  <span className={cn("text-sm", row.strong ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {row.label}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-extrabold tabular-nums",
                      row.strong ? "text-elite-blue-600 dark:text-elite-blue-300" : "text-foreground"
                    )}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* Where the money goes */}
        <Reveal delay={120}>
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/50 bg-background shadow-xl shadow-elite-blue-950/5">
            <div className="flex items-center gap-2.5 border-b border-border/50 px-6 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-elite-orange-500 to-elite-orange-600 text-white shadow-lg shadow-elite-orange-500/20">
                <Settings2 className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-bold text-foreground">{c.payroll.formulaTitle}</p>
                <p className="text-xs text-muted-foreground">{c.payroll.configurable}</p>
              </div>
            </div>
            <div className="flex-1 space-y-1.5 px-6 py-5">
              {c.payroll.formulaLines.map((line) => {
                const Icon = line.kind === "plus" ? Plus : line.kind === "minus" ? Minus : Equal
                return (
                  <div
                    key={line.label}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                      line.kind === "total" && "bg-gradient-to-r from-elite-blue-500/15 to-elite-orange-500/15 ring-1 ring-inset ring-elite-blue-500/25"
                    )}
                  >
                    <span className="flex items-center gap-2.5 text-muted-foreground">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-md",
                          line.kind === "plus" && "bg-emerald-500/10 text-emerald-500",
                          line.kind === "minus" && "bg-rose-500/10 text-rose-500",
                          line.kind === "total" && "bg-elite-blue-500/15 text-elite-blue-500"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      {line.label}
                    </span>
                    <span
                      className={cn(
                        "font-bold tabular-nums",
                        line.kind === "total" ? "text-lg text-elite-blue-600 dark:text-elite-blue-300" : "text-foreground"
                      )}
                    >
                      {line.amount}
                    </span>
                  </div>
                )
              })}
            </div>
            <DemoNote>{c.payroll.note}</DemoNote>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
