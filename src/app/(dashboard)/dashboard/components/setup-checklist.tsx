"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2, Circle, Rocket, X, ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useTranslation } from "@/hooks/use-translation"
import { getSetupProgress } from "@/lib/onboarding/setup"
import type { SetupProgress } from "@/lib/onboarding/setup-utils"
import { cn } from "@/lib/utils"

const DISMISS_KEY = "elite-setup-checklist-dismissed"

/** "Getting started" card for new tenants; hides once complete or dismissed. */
export function SetupChecklist() {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const [progress, setProgress] = React.useState<SetupProgress | null>(null)
  const [dismissed, setDismissed] = React.useState(true)

  React.useEffect(() => {
    let alive = true
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1")
    } catch {
      setDismissed(false)
    }
    getSetupProgress()
      .then((p) => alive && setProgress(p))
      .catch(() => alive && setProgress(null))
    return () => {
      alive = false
    }
  }, [])

  if (dismissed || !progress || progress.completed >= progress.total) return null

  const pct = Math.round((progress.completed / progress.total) * 100)
  const Arrow = ar ? ChevronLeft : ChevronRight
  const next = progress.steps.find((s) => !s.done)

  return (
    <section
      data-testid="setup-checklist"
      className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-sky-50/60 p-5 shadow-sm dark:border-slate-800 dark:from-slate-950 dark:to-sky-950/20"
      aria-labelledby="setup-checklist-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white">
            <Rocket className="h-5 w-5" />
          </span>
          <div>
            <h2 id="setup-checklist-title" className="text-base font-semibold">
              {ar ? "ابدأ إعداد منشأتك" : "Get your workspace ready"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {ar
                ? `أكملت ${progress.completed} من ${progress.total} خطوات`
                : `${progress.completed} of ${progress.total} steps complete`}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={ar ? "إخفاء قائمة الإعداد" : "Hide setup checklist"}
          onClick={() => {
            setDismissed(true)
            try {
              window.localStorage.setItem(DISMISS_KEY, "1")
            } catch {
              /* ignore */
            }
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Progress value={pct} className="mt-4 h-2" aria-label={ar ? "نسبة الإعداد" : "Setup progress"} />

      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {progress.steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className={cn(
                "flex h-full items-start gap-2 rounded-xl border p-3 text-sm transition-colors",
                step.done
                  ? "border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                  : "border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800",
                next?.key === step.key && "ring-2 ring-sky-400/60",
              )}
            >
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block font-medium", step.done && "line-through opacity-70")}>
                  {ar ? step.titleAr : step.titleEn}
                </span>
                {!step.done && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{ar ? step.hintAr : step.hintEn}</span>
                )}
              </span>
              {!step.done && <Arrow className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
