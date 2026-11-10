"use client"

import { useTheme } from "@/hooks/use-theme"
import { useTranslation } from "@/hooks/use-translation"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const { locale } = useTranslation()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      dir={locale === "ar" ? "rtl" : "ltr"}
      position={locale === "ar" ? "bottom-left" : "bottom-right"}
      containerAriaLabel={locale === "ar" ? "الإشعارات" : "Notifications"}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
