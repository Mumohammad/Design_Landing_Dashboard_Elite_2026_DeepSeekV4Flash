"use client"

import * as React from "react"
import Link from "next/link"
import { Menu, X, ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LogoMark } from "@/components/logo"
import { FlagIcon } from "@/components/flag-icon"
import { ModeToggle } from "@/components/mode-toggle"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"

export function LandingHeader() {
  const { t, locale, setLocale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const [open, setOpen] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-all duration-300",
        scrolled
          ? "border-border/60 bg-background/85 shadow-sm shadow-elite-blue-950/5 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70"
          : "border-transparent bg-background/40 backdrop-blur-md"
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 lg:px-8">
        <Link href="/landing" className="flex shrink-0 items-center gap-2.5" aria-label={t.app.companyNameArabic}>
          <LogoMark size={34} />
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-bold text-foreground">{t.app.companyNameArabic}</span>
            <span className="block text-[10px] text-muted-foreground">{t.app.tagline}</span>
          </span>
        </Link>

        {/* Desktop links */}
        <div className="mx-auto hidden items-center gap-0.5 xl:flex">
          {c.nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          {/* Driver Registration — opens in a NEW TAB; the marketing tab stays. */}
          <a
            href="/driver-registration"
            target="_blank"
            rel="noopener noreferrer"
            className="ms-1.5 inline-flex items-center gap-1.5 rounded-lg border border-elite-blue-500/40 bg-elite-blue-500/5 px-3 py-2 text-[13px] font-bold text-elite-blue-600 transition-colors hover:bg-elite-blue-500/10 dark:text-elite-blue-300"
          >
            <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
            {c.nav.applyAsDriver}
          </a>
        </div>

        {/* Actions */}
        <div className="ms-auto flex items-center gap-1.5 xl:ms-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="gap-2 font-semibold"
            aria-label="Toggle language"
          >
            <FlagIcon code={locale === "ar" ? "en" : "ar"} />
            {locale === "ar" ? "EN" : "عربي"}
          </Button>
          <ModeToggle variant="ghost" />
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild>
            <Link href="/auth/sign-in">{c.nav.signIn}</Link>
          </Button>
          <Button
            size="sm"
            className="hidden bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/20 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40 sm:inline-flex"
            asChild
          >
            <Link href="/auth/sign-in">
              {c.nav.getStarted}
              <Arrow className="h-3.5 w-3.5 rtl:-scale-x-100" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {/* Mobile menu */}
      <div
        id="landing-mobile-menu"
        className={cn(
          "overflow-hidden border-t border-border/40 bg-background/95 backdrop-blur-xl transition-all duration-300 xl:hidden",
          open ? "max-h-[80vh] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="mx-auto max-w-7xl space-y-0.5 px-4 py-4">
          {c.nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              {link.label}
            </a>
          ))}
          <a
            href="/driver-registration"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-bold text-elite-blue-600 dark:text-elite-blue-300"
          >
            <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" />
            {c.nav.applyAsDriver}
          </a>
          <div className="flex gap-2 pt-3">
            <Button variant="outline" size="sm" className="flex-1" asChild>
              <Link href="/auth/sign-in" onClick={() => setOpen(false)}>
                {c.nav.signIn}
              </Link>
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/20"
              asChild
            >
              <Link href="/auth/sign-in" onClick={() => setOpen(false)}>
                {c.nav.getStarted}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
