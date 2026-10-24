"use client"

import * as React from "react"
import {
  registrationDictionaries,
  registrationLocaleMeta,
  type RegistrationDictionary,
  type RegistrationLocale,
} from "@/lib/driver-registration/i18n"
import type {
  ContactValues,
  DocumentsValues,
  IdentityValues,
  LicenseValues,
  PersonalValues,
  PlatformsValues,
  VehicleValues,
  WorkValues,
} from "@/lib/driver-registration/schema"

const STORAGE_KEY = "elite-registration-locale"
const defaultLocale: RegistrationLocale = "en"
const localeListeners = new Set<() => void>()
let fallbackLocale: RegistrationLocale = defaultLocale
let persistenceUnavailable = false

function getLocaleSnapshot(): RegistrationLocale {
  if (persistenceUnavailable) return fallbackLocale
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved && Object.prototype.hasOwnProperty.call(registrationDictionaries, saved)) return saved as RegistrationLocale
  } catch { /* optional persistence */ }
  return fallbackLocale
}

function getServerLocaleSnapshot() {
  return defaultLocale
}

function setLocale(next: RegistrationLocale) {
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
  const sync = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && event.newValue && Object.prototype.hasOwnProperty.call(registrationDictionaries, event.newValue)) {
      fallbackLocale = event.newValue as RegistrationLocale
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

export type ApplicationData = {
  personal: PersonalValues | null
  contact: ContactValues | null
  identity: IdentityValues | null
  license: LicenseValues | null
  work: WorkValues | null
  platforms: PlatformsValues | null
  vehicle: VehicleValues | null
  documents: DocumentsValues | null
  profilePhotoPath: string
  consentTerms: boolean
  consentPrivacy: boolean
}

const emptyData: ApplicationData = {
  personal: null,
  contact: null,
  identity: null,
  license: null,
  work: null,
  platforms: null,
  vehicle: null,
  documents: null,
  profilePhotoPath: "",
  consentTerms: false,
  consentPrivacy: false,
}

interface DriverRegistrationContextValue {
  locale: RegistrationLocale
  setLocale: (locale: RegistrationLocale) => void
  dir: "rtl" | "ltr"
  dict: RegistrationDictionary
  data: ApplicationData
  patch: (partial: Partial<ApplicationData>) => void
  reset: () => void
}

const DriverRegistrationContext = React.createContext<DriverRegistrationContextValue | null>(null)

export function DriverRegistrationProvider({ children }: { children: React.ReactNode }) {
  const locale = React.useSyncExternalStore(subscribeToLocale, getLocaleSnapshot, getServerLocaleSnapshot)
  const [data, setData] = React.useState<ApplicationData>(emptyData)

  // Apply dir + lang to <html>. The root layout defaults to rtl/ar; the
  // registration portal owns the document direction while it is mounted.
  React.useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.lang = locale
    document.documentElement.dir = registrationLocaleMeta[locale].dir
  }, [locale])

  const patch = React.useCallback((partial: Partial<ApplicationData>) => {
    setData((prev) => ({ ...prev, ...partial }))
  }, [])

  const reset = React.useCallback(() => setData(emptyData), [])

  const value = React.useMemo<DriverRegistrationContextValue>(
    () => ({
      locale,
      setLocale,
      dir: registrationLocaleMeta[locale].dir,
      dict: registrationDictionaries[locale],
      data,
      patch,
      reset,
    }),
    [locale, data, patch, reset]
  )

  return (
    <DriverRegistrationContext.Provider value={value}>{children}</DriverRegistrationContext.Provider>
  )
}

export function useDriverRegistration(): DriverRegistrationContextValue {
  const ctx = React.useContext(DriverRegistrationContext)
  if (!ctx) throw new Error("useDriverRegistration must be used within DriverRegistrationProvider")
  return ctx
}
