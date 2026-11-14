"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

function TrendChart({ labels, seriesA, seriesB, label }: { labels: string[]; seriesA: number[]; seriesB: number[]; label: string }) {
  const width = 600, height = 240, pad = 32
  const points = (values: number[]) => values.map((value, index) => `${pad + index * (width - pad * 2) / (values.length - 1)},${height - pad - value / 100 * (height - pad * 2)}`).join(" ")
  return <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={label}>
    <polyline points={points(seriesA)} fill="none" stroke="currentColor" strokeWidth="3" className="text-elite-blue-500" />
    <polyline points={points(seriesB)} fill="none" stroke="currentColor" strokeWidth="3" className="text-elite-orange-500" />{labels.map((month, index) => <text key={month} x={pad + index * (width - pad * 2) / (labels.length - 1)} y={height - 7} textAnchor="middle" fontSize="14" fill="currentColor">{month}</text>)}</svg>
}

export function ReportingSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const target = locale === "ar" ? "المستهدف" : "Target"
  const actual = locale === "ar" ? "الفعلي" : "Actual"
  return (
    <section id="reports" className="scroll-mt-8 bg-muted py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHeading tag={c.reporting.tag} title={locale === "ar" ? "تقارير تجيب بوضوح." : "Reports with answers."} subtitle={c.reporting.subtitle} />
        <div className="mt-14 grid items-start gap-10 lg:grid-cols-[1.2fr_.8fr]">
          <Reveal direction="scale">
            <div data-ui className="bg-background p-6 sm:p-8">
              <h3 className="text-xl font-semibold">{c.reporting.chartTitle}</h3>
              <div className="mt-5 flex gap-6 text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 bg-elite-blue-500" />{target}</span>
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 bg-elite-orange-500" />{actual}</span>
              </div>
              <div className="mt-6">
                <TrendChart labels={c.reporting.chartLabels} seriesA={c.reporting.seriesA} seriesB={c.reporting.seriesB} label={`${c.reporting.chartTitle}: ${target} ${c.reporting.seriesA.join(", ")}; ${actual} ${c.reporting.seriesB.join(", ")}`} />
              </div>
              <p className="mt-6 text-sm">{c.reporting.exportLabel}</p>
            </div>
          </Reveal>
          <dl className="space-y-8">{c.reporting.cards.map((card, index) => <Reveal key={card.title} delay={index * 80}>
            <dt className="text-2xl font-medium tracking-tight">{card.title}</dt>
            <dd className="mt-3 text-base leading-relaxed">{card.desc}</dd>
          </Reveal>)}</dl>
        </div>
        <DemoNote>{c.reporting.note}</DemoNote>
      </div>
    </section>
  )
}
