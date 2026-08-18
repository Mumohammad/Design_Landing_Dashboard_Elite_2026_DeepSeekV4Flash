"use client"

import { useEffect, useMemo, useState } from "react"
import { PackageCheck, PackageX, DollarSign, TrendingUp, Plus, Trash2, Download } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { deleteOrderEntry, exportOrdersCsv } from "@/lib/orders/actions"
import { CreateOrderEntryDialog } from "./components/create-order-entry-dialog"

interface OrderRow {
  id: string
  entry_date: string
  shift_label: string | null
  orders_delivered: number
  orders_failed: number
  orders_returned: number
  orders_cancelled: number
  total_distance_km: number | null
  gross_revenue: number
  platform_reported_revenue: number | null
  revenue_variance: number
  is_locked: boolean
  driver: { full_name_ar: string | null; driver_code: string | null } | null
  platform: { name_ar: string | null; name_en: string | null } | null
}

function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

export default function OrdersPage() {
  const { t, locale } = useTranslation()
  const isAr = locale === "ar"

  const [rows, setRows] = useState<OrderRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [month, setMonth] = useState(currentMonth())
  const [addOpen, setAddOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      setIsLoading(true)
      const supabase = createClient()
      const [y, m] = month.split("-")
      const start = `${y}-${m}-01`
      const end = `${y}-${m}-31`
      const { data, error } = await supabase
        .from("daily_order_entries")
        .select(
          "id,entry_date,shift_label,orders_delivered,orders_failed,orders_returned,orders_cancelled,total_distance_km,gross_revenue,platform_reported_revenue,revenue_variance,is_locked," +
            "driver:drivers(full_name_ar,driver_code),platform:delivery_platforms(name_ar,name_en)"
        )
        .gte("entry_date", start)
        .lte("entry_date", end)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(200)
      if (!active) return
      if (error) {
        setRows([])
        toast.error(error.message)
      } else {
        setRows((data as unknown as OrderRow[] | null) ?? [])
      }
      setIsLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [month, reloadKey])

  const shiftLabel = (s: string | null): string => {
    if (!s) return t.orders.fullDay
    if (s === "morning") return t.orders.shiftMorning
    if (s === "evening") return t.orders.shiftEvening
    if (s === "night") return t.orders.shiftNight
    return s
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.driver?.full_name_ar, r.driver?.driver_code, r.platform?.name_ar, r.platform?.name_en]
        .filter((f): f is string => Boolean(f))
        .some((f) => f.toLowerCase().includes(q))
    )
  }, [rows, search])

  const kpiCards: KpiCardData[] = useMemo(() => {
    const delivered = rows.reduce((n, r) => n + r.orders_delivered, 0)
    const failed = rows.reduce((n, r) => n + r.orders_failed, 0)
    const revenue = rows.reduce((n, r) => n + Number(r.gross_revenue ?? 0), 0)
    const total = delivered + failed
    const completion = total > 0 ? Math.round((delivered / total) * 100) : 0
    return [
      { label: t.orders.kpiDelivered, value: delivered, icon: PackageCheck, color: "#10B981" },
      { label: t.orders.kpiFailed, value: failed, icon: PackageX, color: "#EF4444" },
      { label: t.orders.kpiRevenue, value: `${revenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, icon: DollarSign, color: "#1E5A99" },
      { label: t.orders.kpiCompletion, value: `${completion}%`, icon: TrendingUp, color: "#8B5CF6" },
    ]
  }, [rows, t])

  const columns: TableColumn<OrderRow>[] = [
    {
      key: "entry_date",
      header: t.orders.colDate,
      render: (r) => <span dir="ltr" className="tabular-nums text-foreground/80">{r.entry_date}</span>,
    },
    {
      key: "driver",
      header: t.orders.colDriver,
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-medium">{r.driver?.full_name_ar ?? "—"}</span>
          {r.driver?.driver_code && <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">{r.driver.driver_code}</span>}
        </div>
      ),
    },
    {
      key: "platform",
      header: t.orders.colPlatform,
      render: (r) => <span>{r.platform?.name_ar ?? r.platform?.name_en ?? "—"}</span>,
    },
    {
      key: "shift_label",
      header: t.orders.colShift,
      render: (r) => <span className="text-muted-foreground">{shiftLabel(r.shift_label)}</span>,
    },
    {
      key: "orders_delivered",
      header: t.orders.colDelivered,
      render: (r) => <span className="tabular-nums font-semibold text-emerald-600">{r.orders_delivered}</span>,
    },
    {
      key: "orders_failed",
      header: t.orders.colFailed,
      render: (r) => <span className="tabular-nums text-red-600">{r.orders_failed}</span>,
    },
    {
      key: "orders_returned",
      header: t.orders.colReturned,
      render: (r) => <span className="tabular-nums text-amber-600">{r.orders_returned}</span>,
    },
    {
      key: "orders_cancelled",
      header: t.orders.colCancelled,
      render: (r) => <span className="tabular-nums text-muted-foreground">{r.orders_cancelled}</span>,
    },
    {
      key: "total_distance_km",
      header: t.orders.colDistance,
      render: (r) =>
        r.total_distance_km != null ? (
          <span dir="ltr" className="tabular-nums">{r.total_distance_km}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "gross_revenue",
      header: t.orders.colRevenue,
      render: (r) => <span dir="ltr" className="tabular-nums font-semibold">{fmtMoney(r.gross_revenue)}</span>,
    },
    {
      key: "revenue_variance",
      header: t.orders.colVariance,
      render: (r) => {
        const v = Number(r.revenue_variance ?? 0)
        if (v === 0) return <span className="text-muted-foreground">—</span>
        return (
          <Badge className={v > 0 ? "border-transparent bg-amber-500/15 text-amber-700" : "border-transparent bg-emerald-500/15 text-emerald-700"}>
            <span dir="ltr" className="tabular-nums">{v > 0 ? "+" : ""}{v}</span>
          </Badge>
        )
      },
    },
    {
      key: "is_locked",
      header: t.orders.colLocked,
      render: (r) =>
        r.is_locked ? (
          <Badge className="border-transparent bg-slate-500/15 text-slate-600">{t.orders.locked}</Badge>
        ) : (
          <Badge className="border-transparent bg-emerald-500/15 text-emerald-600">{t.orders.unlocked}</Badge>
        ),
    },
  ]

  async function handleDelete(id: string) {
    if (!window.confirm(isAr ? "حذف هذا السجل؟" : "Delete this entry?")) return
    setIsDeletingId(id)
    const res = await deleteOrderEntry(id)
    setIsDeletingId(null)
    if (res.success) {
      toast.success(isAr ? "تم حذف السجل" : "Entry deleted")
      setReloadKey((k) => k + 1)
    } else {
      toast.error(res.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
    }
  }

  async function handleExport() {
    const res = await exportOrdersCsv(month)
    if (!res.success || !res.csv) {
      toast.error(res.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
      return
    }
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `orders-${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(isAr ? "تم تصدير الملف" : "CSV exported")
  }

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.orders.title}
        subtitle={t.orders.subtitle}
        primaryCtaLabel={t.orders.addOrder}
        primaryCtaIcon={Plus}
        onPrimaryCta={() => setAddOpen(true)}
        kpiCards={kpiCards}
        searchPlaceholder={t.orders.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        columns={columns}
        data={filtered}
        onRowClick={() => {}}
        emptyStateMessage={t.orders.emptyMessage}
        emptyStateAction={{ label: t.orders.addOrder, onClick: () => setAddOpen(true) }}
        isLoading={isLoading}
        toolbarActions={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              aria-label={t.orders.monthLabel}
              className="h-9 rounded-xl border border-border bg-muted/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
            <Button variant="outline" size="sm" className="rounded-lg" onClick={handleExport}>
              <Download className="h-4 w-4" />
              CSV
            </Button>
          </div>
        }
        rowActions={(row) => (
          <div className="flex items-center justify-end gap-1">
            {!row.is_locked && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 rounded-lg text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(row.id)
                }}
                disabled={isDeletingId === row.id}
                title={isAr ? "حذف" : "Delete"}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      >
        <CreateOrderEntryDialog open={addOpen} onOpenChange={setAddOpen} onCreated={() => setReloadKey((k) => k + 1)} />
      </EnterpriseModulePage>
    </div>
  )
}
