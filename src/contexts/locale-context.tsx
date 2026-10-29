"use client"

import * as React from "react"
import type { Locale } from "@/lib/i18n/types"

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const defaultLocale: Locale = "ar"
const STORAGE_KEY = "elite-locale"
const localeListeners = new Set<() => void>()
// Keep switching usable when the browser blocks localStorage.
let fallbackLocale: Locale = defaultLocale
let persistenceUnavailable = false

function getLocaleSnapshot(): Locale {
  const requested = new URLSearchParams(window.location.search).get("lang")
  if (requested === "ar" || requested === "en") return requested
  if (persistenceUnavailable) return fallbackLocale
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === "ar" || saved === "en") return saved
  } catch { /* optional persistence */ }
  return fallbackLocale
}

function getServerLocaleSnapshot() {
  return defaultLocale
}

function setLocale(next: Locale) {
  fallbackLocale = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
    persistenceUnavailable = false
  } catch { persistenceUnavailable = true }
  localeListeners.forEach((listener) => listener())
}

function subscribeToLocale(onChange: () => void) {
  fallbackLocale = getLocaleSnapshot()
  localeListeners.add(onChange)
  const requested = new URLSearchParams(window.location.search).get("lang")
  if (requested === "ar" || requested === "en") {
    const url = new URL(window.location.href)
    url.searchParams.delete("lang")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    setLocale(requested)
  }

  const sync = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && (event.newValue === "ar" || event.newValue === "en")) {
      fallbackLocale = event.newValue
      persistenceUnavailable = false
      onChange()
    }
  }
  window.addEventListener("storage", sync)
  return () => {
    localeListeners.delete(onChange)
    window.removeEventListener("storage", sync)
  }
}

export const LocaleContext = React.createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = React.useSyncExternalStore(subscribeToLocale, getLocaleSnapshot, getServerLocaleSnapshot)

  React.useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr"
  }, [locale])

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}
