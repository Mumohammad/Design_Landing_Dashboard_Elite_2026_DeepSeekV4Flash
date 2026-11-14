"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Ban, Car, CheckCircle2, FileWarning, Gavel, Link2, Loader2, RefreshCw, RotateCcw, Search, Upload, UserCheck, UserPlus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { collectRows } from "@/lib/reports/collect-rows"
import { useDriverPanelRead } from "@/hooks/use-driver-panel-read"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { FinesImportDialog } from "@/components/violations/fines-import-dialog"
import { createViolationFromFine, rematchTrafficFines, resolveTrafficFine } from "@/app/actions/violations/fines"

type Fine = {
  id: string; external_ref: string; source: string; vehicle_plate: string | null; violation_date: string | null
  violation_location: string | null; violation_type_code: string | null; fine_amount: number | null; payment_deadline: string | null
  status: "unmatched" | "matched" | "violation_created" | "duplicate" | "ignored"; match_notes: string | null
  matched_driver_id: string | null; matched_vehicle_id: string | null; violation_id: string | null
  driver: { full_name_ar: string | null; full_name_en: string | null; driver_code: string | null } | null
}
type Filter = "all" | "unmatched" | "matched" | "violation_created" | "closed"

const STATUS: Record<Fine["status"], { en: string; ar: string; cls: string }> = {
  unmatched: { en: "Unmatched", ar: "غير مطابقة", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  matched: { en: "Matched", ar: "مطابقة", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  violation_created: { en: "Violation created", ar: "أُنشئت مخالفة", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  duplicate: { en: "Duplicate", ar: "مكررة", cls: "bg-muted text-muted-foreground" },
  ignored: { en: "Ignored", ar: "متجاهلة", cls: "bg-muted text-muted-foreground" },
}
const PAGE = 100
const EMPTY_FINE_ROWS: Fine[] = []

export default function TrafficFinesPage() {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const [limit, setLimit] = useState(PAGE)
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rematching, setRematching] = useState(false)
  const [assignFor, setAssignFor] = useState<Fine | null>(null)
  const [drivers, setDrivers] = useState<{ id: string; full_name_ar: string | null; full_name_en: string | null; driver_code: string | null }[]>([])
  const [assignDriver, setAssignDriver] = useState("")
  const [driverReadError, setDriverReadError] = useState(false)
  const [driverReadAttempt, setDriverReadAttempt] = useState(0)

  const read = useCallback(async (signal: AbortSignal) => {
    const db = createClient()
    const data = await collectRows(() => db.from("external_fine_imports")
      .select("id,external_ref,source,vehicle_plate,violation_date,violation_location,violation_type_code,fine_amount,payment_deadline,status,match_notes,matched_driver_id,matched_vehicle_id,violation_id,driver:drivers!external_fine_imports_matched_driver_id_fkey(full_name_ar,full_name_en,driver_code)", { count: "exact" })
      .order("violation_date", { ascending: false, nullsFirst: false }).order("id").abortSignal(signal))
    if (data.some(row => !Object.prototype.hasOwnProperty.call(STATUS, String(row.status)) || (row.fine_amount !== null && (typeof row.fine_amount !== "number" || !Number.isFinite(row.fine_amount) || row.fine_amount < 0)))) throw Error("Invalid fines data")
    return data as unknown as Fine[]
  }, [])
  const { data, loading, error, reload: load } = useDriverPanelRead(read)
  const rows = data ?? EMPTY_FINE_ROWS

  useEffect(() => {
    if (!assignFor || drivers.length) return
    const controller = new AbortController()
    const db = createClient()
    void collectRows(() => db.from("drivers").select("id,full_name_ar,full_name_en,driver_code", { count: "exact" }).is("deleted_at", null).not("status", "in", "(terminated,blacklisted)").order("full_name_ar").order("id").abortSignal(controller.signal))
      .then(data => { if (!controller.signal.aborted) { setDrivers(data as unknown as typeof drivers); setDriverReadError(false) } })
      .catch(() => { if (!controller.signal.aborted) setDriverReadError(true) })
    return () => controller.abort()
  }, [assignFor, drivers.length, driverReadAttempt])

  const counts = useMemo(() => {
    const c = { all: rows.length, unmatched: 0, matched: 0, violation_created: 0, closed: 0, amount: 0, open: 0 }
    for (const r of rows) {
      if (r.status === "duplicate" || r.status === "ignored") c.closed++; else c[r.status]++
      if (r.status === "unmatched" || r.status === "matched") c.open += Number(r.fine_amount ?? 0)
      c.amount += Number(r.fine_amount ?? 0)
    }
    return c
  }, [rows])

  const filtered = rows.filter((r) => (filter === "all" || (filter === "closed" ? r.status === "duplicate" || r.status === "ignored" : r.status === filter))
    && (!q.trim() || [r.external_ref, r.vehicle_plate, r.driver?.full_name_ar, r.driver?.full_name_en, r.driver?.driver_code].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))))
  const visible = filtered.slice(0, limit)
  const hasMore = filtered.length > limit

  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string; errorAr?: string }>, okMsg: [string, string]) => {
    setBusyId(id)
    try {
      const res = await fn()
      if (!res.ok) { toast.error((isAr ? res.errorAr : res.error) ?? ""); return false }
      toast.success(isAr ? okMsg[1] : okMsg[0]); load(); return true
    } catch { toast.error(isAr ? "تعذر تأكيد الإجراء. حدّث السجلات قبل المحاولة مجدداً." : "The action could not be confirmed. Refresh the records before retrying."); return false }
    finally { setBusyId(null) }
  }
  const money = (n: number) => n.toLocaleString(isAr ? "ar-SA" : "en-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const unknownOpenAmount = rows.some(row => (row.status === "matched" || row.status === "unmatched") && row.fine_amount === null)

  const kpis = [
    { label: isAr ? "مطابقة بانتظار الإجراء" : "Matched — awaiting action", value: counts.matched, icon: UserCheck, tone: "text-sky-600 bg-sky-500/10" },
    { label: isAr ? "غير مطابقة" : "Unmatched", value: counts.unmatched, icon: FileWarning, tone: "text-amber-600 bg-amber-500/10" },
    { label: isAr ? "حُوّلت لمخالفات" : "Converted to violations", value: counts.violation_created, icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-500/10" },
    { label: isAr ? "مبالغ مفتوحة (ر.س)" : "Open amount (SAR)", value: unknownOpenAmount ? "—" : money(counts.open), icon: Gavel, tone: "text-rose-600 bg-rose-500/10" },
  ]
  const chips: { k: Filter; en: string; ar: string; n: number }[] = [
    { k: "all", en: "All", ar: "الكل", n: counts.all }, { k: "matched", en: "Matched", ar: "مطابقة", n: counts.matched },
    { k: "unmatched", en: "Unmatched", ar: "غير مطابقة", n: counts.unmatched }, { k: "violation_created", en: "Converted", ar: "محوّلة", n: counts.violation_created },
    { k: "closed", en: "Ignored / duplicate", ar: "متجاهلة / مكررة", n: counts.closed },
  ]

  return (
    <div className="space-y-6 px-4 py-4 lg:px-6">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <Link href="/violations" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3 rtl:rotate-180" />{isAr ? "المخالفات" : "Violations"}</Link>
            <h1 className="text-2xl font-bold tracking-tight">{isAr ? "المخالفات المرورية والمطابقة التلقائية" : "Traffic fines & auto-matching"}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{isAr ? "ارفع كشف مخالفات المرور، وسيحدد النظام السائق المسؤول تلقائياً من سجل تعيين المركبات في تاريخ كل مخالفة، ثم حوّلها لمخالفة تُخصم من الراتب." : "Upload the Muroor fines statement; each fine is attributed to the driver who held the vehicle on that date, then converted into a payroll-deductible violation in one click."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={rematching} onClick={async () => { setRematching(true); try { const r = await rematchTrafficFines(); if (!r.ok) toast.error(isAr ? r.errorAr : r.error); else { toast.success(isAr ? `تمت مطابقة ${r.data.matched}` : `${r.data.matched} newly matched`); load() } } catch { toast.error(isAr ? "تعذر تأكيد المطابقة. حدّث السجلات." : "Matching could not be confirmed. Refresh the records.") } finally { setRematching(false) } }}>
              {rematching ? <Loader2 className="me-2 size-4 animate-spin" /> : <RefreshCw className="me-2 size-4" />}{isAr ? "إعادة المطابقة" : "Re-run matching"}
            </Button>
            <Button onClick={() => setImportOpen(true)}><Upload className="me-2 size-4" />{isAr ? "استيراد كشف المخالفات" : "Import fines"}</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card rtl:divide-x-reverse xl:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{loading ? "…" : error ? "—" : k.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button key={c.k} type="button" onClick={() => setFilter(c.k)} aria-pressed={filter === c.k}
            className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", filter === c.k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {isAr ? c.ar : c.en} <span className="tabular-nums opacity-70">{error ? "—" : c.n}</span>
          </button>
        ))}
        <div className="relative ms-auto w-full sm:w-72">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={isAr ? "البحث في المخالفات" : "Search fines"} value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} placeholder={isAr ? "ابحث بالمرجع أو اللوحة أو السائق" : "Search reference, plate or driver"} className="ps-9" />
        </div>
      </div>

      {loading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</div>
        : error ? <div role="alert" className="rounded-2xl border border-destructive/40 p-6 text-center"><p>{isAr ? "تعذر تحميل المخالفات" : "Could not load fines"}</p><Button className="mt-3" variant="outline" onClick={() => void load()}>{isAr ? "إعادة المحاولة" : "Retry"}</Button></div>
          : visible.length === 0 ? (
            <div className="rounded-3xl border border-dashed p-12 text-center">
              <Gavel className="mx-auto size-10 text-muted-foreground" />
              <p className="mt-3 font-medium">{rows.length ? (isAr ? "لا نتائج لهذا الفلتر" : "No fines for this filter") : (isAr ? "لا توجد مخالفات مستوردة بعد" : "No fines imported yet")}</p>
              {!rows.length && <Button className="mt-4" onClick={() => setImportOpen(true)}><Upload className="me-2 size-4" />{isAr ? "استيراد أول كشف" : "Import your first statement"}</Button>}
            </div>
          ) : (
            <div className="space-y-2" data-testid="fines-list">
              {visible.map((f) => {
                const st = STATUS[f.status]
                const driverName = f.driver ? (isAr ? f.driver.full_name_ar || f.driver.full_name_en : f.driver.full_name_en || f.driver.full_name_ar) : null
                return (
                  <article key={f.id} className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[auto_1fr_auto] md:items-center">
                    <div className="flex items-center gap-3">
                      <div className="min-w-24 rounded-lg border-2 border-foreground/80 bg-white px-2 py-1 text-center font-mono text-sm font-bold tracking-wider text-black" dir="ltr">{f.vehicle_plate ?? "—"}</div>
                      <div className="md:hidden"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.cls)}>{isAr ? st.ar : st.en}</span></div>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold tabular-nums" dir="ltr">{f.external_ref}</span>
                        <span className={cn("hidden rounded-full px-2 py-0.5 text-[11px] font-medium md:inline", st.cls)}>{isAr ? st.ar : st.en}</span>
                        {f.violation_type_code && <span className="text-xs text-muted-foreground">· {f.violation_type_code}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <span className="tabular-nums">{f.violation_date ?? "—"}</span>{f.violation_location ? ` · ${f.violation_location}` : ""}{f.payment_deadline ? ` · ${isAr ? "السداد قبل" : "pay by"} ${f.payment_deadline}` : ""}
                      </p>
                      <p className="flex items-center gap-1.5 text-sm">
                        {driverName ? <><UserCheck className="size-4 text-sky-600" /><Link className="font-medium hover:underline" href={`/drivers/${f.matched_driver_id}`}>{driverName}</Link>{f.driver?.driver_code && <span className="text-xs text-muted-foreground">({f.driver.driver_code})</span>}</>
                          : f.matched_vehicle_id ? <><Car className="size-4 text-amber-600" /><span className="text-muted-foreground">{isAr ? "المركبة معروفة، ولا يوجد سائق معيّن في ذلك التاريخ" : "Vehicle found — no driver assigned on that date"}</span></>
                            : <><FileWarning className="size-4 text-amber-600" /><span className="text-muted-foreground">{isAr ? "لا توجد مركبة بهذه اللوحة" : "No vehicle with this plate"}</span></>}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      <span className="me-2 text-lg font-bold tabular-nums">{f.fine_amount === null ? "—" : money(f.fine_amount)} <span className="text-xs font-normal text-muted-foreground">{isAr ? "ر.س" : "SAR"}</span></span>
                      {f.status === "matched" && <Button size="sm" disabled={busyId === f.id || f.fine_amount === null} onClick={() => void act(f.id, () => createViolationFromFine(f.id), ["Violation created for the driver", "تم إنشاء المخالفة على السائق"])}>{busyId === f.id ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Link2 className="me-1.5 size-3.5" />}{isAr ? "تحويل لمخالفة" : "Create violation"}</Button>}
                      {(f.status === "unmatched" || f.status === "matched") && <Button size="sm" variant="outline" onClick={() => { setAssignFor(f); setAssignDriver(f.matched_driver_id ?? "") }}><UserPlus className="me-1.5 size-3.5" />{f.matched_driver_id ? (isAr ? "تغيير السائق" : "Change driver") : (isAr ? "تعيين سائق" : "Assign driver")}</Button>}
                      {(f.status === "unmatched" || f.status === "matched") && <Button size="sm" variant="ghost" disabled={busyId === f.id} onClick={() => void act(f.id, () => resolveTrafficFine({ id: f.id, action: "ignore" }), ["Fine ignored", "تم تجاهل المخالفة"])}><Ban className="me-1.5 size-3.5" />{isAr ? "تجاهل" : "Ignore"}</Button>}
                      {(f.status === "ignored" || f.status === "duplicate") && <Button size="sm" variant="ghost" disabled={busyId === f.id} onClick={() => void act(f.id, () => resolveTrafficFine({ id: f.id, action: "reopen" }), ["Fine reopened", "أُعيد فتح المخالفة"])}><RotateCcw className="me-1.5 size-3.5" />{isAr ? "إعادة فتح" : "Reopen"}</Button>}
                    </div>
                  </article>
                )
              })}
              {hasMore && <div className="text-center"><Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>{isAr ? "عرض المزيد" : "Load more"}</Button></div>}
            </div>
          )}

      <FinesImportDialog open={importOpen} onOpenChange={setImportOpen} isAr={isAr} onImported={() => void load()} />
      <Dialog open={!!assignFor} onOpenChange={(v) => !v && setAssignFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isAr ? "تعيين السائق المسؤول" : "Assign responsible driver"}</DialogTitle>
            <DialogDescription>{assignFor ? `${assignFor.external_ref} · ${assignFor.vehicle_plate ?? ""} · ${assignFor.violation_date ?? ""}` : ""}</DialogDescription>
          </DialogHeader>
          <label htmlFor="fine-driver" className="text-sm font-medium">{isAr ? "السائق المسؤول" : "Responsible driver"}</label>
          <SearchableSelect id="fine-driver" value={assignDriver} allowClear={false} onChange={setAssignDriver}
            options={drivers.map((d) => ({ value: d.id, label: (isAr ? d.full_name_ar || d.full_name_en : d.full_name_en || d.full_name_ar) ?? d.id.slice(0, 8), keywords: [d.driver_code ?? "", d.full_name_ar ?? "", d.full_name_en ?? ""], hint: d.driver_code ?? undefined }))}
            placeholder={isAr ? "اختر سائقاً" : "Select driver"} searchPlaceholder={isAr ? "ابحث بالاسم أو الكود" : "Search name or code"} emptyText={isAr ? "لا نتائج" : "No results"} />
          {driverReadError && <div role="alert" className="space-y-2 text-sm"><p>{isAr ? "تعذر تحميل قائمة السائقين كاملة." : "Could not load the complete driver list."}</p><Button type="button" variant="outline" onClick={() => { setDriverReadError(false); setDriverReadAttempt(value => value + 1) }}>{isAr ? "إعادة المحاولة" : "Retry"}</Button></div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button disabled={driverReadError || !assignDriver || busyId === assignFor?.id} onClick={() => { const f = assignFor; if (!f) return; void act(f.id, () => resolveTrafficFine({ id: f.id, action: "assign", driverId: assignDriver }), ["Driver assigned", "تم تعيين السائق"]).then(ok => { if (ok) setAssignFor(null) }) }}>{isAr ? "تعيين" : "Assign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
