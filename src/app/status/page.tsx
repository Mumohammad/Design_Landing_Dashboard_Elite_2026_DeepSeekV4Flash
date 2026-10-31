"use client"

// Public status page: live probe of /api/health (app, database, auth).
// No authentication and no tenant data — only component status and latency.

import * as React from "react"
import Link from "next/link"
import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react"

type Check = { status: string; latencyMs?: number }
type Health = { status: string; timestamp: string; version?: string; checks: Record<string, Check> }

const COMPONENTS: { key: string; ar: string; en: string }[] = [
  { key: "app", ar: "التطبيق", en: "Application" },
  { key: "database", ar: "قاعدة البيانات", en: "Database" },
  { key: "auth", ar: "تسجيل الدخول", en: "Authentication" },
]

const REFRESH_MS = 60_000

function tone(status: string | undefined) {
  if (status === "ok" || status === "healthy") return { icon: CheckCircle2, cls: "text-emerald-600", ar: "يعمل", en: "Operational" }
  if (status === "degraded") return { icon: AlertTriangle, cls: "text-amber-600", ar: "أداء منخفض", en: "Degraded" }
  return { icon: XCircle, cls: "text-red-600", ar: "متوقف", en: "Outage" }
}

export default function StatusPage() {
  const [health, setHealth] = React.useState<Health | null>(null)
  const [error, setError] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  const probe = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/health", { cache: "no-store" })
      const body = (await res.json()) as Health
      setHealth(body)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void probe()
    const t = window.setInterval(() => void probe(), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [probe])

  const overall = error ? tone("down") : tone(health?.status)
  const OverallIcon = overall.icon

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 dark:bg-slate-950" dir="rtl">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Activity className="h-6 w-6 text-sky-600" />
            حالة الخدمة <span className="text-base font-normal text-muted-foreground">/ System status</span>
          </h1>
          <button type="button" onClick={() => void probe()} className="rounded-lg border bg-white p-2 dark:bg-slate-900" aria-label="تحديث / Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <section className="flex items-center gap-3 rounded-2xl border bg-white p-5 dark:bg-slate-900" aria-live="polite">
          <OverallIcon className={`h-8 w-8 ${overall.cls}`} />
          <div>
            <p className="text-lg font-semibold">
              {error ? "تعذر الوصول إلى الخدمة" : health?.status === "healthy" ? "جميع الأنظمة تعمل" : `${overall.ar}`}
            </p>
            <p className="text-sm text-muted-foreground">
              {error ? "Service unreachable" : health?.status === "healthy" ? "All systems operational" : overall.en}
            </p>
          </div>
        </section>

        <section className="divide-y rounded-2xl border bg-white dark:bg-slate-900">
          {COMPONENTS.map((c) => {
            const check = health?.checks?.[c.key]
            const t = error ? tone("down") : tone(check?.status)
            const Icon = t.icon
            return (
              <div key={c.key} className="flex items-center justify-between p-4">
                <span className="font-medium">
                  {c.ar} <span className="text-sm font-normal text-muted-foreground">/ {c.en}</span>
                </span>
                <span className={`flex items-center gap-2 text-sm ${t.cls}`}>
                  {check?.latencyMs !== undefined && <span className="text-xs text-muted-foreground" dir="ltr">{check.latencyMs} ms</span>}
                  <Icon className="h-4 w-4" />
                  {t.ar}
                </span>
              </div>
            )
          })}
        </section>

        <p className="text-center text-xs text-muted-foreground">
          {health?.timestamp ? <>آخر فحص / Last checked: <span dir="ltr">{new Date(health.timestamp).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}</span> (Riyadh) · </> : null}
          يتحدث تلقائياً كل دقيقة · <Link href="/help" className="underline">المساعدة / Help</Link>
        </p>
      </div>
    </main>
  )
}
