"use client"

import { FileDown } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote, iconMap } from "./shared"

const BLUE = "#1E5A99"
const ORANGE = "#E87D3E"

function TrendChart({
  labels,
  seriesA,
  seriesB,
}: {
  labels: string[]
  seriesA: number[]
  seriesB: number[]
}) {
  const w = 600
  const h = 200
  const pad = 26
  const max = 100

  const toPoints = (values: number[]) =>
    values
      .map((v, i) => {
        const x = pad + (i * (w - pad * 2)) / (values.length - 1)
        const y = h - pad - (v / max) * (h - pad * 2)
        return `${x},${y}`
      })
      .join(" ")

  const areaPath = (values: number[]) => {
    const pts = values
      .map((v, i) => {
        const x = pad + (i * (w - pad * 2)) / (values.length - 1)
        const y = h - pad - (v / max) * (h - pad * 2)
        return `${x},${y}`
      })
      .join(" ")
    return `M ${pad},${h - pad} L ${pts.replace(/ /g, " L ")} L ${w - pad},${h - pad} Z`
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Performance trend">
      <defs>
        <linearGradient id="trendA" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.35" />
          <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="trendB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ORANGE} stopOpacity="0.3" />
          <stop offset="100%" stopColor={ORANGE} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[25, 50, 75].map((g) => (
        <line
          key={g}
          x1={pad}
          x2={w - pad}
          y1={h - pad - (g / max) * (h - pad * 2)}
          y2={h - pad - (g / max) * (h - pad * 2)}
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeDasharray="3 4"
        />
      ))}
      <path d={areaPath(seriesA)} fill="url(#trendA)" />
      <path d={areaPath(seriesB)} fill="url(#trendB)" />
      <polyline
        points={toPoints(seriesA)}
        fill="none"
        stroke={BLUE}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={toPoints(seriesB)}
        fill="none"
        stroke={ORANGE}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {seriesA.map((v, i) => {
        const x = pad + (i * (w - pad * 2)) / (seriesA.length - 1)
        const y = h - pad - (v / max) * (h - pad * 2)
        return <circle key={i} cx={x} cy={y} r="3.5" fill={BLUE} strokeWidth="2" className="stroke-background" />
      })}
      {labels.map((label, i) => {
        const x = pad + (i * (w - pad * 2)) / (labels.length - 1)
        return (
          <text key={label} x={x} y={h - 6} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.55">
            {label}
          </text>
        )
      })}
    </svg>
  )
}

export function ReportingSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="reports" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-20">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading tag={c.reporting.tag} title={c.reporting.title} subtitle={c.reporting.subtitle} />

        <div className="mt-12 grid gap-6 lg:grid-cols-5">
          {/* Chart */}
          <Reveal className="lg:col-span-3">
            <div className="h-full rounded-2xl border border-border/50 bg-background p-6 text-foreground shadow-xl shadow-elite-blue-950/5 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-foreground">{c.reporting.chartTitle}</p>
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-elite-blue-500" />
                    {locale === "ar" ? "المستهدف" : "Target"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-elite-orange-500" />
                    {locale === "ar" ? "الفعلي" : "Actual"}
                  </span>
                </div>
              </div>
              <div className="mt-6">
                <TrendChart labels={c.reporting.chartLabels} seriesA={c.reporting.seriesA} seriesB={c.reporting.seriesB} />
              </div>
              <div className="mt-6 flex items-center gap-2 rounded-xl border border-elite-blue-500/20 bg-elite-blue-500/5 px-4 py-3 text-xs font-semibold text-elite-blue-600 dark:text-elite-blue-300">
                <FileDown className="h-4 w-4" />
                {c.reporting.exportLabel}
              </div>
            </div>
          </Reveal>

          {/* Report cards */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            {c.reporting.cards.map((card, index) => {
              const Icon = iconMap[card.icon]
              return (
                <Reveal key={card.title} delay={index * 80}>
                  <div className="group flex flex-1 items-start gap-4 rounded-2xl border border-border/50 bg-card/70 p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-elite-blue-500/30 hover:shadow-lg hover:shadow-elite-blue-500/10">
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

        <DemoNote>{c.reporting.note}</DemoNote>
      </div>
    </section>
  )
}
