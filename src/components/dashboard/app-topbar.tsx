"use client"

import * as React from "react"
import { Languages } from "lucide-react"

import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { LocaleContext } from "@/contexts/locale-context"

export function AppTopbar() {
  const [commandOpen, setCommandOpen] = React.useState(false)
  const localeContext = React.useContext(LocaleContext)

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const locale = localeContext?.locale ?? "ar"
  const setLocale = localeContext?.setLocale

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/95 px-4 dark:border-slate-800 dark:bg-slate-950/90 sm:px-6">
        <SidebarTrigger className="h-10 w-10 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white" />

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />

        <div className="min-w-0 flex-1">
          <SearchTrigger onClick={() => setCommandOpen(true)} />
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLocale?.(locale === "ar" ? "en" : "ar")}
            className="h-10 gap-2 rounded-xl border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label={locale === "ar" ? "Switch language to English" : "تغيير اللغة إلى العربية"}
          >
            <Languages className="h-4 w-4" />
            <span className="hidden text-sm font-semibold sm:inline">
              {locale === "ar" ? "EN" : "العربية"}
            </span>
          </Button>

          <ModeToggle variant="outline" />
        </div>
      </header>

      <CommandSearch open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  )
}
