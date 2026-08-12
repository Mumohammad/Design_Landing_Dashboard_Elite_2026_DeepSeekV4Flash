"use client"

import * as React from "react"
import { LocaleContext } from "@/contexts/locale-context"

export interface SidebarConfig {
  variant: "sidebar" | "floating" | "inset"
  collapsible: "offcanvas" | "icon" | "none"
  side: "left" | "right"
}

export interface SidebarContextValue {
  config: SidebarConfig
  updateConfig: (config: Partial<SidebarConfig>) => void
}

export const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function localeDefaultSide(locale: string): "left" | "right" {
  return locale === "ar" ? "right" : "left"
}

export function SidebarConfigProvider({ children }: { children: React.ReactNode }) {
  const localeContext = React.useContext(LocaleContext)
  const locale = localeContext?.locale ?? "ar"

  // True once the user explicitly picks a side in the theme customizer.
  // After that the sidebar stays where the user put it.
  const manualSide = React.useRef<"left" | "right" | null>(null)

  const [config, setConfig] = React.useState<SidebarConfig>({
    variant: "inset",
    collapsible: "offcanvas",
    side: localeDefaultSide(locale),
  })

  // Keep the sidebar anchored to the reading-start side (right in Arabic/RTL,
  // left in English/LTR) unless the user has explicitly overridden it.
  React.useEffect(() => {
    if (manualSide.current) return
    setConfig((prev) => ({
      ...prev,
      side: localeDefaultSide(locale),
    }))
  }, [locale])

  const updateConfig = React.useCallback((newConfig: Partial<SidebarConfig>) => {
    if (newConfig.side) {
      manualSide.current = newConfig.side
    }
    setConfig((prev) => ({ ...prev, ...newConfig }))
  }, [])

  return (
    <SidebarContext.Provider value={{ config, updateConfig }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebarConfig() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebarConfig must be used within a SidebarConfigProvider")
  }
  return context
}
