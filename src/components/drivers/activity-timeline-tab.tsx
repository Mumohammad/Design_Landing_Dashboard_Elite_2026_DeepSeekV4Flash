"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type ActivityTimelineTabProps = { driverId: string; isAr: boolean }

const CATEGORY_STYLES: Record<string, { ar: string; en: string; className: string; dot: string }> = {
  profile: {
    ar: "الملف",
    en: "Profile",
    className: "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
    dot: "bg-elite-blue-500",
  },
  document: {
    ar: "مستند",
    en: "Document",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    dot: "bg-purple-500",
  },
  cod: {
    ar: "COD",
    en: "COD",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  violation: {
    ar: "مخالفة",
    en: "Violation",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
  leave: {
    ar: "إجازة",
    en: "Leave",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  assignment: {
    ar: "تعيين",
    en: "Assignment",
    className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    dot: "bg-cyan-500",
  },
  compliance: {
    ar: "امتثال",
    en: "Compliance",
    className: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    dot: "bg-orange-500",
  },
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ")
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ActivityTimelineTab({ driverId, isAr }: ActivityTimelineTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_activity_log")
        .select("id, occurred_at, category, action, description, actor")
        .eq("driver_id", driverId)
        .order("occurred_at", { ascending: false })
        .limit(50)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
        <p className="text-sm text-muted-foreground">
          {isAr ? "لا يوجد نشاط مسجل بعد" : "No activity recorded yet"}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-5 backdrop-blur-sm">
      <ol className="relative space-y-5 border-s border-border/60 ps-5">
        {rows.map((r) => {
          const cat = CATEGORY_STYLES[String(r.category ?? "profile")] ?? {
            ar: String(r.category ?? "—"),
            en: String(r.category ?? "—"),
            className: "bg-muted text-muted-foreground",
            dot: "bg-muted-foreground",
          }
          return (
            <li key={String(r.id)} className="relative">
              <span
                className={cn(
                  "absolute -start-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card",
                  cat.dot,
                )}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cat.className}>{isAr ? cat.ar : cat.en}</Badge>
                <span className="text-sm font-semibold text-foreground">
                  {String(r.action ?? "—")}
                </span>
                <span className="ms-auto text-xs tabular-nums text-muted-foreground" dir="ltr">
                  {formatWhen(r.occurred_at ? String(r.occurred_at) : null)}
                </span>
              </div>
              {r.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{String(r.description)}</p>
              ) : null}
              {r.actor ? (
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  {isAr ? "بواسطة" : "by"} {String(r.actor)}
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
