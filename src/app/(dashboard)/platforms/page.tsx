"use client"

// /platforms — delivery-platform operations (Prompt O Part 2).
// Composes delivery_platforms + daily_order_entries (today) +
// platform_payments (month) for KPIs; platform CRUD and deactivation ride
// the server actions; rows link into /platforms/[id] drill-downs.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { LayoutTemplate, CheckCircle2, DollarSign, Plus, Download, Pencil, PowerOff, ChevronRight, AlertCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Button } from "@/components/ui/button"
import { deactivatePlatform, exportPlatformsCsv } from "@/lib/platforms-module/actions"
import { PlatformDialog, type PlatformRow } from "./components/platform-dialogs"
import { ImportDialog } from "./components/import-dialog"

export default function PlatformsPage() {
  const { t } = useTranslation()
  const pm = t.platformsModule
  const isAr = t.common.status === "الحالة"

  const [rows, setRows] = useState<PlatformRow[]>([])
  const [todayOrders, setTodayOrders] = useState(0)
  const [monthRevenue, setMonthRevenue] = useState(0)
  const [outstanding, setOutstanding] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PlatformRow | null>(null)
  const [importFor, setImportFor] = useState<PlatformRow | null>(null)
  const [importSession, setImportSession] = useState(0)

  // Never sets state synchronously (the first await comes before any setState),
  // so calling it from an effect cannot cascade renders. The initial spinner
  // is the useState(true) default; refetches after mutations refresh silently.
  const loadData = useCallback(async () => {
    const supabase = createClient()
    const now = new Date()
    const todayIso = now.toISOString().slice(0, 10)
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`

    const [platRes, todayRes, revenueRes, outstandingRes] = await Promise.all([
      supabase
        .from("delivery_platforms")
        .select("id,code,name_ar,name_en,brand_color,is_active,rate_type,rate_per_order,api_base_url,sort_order")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true }),
      supabase
        .from("daily_order_entries")
        .select("orders_delivered")
        .gte("entry_date", todayIso)
        .lte("entry_date", todayIso)
        .is("deleted_at", null),
      supabase
        .from("daily_order_entries")
        .select("gross_revenue")
        .gte("entry_date", monthStart)
        .lte("entry_date", todayIso)
        .is("deleted_at", null),
      supabase
        .from("platform_payments")
        .select("outstanding_amount")
        .in("payment_status", ["pending", "partial", "overdue"])
        .is("deleted_at", null),
    ])
    setRows((platRes.data as PlatformRow[]) ?? [])
    setTodayOrders((todayRes.data as { orders_delivered: number }[] | null)?.reduce((s, r) => s + Number(r.orders_delivered ?? 0), 0) ?? 0)
    setMonthRevenue((revenueRes.data as { gross_revenue: number }[] | null)?.reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0) ?? 0)
    setOutstanding((outstandingRes.data as { outstanding_amount: number }[] | null)?.reduce((s, r) => s + Number(r.outstanding_amount ?? 0), 0) ?? 0)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadData()
      void cancelled
    })()
    return () => {
      cancelled = true
    }
  }, [loadData])

  const filtered = useMemo(
    () => rows.filter((r) => !search || `${r.name_ar} ${r.name_en ?? ""} ${r.code}`.toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  )

  const kpiCards: KpiCardData[] = [
    { label: pm.kpiActive, value: rows.filter((r) => r.is_active).length, icon: CheckCircle2, color: "#10B981" },
    { label: pm.kpiTodayOrders, value: todayOrders, icon: LayoutTemplate, color: "#1E5A99" },
    { label: pm.kpiMonthRevenue, value: monthRevenue.toFixed(0), icon: DollarSign, color: "#0F766E" },
    { label: pm.kpiOutstanding, value: outstanding.toFixed(0), icon: AlertCircle, color: "#EF4444" },
  ]

  const columns: TableColumn<PlatformRow>[] = [
    {
      key: "name",
      header: t.nav.platforms,
      render: (r) => (
        <Link href={`/platforms/${r.id}`} className="flex items-center gap-2 hover:underline">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.brand_color ?? "#1E5A99" }} />
          <span className="font-medium">{r.name_ar}</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </Link>
      ),
    },
    { key: "code", header: pm.colCode, render: (r) => <span dir="ltr" className="font-mono text-xs">{r.code}</span> },
    {
      key: "rate_type",
      header: pm.colRateType,
      render: (r) => <span className="text-xs">{r.rate_type}</span>,
    },
    {
      key: "rate",
      header: pm.colRate,
      render: (r) =>
        r.rate_type === "flat" && r.rate_per_order != null ? (
          <span dir="ltr" className="tabular-nums">{Number(r.rate_per_order).toFixed(2)} {isAr ? "ر.س" : "SAR"}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "is_active",
      header: t.common.status,
      render: (r) =>
        r.is_active ? (
          <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">{t.common.active}</span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-gray-500/20 bg-gray-500/15 px-2 py-0.5 text-xs font-medium text-gray-600">{t.common.inactive}</span>
        ),
    },
    {
      key: "actions_col",
      header: t.common.actions,
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" title={pm.importEntries} onClick={() => { setImportSession((s) => s + 1); setImportFor(r) }}>
            <Download className="h-3.5 w-3.5 rotate-180" />
          </Button>
          <Button size="sm" variant="ghost" title={t.common.edit} onClick={() => { setEditing(r); setDialogOpen(true) }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {r.is_active && (
            <Button
              size="sm"
              variant="ghost"
              title={pm.deactivatePlatform}
              onClick={async () => {
                if (!confirm(pm.deactivateConfirm)) return
                const res = await deactivatePlatform(r.id)
                if (res.success) {
                  toast.success(t.common.saved)
                  await loadData()
                } else {
                  toast.error(res.error ?? "Error")
                }
              }}
            >
              <PowerOff className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  async function handleExport() {
    const res = await exportPlatformsCsv()
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `platforms-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t.common.export)
    } else {
      toast.error(res.error ?? "Error")
    }
  }

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.platforms}
        subtitle={pm.subtitle}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel={pm.addPlatform}
        primaryCtaIcon={Plus}
        onPrimaryCta={() => { setEditing(null); setDialogOpen(true) }}
        toolbarActions={
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1 h-4 w-4" />
            {t.common.export}
          </Button>
        }
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyStateMessage={t.common.noData}
      />

      {dialogOpen && (
        <PlatformDialog
          key={`platform-${editing?.id ?? "new"}`}
          open
          platform={editing}
          onClose={() => { setDialogOpen(false); setEditing(null) }}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setDialogOpen(false)
              setEditing(null)
              loadData()
            }
          }}
        />
      )}
      {importFor != null && (
        <ImportDialog
          key={`import-${importFor.id}-${importSession}`}
          open
          platformId={importFor.id}
          platformName={importFor.name_ar}
          onClose={() => setImportFor(null)}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              setImportFor(null)
              loadData()
            }
          }}
        />
      )}
    </div>
  )
}
