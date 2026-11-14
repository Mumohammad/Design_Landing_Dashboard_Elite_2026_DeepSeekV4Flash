"use client"

import { useState } from "react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"
import { DashboardPreview } from "./dashboard-preview"

export function PlatformOverview() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const [query, setQuery] = useState("")
  const modules = c.modules.items.filter(module => `${module.title} ${module.desc}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return (
    <section id="platform" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-24 lg:px-8 lg:py-32">
      <SectionHeading tag={c.modules.tag} title={locale === "ar" ? "كل السجلات، مترابطة." : "Every record, connected."} subtitle={c.modules.subtitle} />
      <div className="mt-12">
        <label htmlFor="landing-module-search" className="sr-only">{locale === "ar" ? "ابحث في وحدات المنصة" : "Search platform modules"}</label>
        <input id="landing-module-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={locale === "ar" ? "ابحث في المنصة" : "Find a module"} className="h-20 w-full bg-muted px-5 text-2xl font-medium tracking-tight outline-offset-4 placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-elite-blue-500 sm:text-3xl" />
        <div className="mt-6 grid gap-x-12 lg:grid-cols-2">
          {modules.map((module, index) => <Reveal key={module.title} delay={(index % 2) * 70}>
            <div className="grid gap-2 py-5 sm:grid-cols-[.6fr_1fr] sm:gap-6">
              <h3 className="text-2xl font-medium tracking-tight sm:text-3xl">{module.title}</h3>
              <p className="text-base leading-relaxed">{module.desc}</p>
            </div>
          </Reveal>)}
        </div>
        {modules.length === 0 && <p role="status" className="py-8 text-lg">{locale === "ar" ? "لا توجد وحدة مطابقة." : "No matching modules."}</p>}
      </div>
      <Reveal className="mt-16" direction="scale">
        <DashboardPreview />
      </Reveal>
      <DemoNote>{c.preview.note}</DemoNote>
    </section>
  )
}
