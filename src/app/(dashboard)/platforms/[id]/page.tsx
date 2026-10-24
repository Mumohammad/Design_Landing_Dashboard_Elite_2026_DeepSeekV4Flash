"use client"

// /platforms/[id] — per-platform drill-down (Prompt O Part 2).
// Daily entries rollup (orders, delivered %, gross revenue), monthly rollup
// (monthly_driver_orders), payments ledger (platform_payments with the
// record-payment action, balance = invoiced − paid) and drivers active on
// the platform. Months without rows are ABSENT, never zero-filled.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Plus, Download, DollarSign, Pencil } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PaymentDialog } from "../components/platform-dialogs"
import { ImportDialog } from "../components/import-dialog"
import { EntryDialog } from "../components/entry-dialog"
import { exportPlatformOrdersCsv } from "@/lib/platforms-module/actions"
import { rollupDaily, rollupMonthly } from "@/lib/platforms-module/module-utils"

interface DailyRow {
  entry_date: string
  driver_id: string
  orders_delivered: number | null
  orders_failed: number | null
  orders_returned: number | null
  orders_cancelled: number | null
  gross_revenue: number | null
  driver: { full_name_ar: string | null; full_name_en: string | null } | null
}

interface MonthlyRow {
  driver_id: string
  period_year: number
  period_month: number
  total_delivered: number | null
  total_revenue: number | null
  driver: { full_name_ar: string | null; full_name_en: string | null } | null
}

interface PaymentRow {
  id: string
  period_year: number
  period_month: number
  expected_amount: number
  received_amount: number
  outstanding_amount: number
  payment_status: string
  payment_date: string | null
  payment_ref: string | null
  notes: string | null
  updated_at: string
}

type Tab = "daily" | "monthly" | "payments" | "drivers"

export default function PlatformDetailPage() {
  const params = useParams<{ id: string }>()
  const platformId = params?.id
  const { t,locale } = useTranslation()
  const pm = t.platformsModule
  const om = t.orders

  const [platform, setPlatform] = useState<{ id: string; name_ar: string; name_en: string | null; code: string; is_active: boolean } | null>(null)
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [monthly, setMonthly] = useState<MonthlyRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [drivers, setDrivers] = useState<{ id: string; full_name_ar: string | null; full_name_en: string | null; driver_code: string | null }[]>([])
  const [tab, setTab] = useState<Tab>("daily")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [month, setMonth] = useState(()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Riyadh",year:"numeric",month:"2-digit"}).slice(0,7))
  const [summary, setSummary] = useState({todayOrders:0,todayRevenue:0,outstanding:0})
  const [loadError, setLoadError] = useState<string>()
  const requestRef = useRef(0)
  const invalidateRequests=useCallback(()=>{requestRef.current++},[])
  const [isLoading, setIsLoading] = useState(true)
  const [payOpen, setPayOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<PaymentRow | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importSession, setImportSession] = useState(0)
  const [paySession, setPaySession] = useState(0)
  const [entryOpen, setEntryOpen] = useState(false)
  const [entrySession, setEntrySession] = useState(0)

  // Never sets state synchronously (the first await comes before any setState),
  // so calling it from an effect cannot cascade renders. The initial spinner
  // is the useState(true) default; refetches after mutations refresh silently.
  const loadData = useCallback(async () => {
    if (!platformId) return
    const request=++requestRef.current
    setIsLoading(true)
    const supabase = createClient()
    const {data,error}=await supabase.rpc("get_delivery_platform_detail",{p_id:platformId,p_tab:tab,p_month:month,p_page:page,p_page_size:50})
    if(request!==requestRef.current)return
    if(error){setLoadError(error.message)}
    else{
      setPlatform(data.platform);setTotal(data.total);setSummary(data.summary);setLoadError(undefined)
      if(tab==="daily")setDaily(data.rows)
      if(tab==="monthly")setMonthly(data.rows)
      if(tab==="payments")setPayments(data.rows)
      if(tab==="drivers")setDrivers(data.rows)
    }
    setIsLoading(false)
  }, [platformId,tab,month,page])

  useEffect(() => {
    const timer=setTimeout(()=>void loadData(),0)
    return()=>{clearTimeout(timer);invalidateRequests()}

  }, [loadData,invalidateRequests])

  const dailyRollup = rollupDaily(daily)
  const monthlyRollup = rollupMonthly(monthly)
  const todayIso = new Date().toISOString().slice(0,10)
  const {todayOrders,todayRevenue,outstanding:totalOutstanding} = summary
  async function handleExport() {
    if(!platformId)return
    const result=await exportPlatformOrdersCsv(platformId,month)
    if(!result.success || !result.csv){toast.error(result.error);return}
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `platform-${platform?.code ?? platformId}-${todayIso}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t.common.export)
  }

  const statusCls: Record<string, string> = {
    paid: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
    partial: "bg-amber-500/15 text-amber-600 border-amber-500/20",
    pending: "bg-blue-500/15 text-blue-600 border-blue-500/20",
    overdue: "bg-red-500/15 text-red-600 border-red-500/20",
    disputed: "bg-orange-500/15 text-orange-600 border-orange-500/20",
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "daily", label: pm.dailyRollup },
    { key: "monthly", label: pm.monthlyRollup },
    { key: "payments", label: pm.paymentsLedger },
    { key: "drivers", label: pm.activeDrivers },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/platforms" className="rounded-xl border border-border/50 p-2 hover:bg-muted/40"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-xl font-bold">{pm.drillDown}: {(locale==="ar"?platform?.name_ar:platform?.name_en)??platform?.name_ar??platformId}</h1>
            <p dir="ltr" className="text-xs text-muted-foreground">{platform?.code}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-xl border border-border/50 bg-muted/30 px-3 py-1.5 text-xs">
            {pm.kpiTodayOrders}: <strong dir="ltr">{todayOrders}</strong> · {pm.colRevenue}: <strong dir="ltr">{todayRevenue.toFixed(0)}</strong> · {pm.kpiOutstanding}: <strong dir="ltr">{totalOutstanding.toFixed(0)}</strong>
          </span>
          <Button size="sm" variant="outline" onClick={() => { setImportSession((s) => s + 1); setImportOpen(true) }}><Download className="mr-1 h-3.5 w-3.5 rotate-180" />{pm.importEntries}</Button>
          <Button size="sm" variant="outline" onClick={() => { setEntrySession((s) => s + 1); setEntryOpen(true) }}><Plus className="mr-1 h-3.5 w-3.5" />{pm.addEntry}</Button>
          <Button size="sm" variant="outline" onClick={handleExport}><Download className="mr-1 h-3.5 w-3.5" />{t.common.export}</Button>
          <Button size="sm" onClick={() => { setEditingPayment(null); setPaySession((s) => s + 1); setPayOpen(true) }}><DollarSign className="mr-1 h-3.5 w-3.5" />{pm.recordPayment}</Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => {setTab(tb.key);setPage(1)}}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${tab === tb.key ? "bg-elite-blue-600 text-white" : "border border-border/50 bg-muted/30 hover:bg-muted/50"}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {loadError && <div role="alert" className="mb-4 rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{loadError}<Button variant="outline" onClick={loadData}>{locale==="ar"?"إعادة المحاولة":"Try again"}</Button></div>}
      {tab==="daily" && <input type="month" aria-label={locale==="ar"?"الشهر":"Month"} value={month} onChange={event=>{if(event.target.value){setMonth(event.target.value);setPage(1)}}} className="mb-3 h-9 rounded-md border border-input bg-background px-3" />}
      {isLoading ? (
        <p className="p-6 text-sm text-muted-foreground">{t.common.loading}</p>
      ) : loadError ? null : (
        <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/80">
          {tab === "daily" && (
            dailyRollup.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{pm.noEntries}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30 text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 text-start">{om.colDate}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colDelivered}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colDeliveredPct}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colRevenue}</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRollup.map((d) => (
                    <tr key={d.entry_date} className="border-b border-border/20 last:border-0">
                      <td dir="ltr" className="px-4 py-2.5">{d.entry_date}</td>
                      <td dir="ltr" className="px-4 py-2.5 tabular-nums">{d.delivered} / {d.orders}</td>
                      <td dir="ltr" className="px-4 py-2.5 tabular-nums">{d.deliveredPct != null ? d.deliveredPct.toFixed(1) + "%" : "—"}</td>
                      <td dir="ltr" className="px-4 py-2.5 tabular-nums">{d.grossRevenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === "monthly" && (
            monthlyRollup.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{pm.noEntries}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30 text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 text-start">{pm.colPeriod}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colDelivered}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colRevenue}</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRollup.map((mo) => (
                    <tr key={mo.period} className="border-b border-border/20 last:border-0">
                      <td dir="ltr" className="px-4 py-2.5">{mo.period}</td>
                      <td dir="ltr" className="px-4 py-2.5 tabular-nums">{mo.delivered}</td>
                      <td dir="ltr" className="px-4 py-2.5 tabular-nums">{mo.revenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === "payments" && (
            payments.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{pm.noPayments}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30 text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 text-start">{pm.colPeriod}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colExpected}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colReceived}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colOutstanding}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colPaymentStatus}</th>
                    <th className="px-4 py-2.5 text-start">{pm.colPaymentDate}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-border/20 last:border-0">
                      <td dir="ltr" className="px-4 py-2.5">{p.period_year}-{String(p.period_month).padStart(2, "0")}</td>
                      <td dir="ltr" className="px-4 py-2.5 tabular-nums">{Number(p.expected_amount).toFixed(2)}</td>
                      <td dir="ltr" className="px-4 py-2.5 tabular-nums">{Number(p.received_amount).toFixed(2)}</td>
                      <td dir="ltr" className="px-4 py-2.5 tabular-nums">{Number(p.outstanding_amount).toFixed(2)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls[p.payment_status] ?? statusCls.pending}`}>{p.payment_status}</span>
                      </td>
                      <td dir="ltr" className="px-4 py-2.5 text-xs">{p.payment_date ?? "—"}<Button variant="ghost" size="sm" aria-label={locale==="ar"?"تعديل فترة الدفع":"Edit payment period"} onClick={()=>{setEditingPayment(p);setPaySession(s=>s+1);setPayOpen(true)}}><Pencil className="h-4 w-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === "drivers" && (
            drivers.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{t.common.noData}</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.id} className="border-b border-border/20 last:border-0">
                      <td className="px-4 py-2.5">
                        <Link href={`/drivers/${d.id}`} className="font-medium hover:underline">{(locale==="ar"?d.full_name_ar:d.full_name_en)||d.full_name_ar||d.full_name_en}</Link>
                      </td>
                      <td dir="ltr" className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{d.driver_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      )}

      <nav aria-label={locale==="ar"?"تصفح سجلات المنصة":"Platform records pagination"} className="mt-4 flex items-center justify-between gap-3 text-sm">
        <span>{total} {locale==="ar"?"سجل":"records"} · {page} / {Math.max(1,Math.ceil(total/50))}</span>
        <div className="flex gap-2"><Button variant="outline" disabled={page<=1 || !!loadError} onClick={()=>setPage(page-1)}>{locale==="ar"?"السابق":"Previous"}</Button><Button variant="outline" disabled={page>=Math.ceil(total/50) || !!loadError} onClick={()=>setPage(page+1)}>{locale==="ar"?"التالي":"Next"}</Button></div>
      </nav>
      <PaymentDialog
        key={`pay-${paySession}`}
        open={payOpen}
        payment={editingPayment}
        platformId={platformId ?? null}
        platformName={platform?.name_ar ?? ""}
        defaultYear={new Date().getFullYear()}
        defaultMonth={new Date().getMonth() + 1}
        onClose={() => setPayOpen(false)}
        onDone={(err) => {
          if (err) toast.error(err)
          else {
            toast.success(t.common.saved)
            setPayOpen(false)
            loadData()
          }
        }}
      />
      {entryOpen && (
        <EntryDialog
          key={`entry-${entrySession}`}
          open
          platformId={platformId ?? null}
          platformName={platform?.name_ar ?? ""}
          onClose={() => setEntryOpen(false)}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setEntryOpen(false)
              loadData()
            }
          }}
        />
      )}
      {importOpen && (
        <ImportDialog
          key={`import-${importSession}`}
          open
          platformId={platformId ?? null}
          platformName={platform?.name_ar ?? ""}
          onClose={() => setImportOpen(false)}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              setImportOpen(false)
              loadData()
            }
          }}
        />
      )}
    </div>
  )
}
