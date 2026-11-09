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

function isHealth(body: unknown): body is Health {
  if (!body || typeof body !== "object") return false
  const value = body as Partial<Health>
  return typeof value.status === "string" && typeof value.timestamp === "string"
    && !!value.checks && typeof value.checks === "object" && !Array.isArray(value.checks)
    && COMPONENTS.every(({ key }) => typeof value.checks?.[key]?.status === "string")
}

function tone(status: string | undefined) {
  if (!status) return { icon: Activity, cls: "text-muted-foreground", ar: "جارٍ الفحص", en: "Checking" }
  if (status === "ok" || status === "healthy") return { icon: CheckCircle2, cls: "text-emerald-600", ar: "يعمل", en: "Operational" }
  if (status === "degraded") return { icon: AlertTriangle, cls: "text-amber-600", ar: "أداء منخفض", en: "Degraded" }
  return { icon: XCircle, cls: "text-red-600", ar: "متوقف", en: "Outage" }
}

export default function StatusPage() {
  const [attempt, setAttempt] = React.useState(0)
  const [read, setRead] = React.useState<{ attempt: number; health: Health | null; error: boolean } | null>(null)
  const health = read?.health ?? null
  const error = read?.error ?? false
  const loading = read?.attempt !== attempt

  const probe = React.useCallback(() => setAttempt(value => value + 1), [])

  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async res => {
        const body: unknown = await res.json()
        if (!isHealth(body) || (!res.ok && (body.status === "healthy" || body.status === "ok"))) throw new Error("Invalid health response")
        return body
      })
      .then(body => {
        if (!controller.signal.aborted) setRead({ attempt, health: body, error: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setRead({ attempt, health: null, error: true })
      })
    return () => controller.abort()
  }, [attempt])

  React.useEffect(() => {
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
