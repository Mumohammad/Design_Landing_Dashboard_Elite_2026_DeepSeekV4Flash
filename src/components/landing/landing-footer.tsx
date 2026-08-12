"use client"

import { Mail, Phone, MapPin, ArrowLeft, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LogoMark } from "@/components/logo"
import { FlagIcon } from "@/components/flag-icon"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"

export function LandingFooter() {
  const { t, locale, setLocale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const year = new Date().getFullYear()
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  return (
    <footer className="border-t border-border/40 bg-card/40">
      <div className="mx-auto max-w-7xl px-4 py-14 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-6">
          {/* Brand */}
          <div className="space-y-4 lg:col-span-2">
            <div className="flex items-center gap-3">
              <LogoMark size={34} />
              <div className="leading-tight">
                <p className="font-bold text-foreground">{t.app.companyNameArabic}</p>
                <p className="text-[11px] text-muted-foreground">{t.app.companyName}</p>
              </div>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{c.footer.tagline}</p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" /> {c.footer.address}
              </p>
              <a href="mailto:support@elite-dev.com" className="flex w-fit items-center gap-2 transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
                <Mail className="h-3.5 w-3.5" /> support@elite-dev.com
              </a>
              <a href="tel:+966000000000" className="flex w-fit items-center gap-2 transition-colors hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
                <Phone className="h-3.5 w-3.5" /> +966 000 000 000
              </a>
            </div>
          </div>

          {/* Columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-4">
            {c.footer.columns.map((column) => (
              <div key={column.title} className="space-y-3">
                <p className="text-sm font-bold text-foreground">{column.title}</p>
                <ul className="space-y-2">
                  {column.links.map((link) => (
                    <li key={link}>
                      <span className="cursor-default text-[13px] text-muted-foreground">{link}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            {c.footer.copyright.replace("{year}", String(year))} — {t.landing.footerRights}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="gap-2 font-semibold"
            aria-label="Toggle language"
          >
            <FlagIcon code={locale === "ar" ? "en" : "ar"} />
            {locale === "ar" ? "English" : "العربية"}
            <Arrow className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </Button>
        </div>
      </div>
    </footer>
  )
}
