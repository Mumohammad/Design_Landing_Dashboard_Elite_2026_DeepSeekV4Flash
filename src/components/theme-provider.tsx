"use client"

import * as React from "react"
import { ThemeProviderContext } from "@/contexts/theme-context"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme
    try {
      const storedTheme = localStorage.getItem(storageKey)
      return storedTheme === "light" || storedTheme === "dark" || storedTheme === "system" ? storedTheme : defaultTheme
    } catch {
      return defaultTheme
    }
  })

  React.useEffect(() => {
    const root = window.document.documentElement
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const applyTheme = () => {
      const resolvedTheme = theme === "system" ? (media.matches ? "dark" : "light") : theme
      root.classList.remove("light", "dark")
      root.classList.add(resolvedTheme)
      root.style.colorScheme = resolvedTheme
    }

    applyTheme()
    if (theme !== "system") return
    media.addEventListener("change", applyTheme)
    return () => media.removeEventListener("change", applyTheme)
  }, [theme])

  const value = {
    theme,
    setTheme: (nextTheme: Theme) => {
      try {
        localStorage.setItem(storageKey, nextTheme)
      } catch {
        // Theme changes still work when browser storage is unavailable.
      }
      setTheme(nextTheme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}
