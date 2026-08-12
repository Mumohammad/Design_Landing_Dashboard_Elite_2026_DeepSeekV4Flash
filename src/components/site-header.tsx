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
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center border-b border-border/50 bg-background/80 backdrop-blur-xl transition-all duration-200">
        <div className="flex w-full items-center gap-3 px-4 py-2 lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-3 h-8" />
          <div className="flex-1 min-w-0">
            <SearchTrigger onClick={() => setSearchOpen(true)} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              aria-label="Toggle language"
            >
              <FlagIcon code={locale === "ar" ? "en" : "ar"} />
              {locale === "ar" ? "EN" : "ع"}
            </Button>
            <ModeToggle />
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
