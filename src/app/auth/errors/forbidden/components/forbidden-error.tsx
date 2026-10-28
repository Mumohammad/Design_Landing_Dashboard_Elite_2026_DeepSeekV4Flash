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
    <div className="mx-auto flex min-h-dvh flex-col items-center justify-center gap-8 p-8 md:gap-12 md:p-16">
      {/* Icon instead of external image — more reliable and accessible */}
      <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-red-500/15">
        <ShieldAlert className="h-12 w-12 text-red-500" />
      </div>
      <div className="text-center">
        <h1 className="mb-4 text-3xl font-bold" aria-label="403">403</h1>
        <h2 className="mb-3 text-2xl font-semibold">
          {t.errors.forbiddenTitle}
        </h2>
        <p className="text-muted-foreground">
          {t.errors.forbiddenDescription}
        </p>
        <div className="mt-6 flex items-center justify-center gap-4 md:mt-8">
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
