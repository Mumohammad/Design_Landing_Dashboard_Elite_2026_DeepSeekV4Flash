"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { BadgeCheck, Briefcase, Car, CheckCircle2, CircleAlert, Clock, Eye, FileWarning, HeartPulse, IdCard, RefreshCw, ShieldCheck, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DOC_CATALOG, DOC_CATEGORIES, type DocCategory } from "@/lib/drivers/documents"
import { documentHealth, type DocumentHealth } from "@/lib/drivers/document-health"
import { businessDateKey } from "@/lib/formatting/business-date"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"

type Row = { id: string; doc_type: string; doc_number: string | null; expiry_date: string | null; is_verified: boolean; file_url: string | null; created_at: string }
const ICONS: Record<DocCategory, LucideIcon> = { identity: IdCard, driving: BadgeCheck, health: HeartPulse, vehicle: Car, employment: Briefcase }

const BADGE: Record<DocumentHealth, string> = {
  missing: "bg-muted text-muted-foreground",
  unverified: "bg-muted text-foreground",
  valid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  expiring: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  expired: "bg-red-500/15 text-red-700 dark:text-red-400",
  no_expiry: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
}

/** Slot-based document vault: every required document, its status and one-click upload. */
export function DriverDocumentVault({ driverId, isAr, canUpload, onUpload, onView }: { driverId: string; isAr: boolean; canUpload: boolean; onUpload: (type: string) => void; onView: (path: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<DocCategory | "all" | "attention">("all")

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("driver_documents")
      .select("id,doc_type,doc_number,expiry_date,is_verified,file_url,created_at")
      .eq("driver_id", driverId).eq("is_active", true).is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(200)
    if (error) { setFailed(true); return }
    setFailed(false); setRows((data ?? []) as Row[])
  }, [driverId])

  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id) }, [load])
  useEffect(() => subscribeDriverChanged((d) => { if (d.driverId === driverId && d.action === "document") void load() }), [driverId, load])

  const byType = useMemo(() => {
    const m = new Map<string, Row>()
    for (const r of rows ?? []) if (!m.has(r.doc_type)) m.set(r.doc_type, r)
    return m
  }, [rows])

  const slots = DOC_CATALOG.map((meta) => ({ meta, row: byType.get(meta.type), ...documentHealth(meta.expires, byType.get(meta.type), businessDateKey(new Date())) }))
  const core = slots.filter((s) => s.meta.core)
  const coreDone = core.filter((s) => s.state === "valid" || s.state === "expiring").length
  const expired = slots.filter((s) => s.state === "expired").length
  const expiring = slots.filter((s) => s.state === "expiring").length
  const uploaded = slots.filter((s) => s.state !== "missing").length
  const pct = Math.round((coreDone / core.length) * 100)
  const visible = slots.filter((s) => filter === "all" ? true : filter === "attention" ? (s.state === "expired" || s.state === "expiring" || (s.meta.core && ["missing", "unverified", "no_expiry"].includes(s.state))) : s.meta.category === filter)

  const stateLabel = (s: (typeof slots)[number]) => {
    switch (s.state) {
      case "unverified": return isAr ? "بانتظار التحقق" : "Awaiting verification"
      case "missing": return isAr ? "غير مرفوع" : "Missing"
      case "expired": return isAr ? `منتهي منذ ${Math.abs(s.days ?? 0)} يوم` : `Expired ${Math.abs(s.days ?? 0)}d ago`
      case "expiring": return isAr ? `ينتهي خلال ${s.days} يوم` : `Expires in ${s.days}d`
      case "no_expiry": return isAr ? "بدون تاريخ انتهاء" : "No expiry set"
      default: return isAr ? "ساري" : "Valid"
    }
  }

  if (failed) return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="text-destructive">{isAr ? "تعذر تحميل خزنة المستندات." : "Could not load the document vault."}</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>{isAr ? "أعد المحاولة" : "Try again"}</Button>
    </div>
  )
  if (!rows) return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>

  return (
    <section className="space-y-4" data-testid="driver-document-vault" aria-label={isAr ? "خزنة المستندات" : "Document vault"}>
      <div className="relative overflow-hidden rounded-lg border border-border/50 bg-card p-5 ">
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="relative size-20 shrink-0">
            <svg viewBox="0 0 36 36" className="size-20 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-muted" strokeWidth="3.5" />
              <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" strokeLinecap="round" className={pct === 100 ? "stroke-emerald-500" : pct >= 60 ? "stroke-elite-blue-500" : "stroke-amber-500"} strokeDasharray={`${(pct / 100) * 97.4} 97.4`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums">{pct}%</span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-4 text-elite-blue-500" />{isAr ? "خزنة مستندات السائق" : "Driver document vault"}</h3>
            <p className="text-xs text-muted-foreground">{isAr ? `المستندات الأساسية ${coreDone}/${core.length} · إجمالي المرفوع ${uploaded}` : `Core documents ${coreDone}/${core.length} · ${uploaded} uploaded in total`}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", BADGE.expired)}><FileWarning className="size-3" />{isAr ? `منتهية ${expired}` : `${expired} expired`}</span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", BADGE.expiring)}><Clock className="size-3" />{isAr ? `قريبة الانتهاء ${expiring}` : `${expiring} expiring ≤30d`}</span>
            </div>
          </div>
          {canUpload && <Button className="gap-1.5" onClick={() => onUpload("")}><Upload className="size-4" />{isAr ? "إضافة مستند" : "Add document"}</Button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={isAr ? "تصنيف المستندات" : "Document categories"}>
        {([{ id: "all", en: "All", ar: "الكل" }, { id: "attention", en: "Needs attention", ar: "تحتاج متابعة" }, ...DOC_CATEGORIES] as { id: DocCategory | "all" | "attention"; en: string; ar: string }[]).map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={filter === c.id} onClick={() => setFilter(c.id)}
            className={cn("min-h-11 rounded-md border px-3 text-sm transition-colors", filter === c.id ? "border-elite-blue-500 bg-elite-blue-500 text-white" : "border-border/60 bg-background hover:bg-muted")}>
            {isAr ? c.ar : c.en}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-500" />{isAr ? "لا شيء يحتاج متابعة." : "Nothing needs attention."}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((s) => {
            const Icon = ICONS[s.meta.category]
            return (
              <article key={s.meta.type} data-testid="document-slot" data-doc-type={s.meta.type} data-state={s.state}
                className={cn("group relative flex flex-col overflow-hidden rounded-lg border bg-card p-4  transition-all",
                  s.state === "expired" ? "border-red-500/40" : s.state === "expiring" ? "border-amber-500/40" : s.state === "missing" ? "border-dashed border-border/70" : "border-border/50")}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex size-10 items-center justify-center text-muted-foreground"><Icon className="size-5" /></span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", BADGE[s.state])}>{stateLabel(s)}</span>
                </div>
                <h4 className="mt-3 text-sm font-semibold leading-tight">{isAr ? s.meta.ar : s.meta.en}{s.meta.core && <span className="ms-1 text-[10px] font-normal text-muted-foreground">{isAr ? "• أساسي" : "• core"}</span>}</h4>
                <dl className="mt-1 grid gap-0.5 text-[11px] text-muted-foreground">
                  {s.row?.doc_number && <div className="flex gap-1"><dt>{isAr ? "الرقم:" : "No.:"}</dt><dd dir="ltr" className="font-mono text-foreground/80">{s.row.doc_number}</dd></div>}
                  {s.row?.expiry_date && <div className="flex gap-1"><dt>{isAr ? "الانتهاء:" : "Expiry:"}</dt><dd className="tabular-nums text-foreground/80">{s.row.expiry_date}</dd></div>}
                  {s.row && <div className="flex items-center gap-1">{s.row.is_verified ? <><BadgeCheck className="size-3 text-emerald-500" />{isAr ? "موثّق" : "Verified"}</> : <><CircleAlert className="size-3 text-amber-500" />{isAr ? "بانتظار التحقق" : "Awaiting verification"}</>}</div>}
                  {!s.row && <div>{isAr ? "لم يُرفع بعد" : "Not uploaded yet"}</div>}
                </dl>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                  {s.row?.file_url && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => onView(s.row!.file_url!)}><Eye className="size-3" />{isAr ? "عرض" : "View"}</Button>}
                  {canUpload && <Button size="sm" variant={s.row ? "ghost" : "default"} className="h-7 gap-1 px-2 text-xs" onClick={() => onUpload(s.meta.type)}>
                    {s.row ? <RefreshCw className="size-3" /> : <Upload className="size-3" />}{s.row ? (isAr ? "استبدال" : "Replace") : (isAr ? "رفع" : "Upload")}
                  </Button>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
