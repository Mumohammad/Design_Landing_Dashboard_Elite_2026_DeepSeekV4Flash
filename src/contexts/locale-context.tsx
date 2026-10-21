"use client"

import * as React from "react"
import type { Locale } from "@/lib/i18n/types"

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const defaultLocale: Locale = "ar"

export const LocaleContext = React.createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = React.useState<Locale>(defaultLocale)

  const setLocale = React.useCallback((next: Locale) => {
    updateLocale(next)
    document.documentElement.lang = next
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr"
    // Storage can be unavailable in private/embedded browsers. Switching the
    // current interface must still work even when persistence is unavailable.
    try { window.localStorage.setItem("elite-locale", next) } catch { /* optional persistence */ }
  }, [])

  React.useEffect(() => {
    if (typeof window === "undefined") return

    let saved: string | null = null
    try { saved = window.localStorage.getItem("elite-locale") } catch { /* optional persistence */ }
    const requested = new URLSearchParams(window.location.search).get("lang")
    const next = requested === "ar" || requested === "en" ? requested : saved
    setLocale(next === "en" ? "en" : defaultLocale)
    if (requested === "ar" || requested === "en") {
      const url = new URL(window.location.href)
      url.searchParams.delete("lang")
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    }

    const sync = (event: StorageEvent) => {
      if (event.key === "elite-locale" && (event.newValue === "ar" || event.newValue === "en")) {
        updateLocale(event.newValue)
        document.documentElement.lang = event.newValue
        document.documentElement.dir = event.newValue === "ar" ? "rtl" : "ltr"
      }
    }
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [setLocale])

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}
