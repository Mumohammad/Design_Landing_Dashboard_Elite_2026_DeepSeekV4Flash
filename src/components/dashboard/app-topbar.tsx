"use client"

import * as React from "react"
import { Languages } from "lucide-react"

import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { ModeToggle } from "@/components/mode-toggle"
import { NotificationCenter } from "@/components/dashboard/notification-center"
import { FeedbackButton } from "@/components/dashboard/feedback-dialog"
import { KeyboardShortcuts } from "@/components/dashboard/keyboard-shortcuts"
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
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
        <a href="#main-content" className="sr-only z-30 rounded-md bg-card px-3 py-2 text-sm text-foreground focus:not-sr-only focus:absolute focus:start-4 focus:ring-2 focus:ring-ring">
          {locale === "ar" ? "انتقل إلى المحتوى" : "Skip to content"}
        </a>
        <SidebarTrigger className="h-9 w-9 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" />
        <div className="min-w-0 flex-1">
          <SearchTrigger onClick={() => setCommandOpen(true)} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLocale?.(locale === "ar" ? "en" : "ar")}
            className="h-9 gap-2 px-3"
            aria-label={locale === "ar" ? "Switch language to English" : "تغيير اللغة إلى العربية"}
          >
            <Languages aria-hidden="true" className="h-4 w-4" />
            <span className="hidden text-sm font-medium sm:inline">
              {locale === "ar" ? "EN" : "العربية"}
            </span>
          </Button>

          <FeedbackButton />

          <NotificationCenter />

          <ModeToggle variant="outline" />
        </div>
      </header>
      <CommandSearch open={commandOpen} onOpenChange={setCommandOpen} />
      <KeyboardShortcuts />
    </>
  )
}
