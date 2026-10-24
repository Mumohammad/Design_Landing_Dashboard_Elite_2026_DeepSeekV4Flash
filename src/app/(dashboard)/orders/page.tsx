"use client"

import { useEffect, useMemo, useState } from "react"
import { PackageCheck, PackageX, DollarSign, TrendingUp, Plus, Trash2, Download, Pencil } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "@/hooks/use-translation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { deleteOrderEntry, exportOrdersCsv, listOrderEntries } from "@/lib/orders/actions"
import { CreateOrderEntryDialog } from "./components/create-order-entry-dialog"

interface OrderRow {
  id: string
  updated_at: string
  driver_id: string
  platform_id: string
  notes: string | null
  multi_order_batches: number
  avg_order_distance_km: number | null
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
  driver: { full_name_ar: string | null; full_name_en: string | null; driver_code: string | null } | null
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
  const [editing, setEditing] = useState<OrderRow | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState({delivered:0,failed:0,revenue:0})
  const [loadError, setLoadError] = useState<string>()
  const [reloadKey, setReloadKey] = useState(0)
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      setIsLoading(true)
      const result = await listOrderEntries(month,search,page,50)
      if (!active) return
      setRows(result.rows)
      setTotal(result.total)
      setSummary(result.summary)
      setLoadError(result.error)
      setIsLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [month, search, page, reloadKey])

  const shiftLabel = (s: string | null): string => {
    if (!s) return t.orders.fullDay
    if (s === "morning") return t.orders.shiftMorning
    if (s === "evening") return t.orders.shiftEvening
    if (s === "night") return t.orders.shiftNight
    return s
  }

  const kpiCards: KpiCardData[] = useMemo(() => {
    const {delivered,failed,revenue} = summary
    const total = delivered + failed
    const completion = total > 0 ? Math.round((delivered / total) * 100) : 0
    return [
      { label: t.orders.kpiDelivered, value: delivered, icon: PackageCheck, color: "#10B981" },
      { label: t.orders.kpiFailed, value: failed, icon: PackageX, color: "#EF4444" },
      { label: t.orders.kpiRevenue, value: `${revenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, icon: DollarSign, color: "#1E5A99" },
      { label: t.orders.kpiCompletion, value: `${completion}%`, icon: TrendingUp, color: "#8B5CF6" },
    ]
  }, [summary, t])

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
          <span className="font-medium">{(isAr ? r.driver?.full_name_ar : r.driver?.full_name_en) ?? r.driver?.full_name_ar ?? "—"}</span>
          {r.driver?.driver_code && <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">{r.driver.driver_code}</span>}
        </div>
      ),
    },
    {
      key: "platform",
      header: t.orders.colPlatform,
      render: (r) => <span>{(isAr ? r.platform?.name_ar : r.platform?.name_en) ?? r.platform?.name_ar ?? "—"}</span>,
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

  async function handleDelete(row: OrderRow) {
    if (!window.confirm(isAr ? "أرشفة هذا السجل؟" : "Archive this entry?")) return
    setIsDeletingId(row.id)
    const res = await deleteOrderEntry(row.id, row.updated_at)
    setIsDeletingId(null)
    if (res.success) {
      toast.success(isAr ? "تمت أرشفة السجل" : "Entry archived")
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
        onPrimaryCta={() => { setEditing(null); setAddOpen(true) }}
        kpiCards={loadError?undefined:kpiCards}
        searchPlaceholder={t.orders.searchPlaceholder}
        searchValue={search}
        onSearchChange={(value) => {setSearch(value);setPage(1)}}
        columns={columns}
        data={rows}
        onRowClick={() => {}}
        emptyStateMessage={t.orders.emptyMessage}
        emptyStateAction={{ label: t.orders.addOrder, onClick: () => {setEditing(null);setAddOpen(true)} }}
        isLoading={isLoading}
        loadError={loadError}
        onRetry={() => setReloadKey(k => k + 1)}
        pagination={{totalRecords:total,currentPage:page,totalPages:Math.max(1,Math.ceil(total/50)),onPageChange:setPage}}
        toolbarActions={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => {if(e.target.value){setMonth(e.target.value);setPage(1)}}}
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
            {!row.is_locked && <>
              <Button variant="ghost" size="sm" aria-label={isAr ? "تعديل" : "Edit"} onClick={(event) => {event.stopPropagation();setEditing(row);setAddOpen(true)}}><Pencil className="h-4 w-4" /></Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 rounded-lg text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(row)
                }}
                disabled={isDeletingId === row.id}
                aria-label={isAr ? "أرشفة" : "Archive"}
                title={isAr ? "أرشفة" : "Archive"}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>}
          </div>
        )}
      >
        <CreateOrderEntryDialog key={editing?.id ?? "create"} entry={editing} open={addOpen} onOpenChange={setAddOpen} onCreated={() => setReloadKey((k) => k + 1)} />
      </EnterpriseModulePage>
    </div>
  )
}
