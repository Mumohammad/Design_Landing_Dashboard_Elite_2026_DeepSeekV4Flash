"use client"

import { useState } from "react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading } from "./shared"

const defaultAmounts = landingContent.en.cost.costRows.filter(row => row.kind !== "total").map(row => row.amount.replace(/[^0-9.]/g, ""))

export function CostControl() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const [amounts, setAmounts] = useState(defaultAmounts)
  const rows = c.cost.costRows.filter(row => row.kind !== "total")
  const total = amounts.reduce((sum, value) => sum + (value === "" ? 0 : Number(value)), 0)
  const currency = locale === "ar" ? "ر.س" : "SAR"
  function changeAmount(index: number, value: string) {
    const parsed = value === "" ? 0 : Number(value)
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(Math.round(parsed * 100))) return
    const next = amounts.map((amount, i) => i === index ? value : amount)
    if (Number.isFinite(next.reduce((sum, amount) => sum + Number(amount), 0))) setAmounts(next)
  }
  return (
    <section id="cost" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-24 lg:px-8 lg:py-32">
      <SectionHeading tag={c.cost.tag} title={locale === "ar" ? "اعرف التكلفة الحقيقية." : "Know the true cost."} subtitle={c.cost.subtitle} />
      <div className="mt-14 grid items-start gap-10 lg:grid-cols-[1.05fr_.95fr]">
        <Reveal>
          <div className="bg-muted p-6 sm:p-8">
            <h3 className="text-xl font-semibold">{c.cost.costTitle}</h3>
            <p id="landing-cost-help" className="mt-3 text-base leading-relaxed">{locale === "ar" ? "تقدير توضيحي. عدّل القيم بالريال السعودي لحساب المجموع." : "Illustrative estimate. Edit the values in SAR to calculate the total."}</p>
            <div data-ui className="mt-7">
              <div className="space-y-4">{rows.map((row, index) => <div key={row.label} className="grid grid-cols-[1fr_8rem] items-center gap-4">
                <label htmlFor={`landing-cost-${index}`} className="text-base">{row.label}</label>
                <input id={`landing-cost-${index}`} type="number" min="0" step="0.01" inputMode="decimal" value={amounts[index]} onChange={event => changeAmount(index, event.target.value)} aria-describedby="landing-cost-help" className="min-h-12 w-full border border-border bg-background px-3 text-end text-base tabular-nums outline-offset-2 focus-visible:outline-2 focus-visible:outline-elite-blue-500" />
              </div>)}</div>
              <div className="mt-7 bg-elite-blue-950 p-5 text-white">
                <p className="text-base">{c.cost.result}</p>
                <output className="mt-3 block text-[clamp(2.5rem,5vw,4.5rem)] font-medium leading-none tracking-tight tabular-nums" aria-live="polite" aria-label={c.cost.result} htmlFor={rows.map((_, index) => `landing-cost-${index}`).join(" ")}>{total.toLocaleString(locale === "ar" ? "ar-SA" : "en-US", { maximumFractionDigits: 2 })}<span className="ms-3 text-base tracking-normal">{currency}</span>
                </output>
              </div>
              <button type="button" onClick={() => setAmounts([...defaultAmounts])} className="mt-5 min-h-11 text-sm font-semibold underline underline-offset-4 transition-opacity hover:opacity-65">{locale === "ar" ? "استعادة المثال" : "Reset example"}</button>
            </div>
          </div>
        </Reveal>
        <div className="space-y-9">{c.cost.cards.map((card, index) => <Reveal key={card.title} delay={index * 80}>
          <div>
            <h3 className="text-2xl font-medium tracking-tight">{card.title}</h3>
            <p className="mt-3 max-w-[48ch] text-base leading-relaxed">{card.desc}</p>
          </div>
        </Reveal>)}<Reveal delay={240}>
            <p className="text-base leading-relaxed text-muted-foreground">{c.cost.note}</p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
