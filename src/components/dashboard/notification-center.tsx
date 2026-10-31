"use client"

import * as React from "react"
import Link from "next/link"
import { Bell, BellOff, CheckCheck, CarFront, FileWarning, IdCard, RefreshCw, ClipboardCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslation } from "@/hooks/use-translation"
import { getNotificationFeed } from "@/lib/notifications/feed"
import {
  notificationStatus,
  notificationTitle,
  type NotificationFeed,
  type NotificationItem,
} from "@/lib/notifications/feed-utils"
import { cn } from "@/lib/utils"

const READ_KEY = "elite-notifications-read"
const REFRESH_MS = 5 * 60 * 1000
const MAX_READ_IDS = 500

function loadRead(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(READ_KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}

function saveRead(ids: Set<string>) {
  try {
    window.localStorage.setItem(READ_KEY, JSON.stringify([...ids].slice(-MAX_READ_IDS)))
  } catch {
    /* storage unavailable (private mode) — read state stays in memory */
  }
}

function iconFor(item: NotificationItem) {
  if (item.kind.startsWith("vehicle_")) return CarFront
  if (item.kind === "invoice_overdue") return FileWarning
  if (item.kind === "approvals_pending") return ClipboardCheck
  return IdCard
}

const SEVERITY_DOT: Record<NotificationItem["severity"], string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500",
}

export function NotificationCenter() {
  const { locale } = useTranslation()
  const lang: "ar" | "en" = locale === "ar" ? "ar" : "en"
  const ar = lang === "ar"
  const [open, setOpen] = React.useState(false)
  const [feed, setFeed] = React.useState<NotificationFeed | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [read, setRead] = React.useState<Set<string>>(() => new Set())
  const [filter, setFilter] = React.useState<"all" | "unread">("all")

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      setFeed(await getNotificationFeed())
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setRead(loadRead())
    void refresh()
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [refresh])

  const items = feed?.items ?? []
  const unread = items.filter((i) => !read.has(i.id))
  const shown = filter === "unread" ? unread : items
  const unreadCount = unread.length

  const markRead = (ids: string[]) => {
    setRead((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      saveRead(next)
      return next
    })
  }

  const fmtAmount = (n: number) =>
    new Intl.NumberFormat(ar ? "ar-SA" : "en-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 2 }).format(n)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          data-testid="notification-center-trigger"
          className="relative h-10 w-10 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          aria-label={ar ? `الإشعارات${unreadCount ? ` (${unreadCount} غير مقروء)` : ""}` : `Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                (feed?.critical ?? 0) > 0 ? "bg-red-600" : "bg-amber-500",
              )}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0" dir={ar ? "rtl" : "ltr"} data-testid="notification-center">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{ar ? "الإشعارات" : "Notifications"}</p>
            <p className="text-xs text-muted-foreground">
              {ar ? "تنبيهات الوثائق والفواتير والموافقات" : "Document, invoice and approval alerts"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void refresh()}
              aria-label={ar ? "تحديث" : "Refresh"}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              disabled={unreadCount === 0}
              onClick={() => markRead(items.map((i) => i.id))}
            >
              <CheckCheck className="h-4 w-4" />
              {ar ? "تحديد الكل كمقروء" : "Mark all read"}
            </Button>
          </div>
        </div>

        <div className="flex gap-1 border-b px-3 py-2" role="tablist">
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium",
                filter === f ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {f === "all" ? (ar ? `الكل (${items.length})` : `All (${items.length})`) : ar ? `غير المقروء (${unreadCount})` : `Unread (${unreadCount})`}
            </button>
          ))}
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {!feed && loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : failed && !feed ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {ar ? "تعذر تحميل الإشعارات. حاول مرة أخرى." : "Couldn't load notifications. Try again."}
            </p>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <BellOff className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">{ar ? "لا توجد إشعارات" : "You're all caught up"}</p>
              <p className="text-xs text-muted-foreground">
                {ar ? "سنُنبهك عند اقتراب انتهاء الوثائق أو تأخر الفواتير." : "We'll alert you when documents near expiry or invoices go overdue."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {shown.map((item) => {
                const Icon = iconFor(item)
                const isRead = read.has(item.id)
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => {
                        markRead([item.id])
                        setOpen(false)
                      }}
                      className={cn("flex items-start gap-3 px-4 py-3 hover:bg-muted/60", !isRead && "bg-sky-50/50 dark:bg-sky-950/20")}
                    >
                      <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className={cn("absolute -top-0.5 -end-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background", SEVERITY_DOT[item.severity])} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={cn("truncate text-sm", !isRead ? "font-semibold" : "font-medium")}>
                            {notificationTitle(item.kind, lang)}
                          </span>
                          {item.date && <span className="shrink-0 text-[11px] text-muted-foreground" dir="ltr">{item.date}</span>}
                        </span>
                        {item.subject && <span className="block truncate text-xs text-foreground/80">{item.subject}</span>}
                        <span className={cn("block text-xs", item.severity === "critical" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                          {notificationStatus(item, lang)}
                          {item.amount !== undefined && ` · ${fmtAmount(item.amount)}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {feed && feed.total > items.length && (
          <p className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
            {ar ? `يُعرض ${items.length} من ${feed.total} تنبيه` : `Showing ${items.length} of ${feed.total} alerts`}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
