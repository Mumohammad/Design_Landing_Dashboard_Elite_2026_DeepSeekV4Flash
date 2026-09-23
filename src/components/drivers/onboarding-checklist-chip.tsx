"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ClipboardCheck } from "lucide-react"

type ChecklistRow = {
  step_name: string
  status: string
}

/** Onboarding checklist progress chip for the driver profile header. */
export function OnboardingChecklistChip({
  driverId,
  isAr,
}: {
  driverId: string
  isAr: boolean
}) {
  const [rows, setRows] = useState<ChecklistRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await createClient()
        .from("driver_onboarding_checklists")
        .select("step_name, status")
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("step_order", { ascending: true })
      if (!cancelled) setRows((data as ChecklistRow[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null || rows.length === 0) return null

  const done = rows.filter((r) => r.status === "completed" || r.status === "skipped").length
  const total = rows.length
  const pct = Math.round((done / total) * 100)
  const complete = done === total

  return (
    <span
      title={
        isAr
          ? `اكتمال التهيئة: ${done}/${total}`
          : `Onboarding progress: ${done}/${total}`
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        complete
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      )}
    >
      <ClipboardCheck className="h-3 w-3" />
      {isAr ? "التهيئة" : "Onboarding"} {done}/{total} ({pct}%)
    </span>
  )
}

/** Overview-tab mini card listing checklist steps (optional deeper surface). */
export function OnboardingChecklistCard({
  driverId,
  isAr,
}: {
  driverId: string
  isAr: boolean
}) {
  const [rows, setRows] = useState<ChecklistRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await createClient()
        .from("driver_onboarding_checklists")
        .select("step_name, status")
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("step_order", { ascending: true })
      if (!cancelled) setRows((data as ChecklistRow[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null || rows.length === 0) return null

  const done = rows.filter((r) => r.status === "completed" || r.status === "skipped").length

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm lg:col-span-2">
      <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
        <ClipboardCheck className="h-4 w-4 text-elite-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">
          {isAr ? "قائمة التهيئة" : "Onboarding Checklist"}
        </h3>
        <span className="ms-auto text-xs font-medium text-muted-foreground">
          {done}/{rows.length}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {rows.map((r, i) => {
          const ok = r.status === "completed"
          const skipped = r.status === "skipped"
          return (
            <li key={`${r.step_name}-${i}`} className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  ok
                    ? "bg-emerald-500"
                    : skipped
                      ? "bg-muted-foreground/50"
                      : "bg-amber-500",
                )}
              />
              <span className={cn("text-foreground/90", ok && "text-muted-foreground line-through")}>
                {r.step_name}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
