"use client"

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
    <Card className="mb-3 py-0 border-white/10 bg-white/10 shadow-none backdrop-blur-sm">
      <CardContent className="p-4 relative">
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 h-6 w-6 p-0 text-white/50 hover:bg-white/15 hover:text-white"
          onClick={() => setIsVisible(false)}
        >
          <X className="h-3 w-3" />
          <span className="sr-only">Close notification</span>
        </Button>

        <div className="pr-6">
          <h3 className="flex items-center gap-3 font-semibold text-white mb-2 mt-1">
            <Logo size={42} className="-mt-1 rounded-xl" />
            <span className="leading-tight">
              {t.app.notifWelcome}{" "}
              <span className="text-white/90">{t.app.companyNameArabic}</span>
            </span>
          </h3>
          <p className="text-sm text-white/60 leading-relaxed">{t.app.notifBody}</p>
        </div>
      </CardContent>
    </Card>
  )
}
