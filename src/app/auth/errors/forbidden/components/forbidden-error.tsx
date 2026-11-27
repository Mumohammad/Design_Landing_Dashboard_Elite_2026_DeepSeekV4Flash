"use client"

import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { ShieldAlert } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { REDIRECTS } from "@/lib/redirects"

export function ForbiddenError() {
  const router = useRouter()
  const { t } = useTranslation()

  return (
    <div className="mx-auto flex w-full flex-col items-center gap-5 rounded-lg border border-border bg-card p-6 sm:p-8">
      {/* Icon instead of external image — more reliable and accessible */}
      <div className="flex h-10 w-10 items-center justify-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
      </div>
      <div className="text-center">
        <h1 className="mb-3 text-sm font-medium tabular-nums text-muted-foreground" aria-label="403">403</h1>
        <h2 className="mb-3 text-2xl font-semibold leading-snug">
          {t.errors.forbiddenTitle}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {t.errors.forbiddenDescription}
        </p>
        <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
          <Button
            className="cursor-pointer"
            onClick={() => router.push(REDIRECTS.dashboardUrl)}
            aria-label={t.errors.forbiddenGoHome}
          >
            {t.errors.forbiddenGoHome}
          </Button>
          <Button
            variant="outline"
            className="flex cursor-pointer items-center gap-1"
            onClick={() => router.push(REDIRECTS.signInUrl)}
            aria-label={t.errors.forbiddenContactUs}
          >
            {t.errors.forbiddenContactUs}
          </Button>
        </div>
      </div>
    </div>
  )
}
