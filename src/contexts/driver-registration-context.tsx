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
  const [locale, setLocaleState] = React.useState<RegistrationLocale>("en")
  const [data, setData] = React.useState<ApplicationData>(emptyData)

  // Restore saved locale after mount (SSR safe default: en).
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as RegistrationLocale | null
      if (saved && saved in registrationDictionaries) setLocaleState(saved)
    } catch {
      /* ignore */
    }
  }, [])

  const setLocale = React.useCallback((next: RegistrationLocale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  // Apply dir + lang to <html>. The root layout defaults to rtl/ar; the
  // registration portal owns the document direction while it is mounted.
  React.useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.lang = locale
    document.documentElement.dir = registrationLocaleMeta[locale].dir
    // Persist for a hard refresh on this page.
    try {
      window.localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      /* ignore */
    }
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
    [locale, setLocale, data, patch, reset]
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
