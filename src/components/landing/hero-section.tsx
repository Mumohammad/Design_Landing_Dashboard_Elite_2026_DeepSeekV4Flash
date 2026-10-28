"use client"

import Link from "next/link"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { REDIRECTS, withLocale } from "@/lib/redirects"
import { Reveal } from "./shared"
import { DashboardPreview } from "./dashboard-preview"

export function HeroSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  return (
    <section className="relative" aria-labelledby="landing-hero-title">
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-14 lg:px-8 lg:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="text-start">
            <Reveal>
              <h1
                id="landing-hero-title"
                className="text-4xl font-bold leading-[1.2] text-foreground sm:text-[2.75rem] xl:text-5xl"
              >
                {c.hero.headlineA} {c.hero.headlineB}
              </h1>
            </Reveal>

            <Reveal delay={80}>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground/80">
                {c.hero.subheadline}
              </p>
            </Reveal>

            <Reveal delay={160}>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  className="h-12 gap-2 rounded-md bg-elite-blue-600 px-7 text-base font-semibold text-white hover:bg-elite-blue-700"
                >
                  <Link href="#platform">
                    {c.hero.ctaPrimary}
                    <Arrow className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-12 rounded-md px-7 text-base font-semibold"
                >
                  <Link href={withLocale(REDIRECTS.signInUrl, locale)}>{c.hero.ctaSecondary}</Link>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-12 border-t border-border pt-6">
                <p className="text-sm font-semibold text-foreground">{c.hero.flowTitle}</p>
                <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-base text-foreground/80">
                  {c.hero.flow.map((step, i) => (
                    <li key={step} className="flex items-center gap-2">
                      <span>{step}</span>
                      {i < c.hero.flow.length - 1 && (
                        <Arrow aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </Reveal>
          </div>

          <Reveal delay={120}>
            <figure className="m-0">
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <DashboardPreview />
              </div>
              <figcaption className="mt-3 text-sm text-muted-foreground">{c.hero.demoLabel}</figcaption>
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
