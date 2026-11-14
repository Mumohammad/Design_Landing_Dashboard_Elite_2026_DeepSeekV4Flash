"use client"

import Image from "next/image"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { formatNum, Reveal, SectionHeading, DemoNote } from "./shared"

export function OperationsSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  function kpiValue(value: string) { const percent = value.endsWith("%"); return `${formatNum(Number(value.replace(/[, %]/g, "")), locale)}${percent ? "%" : ""}` }
  return (
    <section id="operations" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-24 lg:px-8 lg:py-32">
      <SectionHeading tag={c.operations.tag} title={locale === "ar" ? "صورة التشغيل اليومية." : "The daily operating view."} subtitle={c.operations.subtitle} />
      <div data-ui className="mt-14 grid grid-cols-2 gap-x-8 gap-y-8 bg-elite-blue-950 p-6 text-white sm:p-8 lg:grid-cols-4">{c.operations.kpis.map((kpi, index) => <Reveal key={kpi.label} delay={index * 80}>
        <p className="text-[clamp(2.5rem,4.7vw,4.5rem)] font-medium leading-none tracking-tight tabular-nums">{kpiValue(kpi.value)}</p>
        <p className="mt-4 text-base">{kpi.label}</p>
      </Reveal>)}</div>
      <div className="mt-8 grid items-stretch gap-8 lg:grid-cols-[1.2fr_.8fr]">
        <Reveal>
          <div data-ui className="h-full bg-muted p-5 sm:p-8">
            <h3 className="text-xl font-semibold">{c.operations.tableTitle}</h3>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[480px] text-start text-sm">
                <thead>
                  <tr className="text-muted-foreground">{c.operations.tableHeaders.map(header => <th key={header} className="py-3 pe-5 text-start font-medium">{header}</th>)}</tr>
                </thead>
                <tbody>{c.operations.tableRows.map(row => <tr key={row.driver}>
                  <td className="py-4 pe-5 font-medium">{row.driver}</td>
                  <td className="py-4 pe-5 tabular-nums">{row.productivity}</td>
                  <td className="py-4 pe-5 tabular-nums">{row.attendance}</td>
                  <td className="py-4">
                    <span className="bg-background px-2 py-1">{row.status}</span>
                  </td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>
        </Reveal>
        <Reveal delay={100} direction="scale">
          <figure className="h-full">
            <Image src="/Banner.png" alt={c.operations.droneCaption} width={1024} height={1024} className="aspect-square w-full object-cover lg:h-full" sizes="(min-width: 1024px) 40vw, 100vw" />
            <figcaption className="mt-3 text-sm text-muted-foreground">{c.operations.droneCaption}</figcaption>
          </figure>
        </Reveal>
      </div>
      <DemoNote>{c.operations.note}</DemoNote>
    </section>
  )
}
