"use client"

import { cn } from "@/lib/utils"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

export function PayrollShowcase() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  return (
    <section id="payroll" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-24 lg:px-8 lg:py-32">
      <SectionHeading tag={c.payroll.tag} title={locale === "ar" ? "العمل ينعكس في الراتب." : "Work becomes payroll."} subtitle={c.payroll.subtitle} />
      <div className="mt-14 grid gap-8 lg:grid-cols-2">
        <Reveal>
          <div data-ui className="h-full bg-muted p-6 sm:p-8">
            <h3 className="text-xl font-semibold">{c.payroll.calcTitle}</h3>
            <p className="mt-2 text-base">450 {locale === "ar" ? "طلبًا" : "orders"} · 26 {locale === "ar" ? "يومًا" : "days"}</p>
            <dl className="mt-7 space-y-1">{c.payroll.calcRows.map(row => <div key={row.label} className={cn("flex justify-between gap-5 px-3 py-3 text-base", row.strong && "bg-background font-semibold")}>
              <dt>{row.label}</dt>
              <dd className="shrink-0 tabular-nums">{row.value}</dd>
            </div>)}</dl>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div data-ui className="h-full bg-elite-blue-950 p-6 text-white sm:p-8">
            <h3 className="text-xl font-semibold">{c.payroll.formulaTitle}</h3>
            <p className="mt-3 text-base leading-relaxed text-white/80">{c.payroll.configurable}</p>
            <dl className="mt-7 space-y-1">{c.payroll.formulaLines.map(line => <div key={line.label} className={cn("flex items-center justify-between gap-5 px-3 py-3 text-base", line.kind === "total" && "bg-white font-semibold text-elite-blue-950")}>
              <dt>{line.label}</dt>
              <dd className="shrink-0 tabular-nums">{line.amount}</dd>
            </div>)}</dl>
            <DemoNote dark>{c.payroll.note}</DemoNote>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
