"use client"

import * as React from "react"
import type { Locale } from "@/lib/i18n/types"

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const defaultLocale: Locale = "ar"

function subscribeLocale(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== "elite-locale" || (event.newValue !== "en" && event.newValue !== "ar")) return
    document.documentElement.lang = event.newValue
    document.documentElement.dir = event.newValue === "ar" ? "rtl" : "ltr"
    onChange()
  }
  window.addEventListener("elite-locale-change", onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener("elite-locale-change", onChange)
    window.removeEventListener("storage", onStorage)
  }
}

function getLocaleSnapshot(): Locale {
  // The pre-hydration script initializes lang from a cross-host query, saved
  // preference or cookie. Reading it avoids overwriting EN with the AR default.
  return document.documentElement.lang === "en" ? "en" : "ar"
}

function persistLocale(locale: Locale) {
  document.documentElement.lang = locale
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr"
  document.cookie = `elite-locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
  try { window.localStorage.setItem("elite-locale", locale) } catch { /* Storage can be unavailable in private browsing. */ }
  window.dispatchEvent(new Event("elite-locale-change"))
}

export const LocaleContext = React.createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot, () => defaultLocale)
  const setLocale = React.useCallback((next: Locale) => { persistLocale(next) }, [])

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}
