"use client"

import * as React from "react"
import Link from "next/link"
import { Menu, X, ArrowLeft, ArrowRight, ArrowUpRight, Sparkles } from "lucide-react"
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
        "sticky top-0 z-50 transition-all duration-500",
        scrolled
          ? "border-b border-border/40 bg-background/80 shadow-lg shadow-elite-blue-950/5 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/60"
          : "border-b border-transparent bg-background/30 backdrop-blur-xl"
      )}
    >
      {/* Animated gradient bottom line */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 h-px transition-opacity duration-500",
          scrolled ? "opacity-100" : "opacity-0"
        )}
        style={{
          background: "linear-gradient(90deg, transparent, rgba(30,90,153,0.4) 30%, rgba(232,125,62,0.4) 70%, transparent)",
        }}
      />

      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 lg:px-8">
        <Link href="/landing" className="flex shrink-0 items-center gap-3 group" aria-label={t.app.companyNameArabic}>
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-40" />
            <LogoMark size={36} />
          </div>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-bold text-foreground">{t.app.companyNameArabic}</span>
            <span className="block text-[10px] font-medium text-muted-foreground">{t.app.tagline}</span>
          </span>
        </Link>

        {/* Desktop links */}
        <div className="mx-auto hidden items-center gap-0.5 xl:flex">
          {c.nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="relative rounded-xl px-3 py-2 text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-elite-blue-500/5 hover:text-foreground hover:shadow-sm"
            >
              {link.label}
            </a>
          ))}
          {/* Driver Registration — opens in a NEW TAB */}
          <a
            href="/driver-registration"
            target="_blank"
            rel="noopener noreferrer"
            className="ms-2 inline-flex items-center gap-1.5 rounded-xl border border-elite-blue-500/30 bg-elite-blue-500/5 px-3.5 py-2 text-[13px] font-bold text-elite-blue-600 transition-all duration-200 hover:bg-elite-blue-500/10 hover:border-elite-blue-500/50 hover:shadow-md hover:shadow-elite-blue-500/10 dark:text-elite-blue-300"
          >
            <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
            {c.nav.applyAsDriver}
          </a>
        </div>

        {/* Actions */}
        <div className="ms-auto flex items-center gap-2 xl:ms-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="gap-2 rounded-xl font-semibold transition-all duration-200 hover:bg-elite-blue-500/5"
            aria-label="Toggle language"
          >
            <FlagIcon code={locale === "ar" ? "en" : "ar"} />
            {locale === "ar" ? "EN" : "عربي"}
          </Button>
          <ModeToggle variant="ghost" />
          <Button variant="outline" size="sm" className="hidden rounded-xl sm:inline-flex" asChild>
            <Link href="/auth/sign-in">{c.nav.signIn}</Link>
          </Button>
          <Button
            size="sm"
            className="hidden rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/25 transition-all duration-300 hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-xl hover:shadow-elite-blue-500/40 hover:scale-[1.02] active:scale-[0.98] sm:inline-flex"
            asChild
          >
            <Link href="/auth/sign-in">
              <Sparkles className="h-3.5 w-3.5" />
              {c.nav.getStarted}
              <Arrow className="h-3.5 w-3.5 rtl:-scale-x-100" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl xl:hidden"
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
          "overflow-hidden border-t border-border/40 bg-background/95 backdrop-blur-2xl transition-all duration-300 xl:hidden",
          open ? "max-h-[80vh] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="mx-auto max-w-7xl space-y-1 px-4 py-4">
          {c.nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-elite-blue-500/5"
            >
              {link.label}
            </a>
          ))}
          <a
            href="/driver-registration"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-elite-blue-600 dark:text-elite-blue-300"
          >
            <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" />
            {c.nav.applyAsDriver}
          </a>
          <div className="flex gap-3 pt-4">
            <Button variant="outline" size="sm" className="flex-1 rounded-xl" asChild>
              <Link href="/auth/sign-in" onClick={() => setOpen(false)}>
                {c.nav.signIn}
              </Link>
            </Button>
            <Button
              size="sm"
              className="flex-1 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/25"
              asChild
            >
              <Link href="/auth/sign-in" onClick={() => setOpen(false)}>
                <Sparkles className="h-3.5 w-3.5" />
                {c.nav.getStarted}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
