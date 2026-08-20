"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { ModeToggle } from "@/components/mode-toggle"
import { FlagIcon } from "@/components/flag-icon"
import { useTranslation } from "@/hooks/use-translation"

export function SiteHeader() {
  const [searchOpen, setSearchOpen] = React.useState(false)
  const { locale, setLocale, t } = useTranslation()

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center border-b border-border/40 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/60 transition-all duration-200">
        {/* Subtle animated gradient line at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-elite-blue-500/30 to-transparent" />
        <div className="flex w-full items-center gap-3 px-4 py-2 lg:px-6">
          <SidebarTrigger className="-ml-1 hover:bg-muted/50 rounded-lg transition-colors" />
          <Separator orientation="vertical" className="mx-1 h-6 bg-border/50" />
          <div className="flex-1 min-w-0">
            <SearchTrigger onClick={() => setSearchOpen(true)} />
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 h-8 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              aria-label="Toggle language"
            >
              <FlagIcon code={locale === "ar" ? "en" : "ar"} />
              <span className="text-xs font-medium">{locale === "ar" ? "EN" : "ع"}</span>
            </Button>
            <ModeToggle />
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
