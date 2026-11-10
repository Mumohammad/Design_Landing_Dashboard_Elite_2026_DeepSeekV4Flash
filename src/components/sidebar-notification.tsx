"use client"

import { LocalizedText } from "@/components/localized-text"
import * as React from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Logo } from "./logo"
import { useTranslation } from "@/hooks/use-translation"

export function SidebarNotification() {
  const [isVisible, setIsVisible] = React.useState(true)
  const { t } = useTranslation()

  if (!isVisible) return null

  return (
    <Card className="mb-3 py-0 border-sidebar-border bg-sidebar-accent shadow-none">
      <CardContent className="p-4 relative">
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 h-6 w-6 p-0 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          onClick={() => setIsVisible(false)}
        >
          <X className="h-3 w-3" />
          <span className="sr-only"><LocalizedText text="Close notification" /></span>
        </Button>

        <div className="pr-6">
          <h3 className="flex items-center gap-3 font-semibold text-foreground mb-2 mt-1">
            <Logo size={42} className="-mt-1 rounded-xl" />
            <span className="leading-tight">
              {t.app.notifWelcome}{" "}
              <span className="text-foreground">{t.app.companyNameArabic}</span>
            </span>
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{t.app.notifBody}</p>
        </div>
      </CardContent>
    </Card>
  )
}
