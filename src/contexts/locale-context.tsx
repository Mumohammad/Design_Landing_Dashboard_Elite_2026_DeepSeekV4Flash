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
  const [locale, setLocale] = React.useState<Locale>(defaultLocale)

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const storedLocale = window.localStorage.getItem("elite-locale") as Locale | null
    if (storedLocale === "ar" || storedLocale === "en") {
      setLocale(storedLocale)
    }
  }, [])

  React.useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.lang = locale
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr"
    window.localStorage.setItem("elite-locale", locale)
  }, [locale])

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}
